---
name: gstar-studio
description: |
  G-Star AI Studio development skill — a Next.js + Gemini AI application that generates e-commerce model photography for G-Star RAW denim. Use this skill whenever working on the gstar-studio codebase: fixing prompts, adjusting generation pipelines, deploying to Cloud Run, editing dressed base logic, modifying QC scoring, updating shot types, working with wardrobe/model/job entities, or debugging image generation issues. Also trigger when the user mentions "gstar", "G-Star", "studio", "model shots", "dressed bases", "generation pipeline", "Gemini image generation", "garment template", or anything related to AI-generated fashion photography. This skill contains the full architectural context, file map, prompt conventions, deploy commands, and known pitfalls accumulated over months of development.
---

# G-Star AI Studio — Development Context

## What This App Does

G-Star AI Studio generates e-commerce model photography using Gemini's image generation API. Users upload garment reference photos (flat images + 360° mannequin views), configure AI models (virtual people), and generate 5 standardized shot types per garment-model combination. The system produces studio-quality images that match G-Star RAW's ECOM photography guidelines.

## Two-GCP-Project Architecture

This is critical to understand — there are TWO separate GCP projects:

| Project | ID | Number | Purpose |
|---|---|---|---|
| **gstar-ai-studio** | gstar-ai-studio | 674145888056 | Cloud Run, Firestore, GCS — hosts the app |
| **gen-lang-client** | gen-lang-client-0396152930 | 796981916231 | Gemini API billing — the API key lives here |

The `GEMINI_API_KEY` env var on Cloud Run points to a key in the gen-lang-client project. All Firestore/GCS operations use the gstar-ai-studio project's service account (Application Default Credentials on Cloud Run).

## Recent Architecture (May 1, 2026)

This section captures changes from a long working session (Apr 30 → May 1) that re-shaped the rendering target, the worker, the backdrop, the label injection policy, and several UX surfaces. **Read this first — anything below this section that contradicts it is superseded.**

### 1. Square 1:1 + 4K lanczos upscale — universal output spec

All shot types now render **1:1 square at 2048×2048 native** (Seedream side), then are upscaled to **4000×4000 via sharp `lanczos3`** before being saved as deliverables. The previous 9:16 / 3:4 mixed-aspect output is gone.

Key code points:
- `src/lib/config.ts` — every entry in `shotConfig` has `aspect: '1:1'`. M04 deps cleared so M03 and M04 run in parallel (no longer dependent).
- `src/lib/pipeline/seedream-client.ts` — `aspectRatio` typed `'9:16' | '3:4' | '1:1'`; `aspectToSize` includes `'1:1' → '2048x2048'`.
- `src/app/api/generate/route.ts` — after Seedream returns, sharp upscales to 4000×4000 with `lanczos3` and saves as the deliverable.
- `src/lib/pipeline/deliverable-format.ts` — PDP/PLP variants use `margins: 0` and `fit: 'cover'` (not `contain`) so the 4K master fills the deliverable canvas edge-to-edge with no white border.

Why this matters: G-Star.com PDP serves square crops. Earlier portrait outputs forced a downstream PDP/PLP padding step that never matched the brand. Square + 4K + cover-fit is now the brand-aligned default for every shot.

### 2. Brand-spec studio backdrop — `gs://gstar-ai-studio-assets/refs/G-STAR_BG_brand-spec.jpg`

Single reference JPG used as **slot 0** of the Seedance reference array for M03, M04, M06 (and any new full-body archetype). The image is a **smooth, noise-free** sweep:
- Average hex `#D9DAD2`
- Vertical gradient `#DADBD3` (top) → `#D7D8D0` (floor)
- 5500K white balance, soft contact shadow under feet
- **Zero pixel noise** — earlier versions had ±0.5/255 random noise to "look photographic"; Seedance amplified the noise into floor texture and produced "dirty floor" across all shots. Final asset is mathematically smooth.

Slot-0 placement (the very first ref) is what makes Seedance treat it as the dominant scene reference. Putting it in any later slot gave inconsistent backdrop adoption.

Prompt language is also explicit: `single continuous smooth sweep of neutral cool light-grey (averaging hex #D9DAD2, with a subtle natural studio falloff from #DADBD3 at the top of the frame to #D7D8D0 at the floor)` — copy this string verbatim if drafting new full-body shot prompts.

### 3. Per-shot parallel architecture (`runningShots` Map + dynamic key pool)

The worker at `src/app/api/jobs/process-queue/route.ts` no longer checks out keys per **job** — it now checks out keys per **shot**, via an in-memory `runningShots: Map<shotId, KeyAssignment>`.

Implications:
- Multiple shots from the same job can run concurrently across different BytePlus + Gemini keys.
- Roughly **3× speedup per job** with 3 BytePlus keys and 3 Gemini keys.
- Stalled shots leak `runningShots` entries — there's a TTL-style sweep, but a manual flush is sometimes needed if Cloud Run gets stuck. (Watch for shots showing `running` in Firestore but no recent log activity.)

**Dynamic key pool** — `loadKeyPool()` reads env at runtime:
- BytePlus: `BYTEPLUS_API_KEY` (no suffix), `BYTEPLUS_API_KEY_2`, `BYTEPLUS_API_KEY_3`, …
- Gemini: `GEMINI_API_KEY` (no suffix), `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, …
- The **no-suffix slot must always be set**. Three direct fallback consumers — `translate.ts` and two paths in `vertex.ts` — read `process.env.GEMINI_API_KEY` directly. When migrating/rotating keys, **always promote the keeper to the no-suffix slot** before retiring the old one.

**Per-Google-Cloud-project Gemini limits** — Gemini rate limits are per Cloud project, not per API key. To get more parallelism on Gemini you need to provision keys in **different Google Cloud projects**, not multiple keys in the same project.

**Cloud Run resources required**: `cpu=2, memory=2Gi`. The previous `cpu=1, memory=1Gi` saturated under 3 concurrent pipelines and stalled the worker mid-shot. Always deploy with `--cpu=2 --memory=2Gi` for the parallel worker.

### 4. Label library at `/labels` — three-tier transparency + auto-padding

New page at `src/app/labels/page.tsx`. Backed by `labelAssets` Firestore collection. Stores PNG label templates with these guarantees on upload (handled by `src/app/api/label-assets/route.ts` and `[id]/route.ts`):

- **Three-tier transparency handling** — uploaded PNGs are analysed by `sharp.metadata().channels` and processed:
  - **Tier 1 — already alpha-clean**: passed through.
  - **Tier 2 — has alpha but white-on-white margins**: alpha mask refined by luminance threshold.
  - **Tier 3 — opaque RGB JPEG-style**: chroma key the white background to alpha, then refine.
- **Auto-padding** — `src/lib/label-padding.ts → padLabelForSeedance()` resizes the label so its tightest content bounding box occupies **~16% of a square canvas** (the rest is transparent padding). This gave Seedance the most consistent label rendering at the right scale; tighter packing made labels too dominant and bled into surrounding fabric.

Wardrobe items now have `leatherLabelTemplateId` + `pocketLabelTemplateId` dropdowns (in `/wardrobe`) plus a `labelReady` badge. Resolver `resolveLabelAssetUrls()` in `firestore.ts` returns `{leatherUrl, pocketUrl}` with template precedence over legacy direct fields.

### 5. M05 NO LABELS policy — labels are post-generation only

**M05 never receives leather or pocket label images as Seedream references.** This is enforced in `seedream-generate.ts` — the `seedreamM05` codepath drops both label refs from the array before the API call.

Why: M05 (mid-body / waistband-focus) is the shot type where Seedream most aggressively hallucinated leather labels onto wrong materials, wrong positions, or wrong garments. The fix is to render M05 **clean** and apply both leather AND pocket labels post-generation via the **manual warp tool** with a deterministic 4-corner homography.

**Pocket labels = warp tool only, always**, on every shot. Even on M03/M04 the pocket label is a warp-tool overlay, not a Seedream ref. Pocket-label position is too specific (centre of back-right pocket, exact pocket top-edge) to leave to a generative model.

### 6. Tee-edit retry + UI failure badge

`src/lib/pipeline/seedream-tee-edit.ts` now does a **2-attempt retry with 3-second delay** between attempts. The shot doc stores an `error` field if both attempts fail, and `src/app/jobs/[id]/results/page.tsx` shows a small badge on the shot tile so it's visible without opening the detail panel.

Note: tee-edit is automatically skipped on Seedream 5.0 shots (5.0 handles tucked-in tops natively — `needsTeeEdit()` returns false).

### 7. M01 / M02 fast re-crop endpoint — `/api/shots/[id]/recrop`

New endpoint at `src/app/api/shots/[id]/recrop/route.ts`. Lets the user re-cut M01 (chest/elbow crop) or M02 (waist crop) from the **already-rendered** parent (M03 for M01, M04 for M02) without re-invoking Seedream or Gemini. The button is wired into `/jobs/[id]/results` in the M01/M02 shot panels.

Why this matters: cropping is fast (sharp only) and free; re-running Seedream is slow + costly. When the operator wants a slightly different crop framing, this is now a one-click operation that reuses the parent.

`elbow-crop.ts` was also updated:
- Square output anchored to the **bottom** of the strip (preserves the floor line from the parent).
- `HEADROOM_LIFT = 0.05` — M01/M02 crops sit 5% higher in the frame so more space is visible above the waistband.

### 8. Version threading — worker now passes `version` per shot

Earlier, the worker did NOT pass the `version` field when writing shot results, so re-runs would silently overwrite the version-history entry of the previous run. Fix is a 3-line worker change: thread the resolved version through the write path. Verify with the version-history widget in the results page — each rerun should now produce a new history row, not overwrite the last.

### 9. UI cleanups

- **Comments section removed** from `/jobs/[id]/results` page (was unused).
- **Shell** (`src/components/Shell.tsx`): added `Labels` nav entry; removed `Learning` (404'd).
- **Tee-edit failure badge** on results page (see §6).

### 10. Where each major change lives (file map)

| Concern | File |
|---|---|
| Aspects + shot dependency graph | `src/lib/config.ts` |
| Seedream client + model resolution | `src/lib/pipeline/seedream-client.ts` |
| Backdrop ref + M05 label drop + top rewrite | `src/lib/pipeline/seedream-generate.ts` |
| Tee-edit retry + skip-on-5.0 | `src/lib/pipeline/seedream-tee-edit.ts` |
| Square + headroom-lift crop | `src/lib/pipeline/elbow-crop.ts` |
| PDP/PLP cover-fit | `src/lib/pipeline/deliverable-format.ts` |
| Label auto-padding | `src/lib/label-padding.ts` |
| Per-shot worker + dynamic key pool | `src/app/api/jobs/process-queue/route.ts` |
| 4K lanczos upscale | `src/app/api/generate/route.ts` |
| Label uploads + 3-tier alpha | `src/app/api/label-assets/route.ts` + `[id]/route.ts` |
| M01/M02 recrop endpoint | `src/app/api/shots/[id]/recrop/route.ts` |
| `/labels` UI | `src/app/labels/page.tsx` |
| Wardrobe label dropdowns + badge | `src/app/wardrobe/page.tsx` |
| Results page (recrop + badge + comments removed) | `src/app/jobs/[id]/results/page.tsx` |
| Nav entries | `src/components/Shell.tsx` |

### 11. M06 alternative prompt — Effortless Natural Stance

A new M06 archetype matching the G-Star "Judee Loose Jeans" reference: model in a quiet natural standing pose, **both arms relaxed at sides** (NOT in pockets, NOT on hips), subtle ~5° body angle, top hem **untucked** over the trouser waistband. Catalog-style energy, not editorial.

Persisted prompt: `/sessions/gifted-kind-gates/mnt/gstar/M06_effortless_natural_stance_prompt.md`. This is the source of truth for the Effortless Natural Standing pose archetype — copy/paste it into the prompt vault when promoting it from draft to live.

### 12. Cross-cutting prompt rules learned this session

- **Anti-X is dangerous**: named-category prohibitions ("no cargo pockets") trigger Seedance to think about the named category. Prefer **positive visual descriptions** of what should be there.
- **Material-agnostic language**: avoid garment-specific terms ("denim", "yoke", "wash", "crotch seam") in pose archetypes; defer to the silhouette PART A + PART B for material/construction specifics.
- **Top-ref scoping**: when injecting top reference photos, instruct the model to use them EXCLUSIVELY for top color/fabric/neckline/sleeve/silhouette and **explicitly not** for any other garments visible in those styling photos. Bruno saw a "kaki tee" bleed-through this way; the fix is verbose scoping language in the top section.
- **FLOOR PRINCIPLE**: the floor in M01/M02 crops MUST be inherited from the parent, not invented. `cropWaistFromFullBody` is anchored to the bottom of the strip for this reason.

### 13. Deploy command (current)

```bash
gcloud builds submit --tag gcr.io/gstar-ai-studio/gstar-studio:latest && \
gcloud run deploy gstar-studio \
  --image gcr.io/gstar-ai-studio/gstar-studio:latest \
  --region us-central1 \
  --cpu=2 --memory=2Gi \
  --allow-unauthenticated
```

The `--cpu=2 --memory=2Gi` flags are **mandatory** for the parallel worker. Without them the worker stalls under 3 concurrent pipelines.

---

## Recent Architecture (April 30, 2026)

This section captures changes from a long working session that touched the M04 prompt, Seedream model selection, label asset library, and the silhouette analysis pipeline. **Read this first before touching any of those areas — earlier sections of this file may describe state that has been superseded.**

### 1. Seedream 5.0 Lite added alongside 4.5 — env-var configurable

The app supports two BytePlus models behind one code path:
- `seedream-4-5-251128` (Seedream 4.5, current production default)
- `seedream-5-0-260128` (Seedream 5.0 Lite, released Feb 2026 — cheaper at $0.035/image, slightly slower ~100s vs ~50s)

**Selection precedence** (in `seedream-client.ts`):
1. `params.model` (per-call override)
2. `SEEDREAM_MODEL` env var
3. Hardcoded fallback: `seedream-4-5-251128`

**Per-shot override at job level**: `shot.seedreamModel` field is read first, then `job.seedreamModel`, then env var. The `/api/shots/[id]/rerun-with-seedream-5` and `/api/jobs/[id]/rerun-with-seedream-5` endpoints set this field.

**Helper exports** in `seedream-client.ts`:
- `SEEDREAM_MODEL_4_5` and `SEEDREAM_MODEL_5_0` constants
- `isSeedream5(model?)` — returns true if the resolved model is in the 5.0+ family
- `resolveSeedreamModel(override?)` — resolves the active model

**Why this matters for the tee-edit pipeline:**

`needsTeeEdit(shotType, seedreamModel?)` in `seedream-tee-edit.ts` returns `false` when the shot was generated by 5.0+. 5.0 handles tucked-in tops natively without the body-seam artifact that 4.5 produces, so the Gemini tee-edit pass is unnecessary. `rewriteTopForSeedream()` in `seedream-generate.ts` ALSO checks `isSeedream5()` and passes the real Opus top description (not the "simple black sports bra" placeholder) when 5.0 is active.

**UI behavior:**
- Job-level "Rerun with Seedream 4.5" button (purple) — uses the env-var default model. **Always clears `shot.seedreamModel` field via `FieldValue.delete()`** so stale per-shot 5.0 overrides don't bleed through (this was a bug fixed April 30; if jobs still come out as 5.0 after a 4.5 rerun, that's the smell — make sure the field-delete is in the batch update).
- Per-shot "Rerun with Seedream 5.0" button (emerald, in shot detail panel) — flips just one shot to 5.0. M01/M02 reroute to their parent anchor (M03/M04) since crops inherit.
- Job-level "Rerun with Seedream 5.0" endpoint exists but is intentionally NOT exposed in the UI (per Bruno: jobs default to 4.5; 5.0 is per-shot only).

### 2. Label asset library (`labelAssets` Firestore collection)

Photo-based label templates separate from the legacy three-tier deboss-synthesis system. One canonical PNG per template, alpha-masked to remove white backgrounds.

**Currently 4 templates** (in collection `labelAssets`):
- `light-brown` (leather, back-waistband — default for most G-Star jeans)
- `back-label-black` (leather, back-waistband — for black-leather variants e.g. CONTOR EXTREME)
- `black-yellow` (woven pocket patch)
- `black-white` (woven pocket patch)

**Storage**: `gs://gstar-ai-studio-assets/label-assets/{leather|pocket}/{templateId}.png`

**Wardrobe item fields** (added April 28-30):
- `leatherLabelTemplateId?: string` — points to a labelAsset doc id
- `pocketLabelTemplateId?: string` — points to a labelAsset doc id (optional, only some jeans have)
- `leatherLabelImageUrl?: string` (legacy) — direct URL to a per-item label JPEG, kept for back-compat

**Resolver helper**: `resolveLabelAssetUrls(focusItem)` in `firestore.ts` returns `{leatherUrl, pocketUrl}` with this precedence: `leatherLabelTemplateId → labelAssets/{id}.imageUrl`, falls back to legacy `leatherLabelImageUrl`. Pocket has no legacy field (always template-only).

**Used by**:
- `seedreamM04` and `seedreamM05` push leather + pocket label images as Seedance reference images (visual-ref dominance for label fidelity)
- `/api/label/preview` route: when no three-tier config exists for a style, serves the leather label image directly to the warp picker
- `/api/shots/[id]/apply-label`: passthrough mode warps the leather JPEG/PNG onto the shot when no three-tier config exists

### 3. Manual warp tool — passthrough fallback

For wardrobe items with no three-tier `labelStyles`/`labelColorways` config, the warp tool now works via passthrough mode instead of returning 404.

- New Python mode in `scripts/label_hybrid.py`: `run_passthrough(args)` — thin wrapper around `run_woven` that warps a pre-rendered label image (no synthesis, no deboss shader). Edge feathering + luminance match + drop shadow are reused from the woven path.
- New TS helper in `lib/label-hybrid.ts`: `applyPassthroughLabel(imageBuffer, corners, labelImageUrl)` — downloads the label asset, spawns Python in passthrough mode.
- Preview route + apply-label route both check `resolveLabelAssetUrls(focusItem)` when no three-tier config; if a leather URL is found, they use the passthrough path. Apply-label `pathUsed` adds new value: `'v3-passthrough'`.
- 8-point midpoint warp is silently downgraded to 4-point in passthrough (woven path is 4-point only). Picker UI still works.

### 4. Silhouette analysis prompt — PART A + PART B structure

Updated `silhouette.ts` so Opus generates silhouette text with TWO labelled parts in section 5 (HEM-TO-GROUND RELATIONSHIP):
- **PART A (observed)** — barefoot ground-relative position. e.g. "extends to the floor with visible fabric piling".
- **PART B (production translation)** — explicit instruction for how the rendered shot should differ when the model wears shoes. e.g. "production hem rendered slightly LONGER than barefoot reference so fabric still pools on floor over shoes".

The previous prompt EXPLICITLY FORBADE describing floor contact. That was wrong — it deprived the generation prompt of per-garment ground-relationship signal. Re-analyzed all 26 bottom items with the new prompt on April 30. Backups stored on each wardrobe doc as `silhouetteFrontBackup_2026apr29` / `silhouetteBackBackup_2026apr29`.

### 5. M04 prompt rev 28.12 — FLOOR-anchored LENGTH PRINCIPLE

Active rev 28.12 (`m04-rev28-12-final-appearance-and-length-definition.md`). Three structural improvements over rev 28.4:
- **Reference rule scoping** (Issue 2): Fit-model photos are SOURCE OF TRUTH for body proportions, pose geometry, garment SHAPE — but NOT for absolute hem height. Production model wears shoes which weren't in fit-model photos, so length is adjusted.
- **LENGTH PRINCIPLE — PRIMARY INSTRUCTION** (Issue 3a, FLOOR-anchored): 5-point numbered list anchored to FLOOR as absolute reference. "Hem must end exactly at floor level" in both barefoot reference state and shod production state.
- **FINAL APPEARANCE block** (Issue 3b): paragraph at end of Hem & Footwear describing the desired final-state composition.

**Critical bug fixed in 28.7**: Earlier rev 28.4 had `{silhouette}` placeholder TWICE in the template (Garment section + Hem & Footwear closing line). JS `prompt.replace('{silhouette}', X)` replaces only first occurrence — left a literal `{silhouette}` token in the prompt body. Rev 28.7 removed the second placeholder.

**Foot-landmark swap** (rev 28.6): Pose section's geometric landmark changed from "ankle" to "foot" — was creating impossible-constraint conflict where strict pose required ankle visibility while cascade-over-shoe required ankle coverage.

### 6. Anti-X anti-pattern (institutional knowledge)

See `~/Documents/Claude folder.nosync/gstar/jeans-over-shoes-retrospective.md` for the full retro. Short version:

**When Seedream produces a wrong output, do NOT add prompt language that forbids the wrong behavior.** The model treats prohibitions as activations of the prohibited subject. "shoes hidden behind cascading hem" makes Seedance render prominent shoes piercing the hem.

**Always rephrase as positive description of desired behavior.** "Fabric falls over and around the shape of the shoes, draping softly to cover the ankle, heel, and topline" works. "shoes are not visible above the sole line" doesn't.

External reviewers (Doubao, etc.) repeatedly suggest negative-prompt content. Reject it — Seedream 4.5 has no separate `negative_prompt` API parameter (verified via web search and BytePlus docs). Inline negation goes into the main prompt and triggers the trap.

### 7. Wardrobe page changes

- **Sorted by `createdAt` ASC** (oldest first, newest last). `listWardrobeItems` adds `.orderBy('createdAt', 'asc')`. All 66 current docs have `createdAt` set; new uploads always write it.
- **Label-readiness badge on bottoms only**. Computed server-side in `/api/wardrobe`: green "Label ✓" if `leatherLabelTemplateId` is set OR a labelStyles doc exists for the parsed styleCode; amber "Label needed" otherwise. Field name on response: `item.labelReady: boolean | undefined` (undefined for non-bottoms).

### 8. Bug fixes worth knowing about

- **`seedreamModel` field not cleared on 4.5 rerun**: A shot that was previously rerun with 5.0 had `shot.seedreamModel='seedream-5-0-260128'` set. Job-level "Rerun with Seedream 4.5" updated `provider='seedream'` but didn't clear `seedreamModel`, so per-shot field won precedence over env var — shot regenerated with 5.0 anyway. Fixed by adding `seedreamModel: FieldValue.delete()` to the batch update in `/api/jobs/[id]/rerun-with-seedream/route.ts`. **If you ever see "I picked 4.5 but got 5.0" again, check whether the rerun endpoint is clearing `seedreamModel`.**
- **Broken `{silhouette}` placeholder in Hem & Footwear closing**: see #5 above.
- **AVIF wardrobe images rejected by BytePlus**: `seedream-image-safe.ts` `isSeedreamFormat` reads first 32 bytes to check magic bytes (FF D8 FF for JPEG, 89 50 4E 47 for PNG). On non-JPEG/PNG, triggers conversion to `_seedream.jpg` sibling.

## Tech Stack

- **Framework**: Next.js 16 (App Router) with React 19, TypeScript, Tailwind CSS
- **AI**: Gemini 3.1 Flash for image generation, Gemini 2.5 Flash Lite for QC scoring
- **Image processing**: Sharp (resize, composite, blur, background sampling), Python/OpenCV (label composite)
- **Database**: Firestore (collections: users, models, jobs, shots, wardrobe, modifications, promptAdjustments, otpCodes)
- **Storage**: Google Cloud Storage (garment images, generated shots, dressed bases)
- **Auth**: NextAuth with OTP email (domain-restricted to @gstar-raw.com)
- **Deploy**: Cloud Run (europe-west1), Dockerfile with standalone Next.js output
- **Tests**: Vitest (103 tests across 5 test files)

## Project Structure — Key Files

```
gstar-studio/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── generate/route.ts          ← MAIN: job shot generation (two-phase pipeline, v38 front/back isolation)
│   │   │   ├── models/
│   │   │   │   ├── generate-dressed/route.ts   ← Dressed base generation (single view)
│   │   │   │   ├── generate-dressed-all/route.ts ← SSE: all 4 dressed base views server-side
│   │   │   │   ├── generate-card/route.ts  ← Model card (identity reference) generation
│   │   │   │   ├── batch-redress/route.ts  ← Batch re-generate dressed bases
│   │   │   │   └── [id]/route.ts           ← Model CRUD
│   │   │   ├── jobs/
│   │   │   │   ├── route.ts                ← Job creation + worker kick (respond-then-fire pattern)
│   │   │   │   ├── process-queue/route.ts  ← Worker: processes generation queue sequentially
│   │   │   │   ├── [id]/run-all/route.ts   ← Enqueue + kick worker (respond-then-fire pattern)
│   │   │   │   ├── [id]/route.ts           ← Job CRUD
│   │   │   │   └── [id]/clone/route.ts     ← Clone job
│   │   │   ├── qc/route.ts                ← QC scoring endpoint
│   │   │   ├── shots/[id]/approve/route.ts ← Shot approval
│   │   │   ├── wardrobe/route.ts           ← Wardrobe CRUD
│   │   │   ├── auth/                       ← OTP auth flow
│   │   │   └── seed/route.ts               ← DB seeding
│   │   ├── models/[id]/page.tsx            ← Model detail page (dressed bases UI)
│   │   ├── jobs/[id]/results/page.tsx      ← Job results page (shot review)
│   │   ├── jobs/new/page.tsx               ← New job wizard
│   │   ├── wardrobe/page.tsx               ← Wardrobe management
│   │   └── dashboard/page.tsx              ← Main dashboard
│   ├── lib/
│   │   ├── config.ts          ← Shot descriptions (M01-M05), app config, aspect ratios
│   │   ├── prompts.ts         ← ANTI_AI_RULES, ANTI_HALLUCINATION, posing rules, styling rules
│   │   ├── vertex.ts          ← Gemini API client (REST, not Vertex AI SDK)
│   │   ├── firestore.ts       ← All Firestore operations, collection refs, typed helpers
│   │   ├── gcs.ts             ← GCS upload/download helpers
│   │   ├── garment-dna.ts     ← Extracts garment DNA (color, wash, fabric) from images via Gemini
│   │   ├── label-composite.ts ← TypeScript wrapper for Python label composite (Gemini corner detection + subprocess)
│   │   ├── zone-grids.ts      ← Panoramic strip generation — v38 front/back isolated strips
│   │   ├── zone-detection.ts  ← Detects garment zones in images
│   │   ├── wardrobe-hash.ts   ← Deterministic hash of wardrobe combo for dressed base lookup
│   │   ├── drive.ts           ← Google Drive integration
│   │   └── email.ts           ← OTP email sending (nodemailer)
│   ├── types/index.ts         ← All TypeScript interfaces (User, Job, Shot, Model, WardrobeItem, etc.)
│   └── __tests__/             ← 5 test files, 103 tests total
├── scripts/
│   └── label_composite.py     ← Python/OpenCV label extraction + compositing (called by label-composite.ts)
├── Dockerfile                 ← Multi-stage build → standalone Node.js + Python/OpenCV
├── .gcloudignore              ← MUST NOT exclude scripts/ or *.py (label pipeline needs them)
├── .dockerignore              ← MUST NOT exclude *.py
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## Generation Pipeline

### Dressed Bases (pre-rendered model references)

Before generating job shots, each model needs **dressed bases** — 4 views (front, right, back, left) of the AI model wearing the wardrobe outfit. These serve as identity + outfit anchors for all subsequent shots.

**Endpoint**: `POST /api/models/generate-dressed` (single view)
**Bulk endpoint**: `POST /api/models/generate-dressed-all` (SSE stream, all 4 views)

Each dressed base:
1. Collects wardrobe item images as references
2. Builds a prompt with view-specific pose instructions (VIEW_POSES)
3. Generates via Gemini 3.1 Flash (2K resolution)
4. Runs QC via Gemini 2.5 Flash Lite (threshold 7.0, max 2 attempts)
5. Post-processes with Sharp: foot resize detection + Gaussian blur seam blending
6. Stores in GCS with Firestore metadata (linked by modelId + wardrobeHash + view)

**Foot resize logic** (in generate-dressed/route.ts):
- Checks bottom 12% of image for oversized feet
- Samples actual background color from bottom 10x10 corner pixels
- Edge detection zone covers bottom 15% — if >10% non-background pixels found, skips resize
- When resize runs: scales bottom 12% to 75% width, centers it, blends with 6px Gaussian blur band

### Job Shots (the 5 final e-commerce images)

**Endpoint**: `POST /api/generate` (single shot)
**Bulk endpoint**: `POST /api/jobs/[id]/run-all` (enqueues job + kicks worker)

5 shot types per job:

| Shot | Description | Aspect | Phase 1 | Notes |
|------|-------------|--------|---------|-------|
| M03 | Full body front | 9:16 | Flash (2K) | Generated FIRST as garment anchor. v38: 3 front angles only |
| M01 | Cropped front (waist to ankle) | 3:4 | Flash (2K) | No model card ref (would defeat crop) |
| M02 | Cropped back | 3:4 | Flash (2K) | Uses back dressed base, LABEL COMPOSITE applied |
| M04 | Full body back | 9:16 | Flash (2K) | Uses back dressed base, LABEL COMPOSITE applied. v38: 3 back angles only |
| M05 | Detail shot (back pocket close-up) | 3:4 | Flash (2K) | Uses back dressed base, tight crop |

**Two-phase pipeline** (for full-body shots M03/M04):
- **Phase 1** (Gemini Flash, 2K): Generates garment template from flat + fit model references. View-specific: front shots get FRONT VIEW CONSTRUCTION prompt block, back shots get BACK VIEW CONSTRUCTION block.
- **Phase 2** (Gemini Flash, 2K): Combines garment template with model identity from dressed base. View-specific construction details in prompt.

**For cropped shots** (M01/M02): Single phase, no model card, generates anonymous model wearing garment.
**For detail shot** (M05): Single phase, tight close-up of one back pocket. Gets M03 garment template as color lock + color anchor fit model.

### v38 Front/Back Reference Isolation (CRITICAL ARCHITECTURE)

The generation pipeline fully isolates front and back references to prevent cross-contamination. This was the key fix for M04 (full body back) quality — front seam details were bleeding into back generation.

**Symmetric 3-angle isolation** — both front and back get exactly 3 fit model angles at 2000px:

| | Back shots (M02, M04, M05) | Front shots (M01, M03) |
|---|---|---|
| **Fit model angles** | 3 back angles (center ±1, typically indices 3,4,5) at 2000px | 3 front angles (indices 0, 1, last) at 2000px |
| **Flat image** | Flat BACK at 2000px (front flat SKIPPED) | Flat FRONT at 2000px (back flat SKIPPED) |
| **Panoramic strips** | Back flat + 3 back angles = 4 panels at 1200px height | Front flat + 3 front angles = 4 panels at 1200px height |
| **Phase 1 prompt** | BACK VIEW CONSTRUCTION block | FRONT VIEW CONSTRUCTION block |
| **Phase 2 prompt** | Back panel seams, yoke, pocket arcs | Front pockets, fly, rivet placement |
| **Fit model description** | "3 back-view fit model angles + 1 flat back image" | "3 front-view fit model angles + 1 flat front image" |

**Why this matters**: Gemini was picking up front seam patterns from front fit model images and hallucinating them onto back views. Full isolation means back shots see ZERO front references, and front shots see ZERO back references. Each view gets maximum resolution (2000px) because fewer images = more pixel budget per image.

**Reference image labels are view-specific**:
- Back angles get: `BACK CONSTRUCTION REFERENCE — back panel seam lines, pocket shapes, yoke construction, diagonal seams below knee...`
- Front angle 0 gets: `FRONT COLOR ANCHOR — DEFINITIVE WASH/COLOR REFERENCE...`
- Other front angles get: `FRONT CONSTRUCTION REFERENCE — fabric drape, silhouette, front pocket placement...`

**Version history**:
- v37: First front/back isolation — back shots got 3 back angles at 2000px, front shots got ALL 8 angles at 1200px. M04 improved but M03 broke (Gemini lost garment context with only 3 front angles at first attempt).
- v37b: Asymmetric fix — back stayed isolated (3 angles), front reverted to all 8 angles. Stabilized both M03 and M04.
- v38: Symmetric isolation — BOTH front and back get 3 angles at 2000px. Front uses indices 0, 1, last (front-facing views). Fewer angles + higher resolution = better fidelity for both views.

### Panoramic Strips (zone-grids.ts)

Panoramic strips are horizontal concatenations of cropped zone regions (waist, knee, ankle) from fit model images + flat images. They give Gemini a zoomed-in 360° view of construction details per zone.

**v38 architecture**:
- Both front and back shots get 4 panels per strip: 1 primary flat crop + 3 fit model angle crops
- Panel height: 1200px (high resolution since only 4 panels vs old 10-panel strips)
- Back shots: back flat + 3 back angles (no front flat, no front angles)
- Front shots: front flat + 3 front angles (no back flat, no back angles)
- `generatePanoramicStrips()` receives `null` for the irrelevant flat buffer based on shot type
- `concatenateHighRes()` accepts configurable `maxPanelHeight` parameter (default 600, panoramic uses 1200)

### Worker Kick Pattern (respond-then-fire)

Both `jobs/route.ts` and `jobs/[id]/run-all/route.ts` use a respond-then-fire pattern:

```typescript
// Build the response FIRST
const response = NextResponse.json({ success: true, jobId, shotsCreated: shotIds.length });

// Fire worker kick AFTER building response — don't await it
fetch(`${getInternalBase()}/api/jobs/process-queue`, { method: 'POST' })
  .then(res => console.log(`[Job] Worker kick response: ${res.status}`))
  .catch(err => console.warn(`[Job] Worker kick failed (non-blocking):`, err));

return response;
```

**Why this specific pattern**: Cloud Run kills fire-and-forget requests when the handler returns. Awaiting process-queue blocks for minutes (generation time), causing the frontend to hang on "Submitting...". The respond-then-fire pattern works because the internal fetch creates a new request that keeps the container alive independently.

**THIS HAS CAUSED BUGS 3 TIMES. Never change this pattern without understanding the implications:**
1. `await fetch(process-queue)` → frontend hangs for minutes (Submitting... bug)
2. Fire-and-forget without response → Cloud Run kills the process
3. Only correct: build response → fire kick → return response

### Server-Side Generation (Queue-Based)

- `POST /api/jobs` creates job + enqueues + kicks worker (respond-then-fire)
- `POST /api/jobs/[id]/run-all` enqueues job + kicks worker (respond-then-fire)
- `POST /api/jobs/process-queue` is the worker that processes the queue sequentially
- Queue stored in Firestore document: `system/generationQueue`
- Frontend polls job status — tab can be closed, Cloud Run continues
- Internal API calls use **localhost loopback**: `http://localhost:${PORT}`

## Label Composite Pipeline (Python/OpenCV)

Back shots (M02, M04) need the REAL G-Star leather label composited onto AI-generated images. Gemini hallucinates labels, so we extract the real one from mannequin photos and composite it with Photoshop-quality results.

### Architecture: Two-Layer System

1. **TypeScript wrapper** (`src/lib/label-composite.ts`):
   - Downloads source/target images from GCS to temp files
   - Calls Gemini (`detectLabelCorners()`) to find 4 corner points of the label area in the generated image
   - Spawns Python subprocess with paths + corners JSON
   - Parses JSON result from stdout, cleans up temp files

2. **Python script** (`scripts/label_composite.py`):
   - All OpenCV pixel operations: HSV detection, GrabCut, perspective warp, blending
   - Three commands: `extract`, `composite`, `full` (extract + composite in one call)
   - Outputs JSON to stdout, logs to stderr

### Label Extraction (from mannequin image)

1. **HSV Color Detection** — Three overlapping ranges to find brown/tan leather pixels:
   - Range 1: H 8-25, S 40-200, V 60-200 (core brown)
   - Range 2: H 0-8, S 30-180, V 80-210 (reddish leather)
   - Range 3: H 20-35, S 25-150, V 100-220 (tan/light leather)
   - Combined with morphological close (15x15 kernel) to fill gaps

2. **Contour Selection** — Finds largest leather-colored contour by area (minimum 500px²)

3. **GrabCut Segmentation** — Pixel-perfect isolation with alpha transparency:
   - Initialized with bounding rect from contour + 8% padding (tighter than default)
   - 7 iterations of GrabCut refinement
   - **Leather mask constraint**: Only keeps pixels that match leather HSV ranges (dilated 7x7, 2 iterations)
   - Morphological cleanup: erode(1) → close(2) → open(1) → GaussianBlur(5x5)
   - Saves RGBA PNG with transparent background

### Label Compositing (onto generated image)

1. **Inpainting** — Removes Gemini's hallucinated label BEFORE compositing:
   - Dilates the target mask (7x7 kernel, 2 iterations) for coverage
   - `cv2.inpaint()` with TELEA algorithm, radius=5
   - This prevents color bleeding from the hallucinated label underneath

2. **Perspective Warp** — Maps extracted label to detected corner positions:
   - 4-corner homography via `cv2.getPerspectiveTransform()`
   - Corners come from Gemini `detectLabelCorners()` in the TypeScript layer
   - Warp flags: `cv2.INTER_LANCZOS4` for quality

3. **Alpha Blend with Gaussian Edge Feathering** — Natural integration:
   - Erodes mask by 1px (3x3 kernel) to avoid hard edges
   - Gaussian blur on mask edges: radius = max(3, min(width,height) * 0.004), must be odd
   - Normalized feathered mask [0,1] as 3-channel float
   - `result = warped * mask + clean_target * (1 - mask)`
   - **NOT seamless clone** — Poisson blending was washing out label colors

### Why NOT Seamless Clone (cv2.seamlessClone)

We tried seamless clone twice and it failed both times:
- **V1**: Without inpainting → orange color bleeding from hallucinated label underneath
- **V2**: With inpainting → Poisson blending still shifted label gray/brown to match surrounding denim blue
- Alpha blending with Gaussian feathering preserves exact label colors while blending edges naturally

### Integration Points in generate/route.ts

- **Section "3-LABEL"**: Extracts label from mannequin back view (angle index = totalAngles/2)
- **Section "POST-PROCESS 5"**: Composites real label onto generated back shots (M02, M04)
- The mannequin back view URL is pulled from the wardrobe item's `angles` array

## Prompt Conventions

Key prompt building blocks in `src/lib/prompts.ts`:
- `ANTI_AI_RULES` — Prevents AI-looking artifacts (plastic skin, symmetric faces, etc.)
- `ANTI_HALLUCINATION` — Forces garment fidelity to reference images
- `VIEW_POSES` — View-specific pose instructions (front relaxed, back 3/4 turn, etc.)
- `STYLING_RULES` — G-Star brand styling (raw denim aesthetic, urban, minimal)

Prompts reference images by index: `"image 1 shows the flat lay, image 2 shows the mannequin front..."` — order matters and must match the images array passed to Gemini.

**v38 view-specific prompt blocks** (in generate/route.ts Phase 1):
- `CRITICAL — BACK VIEW CONSTRUCTION:` block for back shots — emphasizes back panel seam lines, yoke seams, pocket arcs, diagonal seams below knee
- `CRITICAL — FRONT VIEW CONSTRUCTION:` block for front shots — emphasizes front pocket shapes, fly stitching, rivet placement, front panel seams
- Fit model description changes per view: back says "3 back-view fit model angles + 1 flat back image", front says original rotating description

**v38 view-specific prompt blocks** (in generate/route.ts Phase 2):
- Back: "back panel seam lines, yoke seams, back pocket stitching arcs"
- Front: "front pocket shapes, fly stitching, rivet placement"

## Deploy Commands

**CRITICAL: NEVER deploy without Bruno's explicit permission. He will say "deploy" when ready.**

**From Bruno's Mac** (gcloud not in PATH):
```bash
cd "/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio"
/Users/bdheedene/google-cloud-sdk/bin/gcloud run deploy gstar-ai-studio \
  --source . \
  --region europe-west1 \
  --project gstar-ai-studio
```

**IMPORTANT**: Deploy takes 5-8 minutes. Desktop Commander MCP has a 60s timeout. Two options:

Option 1 — Run in user's terminal (RECOMMENDED):
Tell Bruno to paste the deploy command in his terminal.

Option 2 — Background with nohup (unreliable — gcloud progress output gets buffered):
```bash
cd "/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio" && \
nohup /Users/bdheedene/google-cloud-sdk/bin/gcloud run deploy gstar-ai-studio \
  --source . --region europe-west1 --project gstar-ai-studio \
  > /tmp/gcloud-deploy.log 2>&1 &
```
Then check with `gcloud builds list --project gstar-ai-studio --limit 3` to see build status.

**Cloud Run URL**: https://gstar-ai-studio-674145888056.europe-west1.run.app

## Known Issues & Pitfalls

1. **`.gcloudignore` and `.dockerignore` MUST include `scripts/` and `*.py`** — The label composite pipeline needs `scripts/label_composite.py` in the Docker image. If excluded, label compositing silently falls back to the old Sharp approach (which produces worse results).

2. **Dockerfile must install Python + OpenCV** — The multi-stage build installs `python3`, `python3-pip`, `opencv-python-headless`, and `numpy` in the final image. Without these, `isPythonAvailable()` returns false and the fallback Sharp path runs.

3. **Gemini corner detection can return bad corners** — `detectLabelCorners()` sometimes returns corners outside image bounds or in wrong order (not TL→TR→BR→BL). The Python script validates and clamps corners. If corners are degenerate (zero area), it falls back to center-placement.

4. **GrabCut can fail on low-contrast images** — If the leather label is very similar in color to surrounding fabric (e.g., raw indigo denim), GrabCut may not separate cleanly. The leather HSV mask constraint helps but isn't perfect.

5. **Foot resize can clip legs** — The bottom-12% resize logic assumes feet are in the bottom portion. On some poses where feet are higher, it can clip legs. The edge detection guard (>10% non-background pixels) usually prevents this.

6. **SSE streams and Cloud Run timeouts** — Generation can take 2-5 minutes per shot. Cloud Run's default timeout is 300s. For bulk generation (5 shots), ensure the Cloud Run service timeout is set high enough (currently 600s).

7. **Auth cookies on loopback** — Internal SSE calls to `localhost:${PORT}` must forward the original request's cookies. Without this, the internal endpoints return 401.

8. **Worker kick pattern — DO NOT CHANGE** — The respond-then-fire pattern in `jobs/route.ts` and `run-all/route.ts` has broken 3 times. NEVER `await` the process-queue fetch. NEVER fire-and-forget without building the response first. The ONLY correct pattern: build response → fire kick → return response. See "Worker Kick Pattern" section above.

9. **Front/back reference isolation is asymmetric in impact** — Back shots benefit enormously from isolation (removes front contamination that causes hallucinated seam lines). Front shots are less sensitive but still benefit from higher resolution per image. If M04 back construction looks wrong, check that back shots are getting ONLY back angles and flat back — any front reference leaking in will cause problems.

10. **Codebase path has `.nosync` suffix** — The actual path is `/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio`. The `.nosync` prevents iCloud sync. If deploys or file operations fail with "directory not found", check for this suffix.

11. **gcloud deploy via Desktop Commander is unreliable** — The MCP has a 60s timeout but deploys take 5-8 min. Background nohup processes don't capture gcloud's progress output well (carriage return buffering). Best approach: give Bruno the command to run in his terminal, or use `gcloud builds list` to check status.

## Shot Regeneration

Individual shots can be re-run from the job results page (`/jobs/[id]/results`):
- Each shot card has a "Re-run This Shot" button
- Optional "MODIFICATION INSTRUCTIONS" textarea for prompt tweaks
- Calls `POST /api/generate` with `{ shotId, jobId, modification, originalPrompt: '', version: shot.version + 1 }`
- The shot version increments, previous versions are kept in GCS

## Entities & Data Model (Firestore)

- **User**: email, name, role (admin/user), domain-restricted to @gstar-raw.com
- **Model**: AI person — name, description, model card image URL, dressed bases (4 views × N wardrobe combos)
- **WardrobeItem**: garment — name, category (top/bottom/shoes/accessory), flat image URLs, mannequin angle URLs (360° views), fitModelUrls (fit model photos for reference isolation)
- **Job**: generation task — modelId, wardrobeItemIds, garmentWardrobeId, status (pending/generating/complete/failed), shot results
- **Shot**: individual generated image — jobId, shotType (M01-M05), imageUrl, qcScore, version, approved flag
- **Modification**: prompt adjustment for re-runs — shotId, instructions text, applied flag
- **PromptAdjustment**: global prompt tweaks stored per shot type
- **system/generationQueue**: Firestore document holding the generation queue state

## Cost Awareness

- Gemini Flash (2K): ~$0.01/image — used for ALL generations (Phase 1 and Phase 2)
- Gemini Flash Lite (QC): ~$0.002/call — used for QC scoring
- A full job (5 shots) costs roughly $0.06-0.10 depending on retries
- Dressed bases (4 views): ~$0.04-0.08 per model-wardrobe combo

## URL & Access

- **Production**: https://gstar-ai-studio-674145888056.europe-west1.run.app
- **Dashboard**: /dashboard (main entry, lists all jobs)
- **Auth**: OTP email to @gstar-raw.com addresses only
- **GCS bucket**: `gstar-ai-studio.appspot.com` (default Firebase bucket)
- **Firestore**: project `gstar-ai-studio`, default database

## Codebase Location (Bruno's Mac)

```
/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio/
```

Note the `.nosync` suffix — this prevents iCloud from syncing the directory. All file paths and deploy commands must use this exact path.

## Standard Email for G-Star API Calls

**Use `bruno@fiberandface.com` for ALL Gstar API calls** — `creatorEmail` on `POST /api/jobs`, `uploadedBy` on `POST /api/prompt-vault`, and anywhere else an email is required. NOT `bruno.dheedene@rods-cones.com`.

This is the standard Gstar identity for automated work from this environment.

## Prompt Testing Workflow (no deploy needed)

The vault supports **alternative prompts** — non-active revisions you can test against a real job by passing `alternativePromptId` to `/api/generate`. This is a zero-deploy iteration loop. Use this whenever Bruno asks to "test a new prompt" or "try a new M0x wording".

**The four steps:**

1. **Write the new prompt to a markdown file** (any path). The POST reads the raw `.md` content and auto-extracts the code-fence body as `generationPrompt`.

2. **Upload as alternative** — creates a non-active vault entry:
   ```bash
   curl -X POST https://gstar-ai-studio-674145888056.europe-west1.run.app/api/prompt-vault \
     -F "file=@./drafts/m01-new.md" \
     -F "shotType=M01" \
     -F "uploadedBy=bruno@fiberandface.com" \
     -F "isAlternative=true" \
     -F "label=neutral-stance-v1" \
     -F "pipeline=seedream"
   ```
   Returns `{ id, revision }`. Save the `id` — that's the `alternativePromptId`.

3. **Create a test job** (POST /api/jobs with `creatorEmail: "bruno@fiberandface.com"`, pick a model + wardrobe slots). Or re-use an existing job.

4. **Re-run the shot with the alternative** (shotType is REQUIRED, not optional):
   ```bash
   curl -X POST https://gstar-ai-studio-674145888056.europe-west1.run.app/api/generate \
     -H "Content-Type: application/json" \
     -d '{
       "shotId": "<existing shot id from the job>",
       "jobId": "<job id>",
       "shotType": "M01",
       "alternativePromptId": "<id from step 2>",
       "alternativePromptLabel": "neutral-stance-v1",
       "version": <current version + 1>
     }'
   ```
   The new version renders under the same job/shot slot for A/B compare.

   **Important**: `/api/generate` is long-running (2-4 min per Seedream shot including tee-edit). Fire with `--max-time 20` from curl and let it time out — Cloud Run continues the render. Check completion by polling `GET /api/jobs/[id]` and looking for the shot's `version` to bump and `status` back to `done`.

**Key facts:**
- `alternativePromptId` is already wired in `src/app/api/generate/route.ts` (lines 33, 76-80). Nothing to deploy to use it.
- `isAlternative=true` means it is NOT set as the active vault prompt. Active prompts still render for normal jobs.
- If the test renders well, promote by uploading it again WITHOUT `isAlternative=true` (creates a new active revision).
- If it renders badly, the active prompt is untouched. Just discard the alternative.

**Full-flow helper script (if present):** `scripts/test-prompt.sh` in the repo wraps steps 2-4 with named args. If it exists, use it; if not, the curl recipe above is the source of truth.

### Discovery — Bruno never has IDs at hand

Bruno won't hand you job IDs, shot IDs, or wardrobe IDs. Look them up yourself. What he gives is a description ("test this on the loose contor and the kick cropped"). You translate.

**Public GET endpoints (no auth headers needed, all unauthenticated reads):**
```
GET /api/models                  → list of models (find F4 Alma, etc.)
GET /api/wardrobe                → list of wardrobe items (match garment name/SKU to itemId)
GET /api/jobs?limit=20           → recent jobs (to reuse an in-flight baseline)
GET /api/jobs/[id]               → full job including shot IDs, status per shot, versions
GET /api/prompt-vault?shotType=M01   → current vault entries for a shot type
GET /api/prompt-vault/alternatives?shotType=M01&pipeline=seedream  → alternative prompts
```

**Standard test-job config (use unless Bruno says otherwise):**
- Model: F4 Alma (female neutral, renders cleanly for pose/crop comparisons)
- Pipeline: seedream (gemini is archived)
- Slot 0 and slot 1: whichever two garments Bruno names
- `creatorEmail: "bruno@fiberandface.com"`

**What Bruno specifies → what you do:**

| Bruno says | You do |
|---|---|
| "test this M01 prompt" | Ask which 1-2 garments. Use F4 Alma. Create 1-2 jobs. Wait for baseline M01. Re-run with alternative. |
| "re-run M01 on job X with this prompt" | Pull the existing shot ID from `GET /api/jobs/X`. Upload alternative. Re-run only M01 with `alternativePromptId`. |
| "I want to compare this pose on garment Y" | Look up Y in `/api/wardrobe`, reuse existing job on that garment if one exists (recent, complete baseline), else create fresh. |

**Never ask Bruno for a shot ID or a wardrobe itemId.** Those come from the lookups above.
