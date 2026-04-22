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

## Tech Stack

- **Framework**: Next.js 16 (App Router) with React 19, TypeScript, Tailwind CSS
- **AI**: Gemini 3.1 Flash for image generation, Gemini 2.5 Flash Lite for QC scoring, Seedream 4.5 (BytePlus) as alternative generation backend
- **Image processing**: Sharp (resize, composite, blur, background sampling), Python/OpenCV (leather label composite + woven pocket label composite)
- **Database**: Firestore (collections: users, models, jobs, shots, wardrobe, modifications, promptAdjustments, otpCodes)
- **Storage**: Google Cloud Storage (garment images, generated shots, dressed bases)
- **Auth**: NextAuth with OTP email (domain-restricted to @gstar-raw.com)
- **Deploy**: Cloud Run (europe-west1), Dockerfile with standalone Next.js output, `cloudbuild.yaml` with `--no-cache`
- **Tests**: Vitest (103 tests across 5 test files)

## Project Structure — Key Files

```
gstar-studio/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── generate/route.ts          ← MAIN: job shot generation (two-phase pipeline, v38 front/back isolation)
│   │   │   ├── models/
│   │   │   │   ├── generate-front/route.ts     ← Front identity ref (sports bra/bare torso)
│   │   │   │   ├── generate-back/route.ts      ← Back identity ref from front
│   │   │   │   ├── regenerate-refs/route.ts    ← Batch: front+back for all models
│   │   │   │   ├── generate-dressed/route.ts   ← Dressed base generation (single view)
│   │   │   │   ├── generate-dressed-all/route.ts ← SSE: all 4 dressed base views server-side
│   │   │   │   ├── batch-redress/route.ts  ← Batch re-generate dressed bases
│   │   │   │   └── [id]/route.ts           ← Model CRUD
│   │   │   ├── jobs/
│   │   │   │   ├── route.ts                ← Job creation + worker kick (respond-then-fire pattern)
│   │   │   │   ├── process-queue/route.ts  ← Worker: processes generation queue sequentially
│   │   │   │   ├── [id]/run-all/route.ts   ← Enqueue + kick worker (respond-then-fire pattern)
│   │   │   │   ├── [id]/route.ts           ← Job CRUD
│   │   │   │   └── [id]/clone/route.ts     ← Clone job
│   │   │   ├── shots/
│   │   │   │   └── [id]/
│   │   │   │       ├── approve/route.ts    ← Shot approval
│   │   │   │       └── apply-label/route.ts ← Manual label composite (leather + woven pocket label in single call)
│   │   │   ├── qc/route.ts                ← QC scoring endpoint
│   │   │   ├── wardrobe/route.ts           ← Wardrobe CRUD
│   │   │   ├── auth/                       ← OTP auth flow
│   │   │   └── seed/route.ts               ← DB seeding
│   │   ├── models/[id]/page.tsx            ← Model detail page (dressed bases UI)
│   │   ├── jobs/[id]/results/page.tsx      ← Job results page (shot review, manual label mapping)
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
│   │   ├── label-composite.ts ← TypeScript wrapper for auto label composite (Gemini corner detection + subprocess)
│   │   ├── label-hybrid.ts    ← Manual label composite — leather (8-point deboss) + woven pocket label
│   │   ├── matrix3d.ts        ← CSS matrix3d solver for 4-corner perspective warp (browser preview)
│   │   ├── zone-grids.ts      ← Panoramic strip generation — v38 front/back isolated strips
│   │   ├── zone-detection.ts  ← Detects garment zones in images
│   │   ├── wardrobe-hash.ts   ← Deterministic hash of wardrobe combo for dressed base lookup
│   │   ├── drive.ts           ← Google Drive integration
│   │   ├── email.ts           ← OTP email sending (nodemailer)
│   │   └── pipeline/
│   │       ├── seedream-generate.ts  ← Seedream shot generation (ref assembly, prompt building)
│   │       ├── seedream-client.ts    ← BytePlus Seedream 4.5 API client
│   │       ├── seedream-tee-edit.ts  ← Gemini tee-edit: paints real top onto Seedream sports-bra output
│   │       ├── seedream-image-safe.ts ← GCS image size guard for Seedream 10 MiB limit
│   │       ├── top-description.ts    ← Opus-cached top description (rich visual text for prompt injection)
│   │       ├── model-ref-prompts.ts  ← Shared prompts for model identity refs (front/back, gender-aware)
│   │       ├── prompt-loader.ts      ← Loads active prompts from Firestore vault (supports pipeline filter)
│   │       ├── generate.ts           ← Gemini shot generation (legacy, still default)
│   │       ├── dressed-base-pipeline.ts ← Dressed base generation + foot resize
│   │       └── foot-resize.ts        ← Sharp foot proportion correction
│   ├── components/
│   │   ├── LabelCornerPicker.tsx ← Manual label mapping UI (leather 8-point + pocket 4-point, CSS matrix3d preview)
│   │   └── PocketLabelPicker.tsx ← Standalone pocket label picker (UNUSED — merged into LabelCornerPicker)
│   ├── types/index.ts         ← All TypeScript interfaces (User, Job, Shot, Model, WardrobeItem, etc.)
│   └── __tests__/             ← 5 test files, 103 tests total
├── scripts/
│   └── label_hybrid.py        ← Python/OpenCV leather deboss + woven pocket label composite
├── public/
│   └── originals-label-gold-woven.png ← 1024x705 RGBA woven Originals pocket label (gold-on-dark, textile texture)
├── cloudbuild.yaml            ← Cloud Build config with --no-cache (PREFERRED deploy method)
├── Dockerfile                 ← Multi-stage build → standalone Node.js + Python/OpenCV
├── .gcloudignore              ← MUST NOT exclude scripts/ or *.py (label pipeline needs them)
├── .dockerignore              ← MUST NOT exclude *.py
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## Generation Pipeline

### Dual Backend: Gemini vs Seedream

Jobs can use either **Gemini** (default) or **Seedream 4.5** (BytePlus) as their generation backend. The provider is set per-job or per-shot (`provider` field).

**Provider resolution** (in `generate/route.ts`): `shotData.provider || job.provider || 'gemini'` — per-shot override > job-level > default Gemini.

**Gemini path**: Two-phase pipeline with dressed bases for full-body shots. Uses Vertex AI / Generative Language API.

**Seedream path** (`provider: 'seedream'`): Single-pass generation via BytePlus Ark API → optional Gemini tee-edit for top painting.

### Seedream Pipeline — Complete Architecture

#### File Map

| File | Purpose |
|------|---------|
| `src/app/api/generate/route.ts` | Dispatch: detects `provider === 'seedream'`, calls `generateSeedreamShot()`, then `applyTeeEdit()` |
| `src/lib/pipeline/seedream-generate.ts` | Core: ref assembly + prompt building for all 5 shots (`seedreamM01`–`seedreamM05`) |
| `src/lib/pipeline/seedream-client.ts` | BytePlus Ark API client: POST to `ark.ap-southeast.bytepluses.com`, retry logic, buffer download |
| `src/lib/pipeline/seedream-tee-edit.ts` | Stage 2: Gemini paints real top onto Seedream sports-bra output (M01-M04 only) |
| `src/lib/pipeline/seedream-image-safe.ts` | GCS image size guard: downsizes refs > 10 MiB to `_seedream.jpg` sibling |
| `src/lib/pipeline/top-description.ts` | Claude Opus 4.6 analysis: generates 40-word text description of top garment, cached on wardrobe doc |
| `src/lib/pipeline/prompt-loader.ts` | Loads prompts from Firestore vault with `pipeline: 'seedream'` filter |
| `src/app/api/admin/seed-seedream-vault/route.ts` | Seeds v3.0 Seedream-specific prompts (M01–M05) into Firestore `promptVault` collection |

#### Generation Flow (generate/route.ts)

```
1. Resolve provider: shot.provider > job.provider > 'gemini'
2. Load prompt from vault with pipeline='seedream' filter
3. Build SeedreamGenerationContext (wardrobe, modelId, silhouette, anchors)
4. Call generateSeedreamShot(shotType, ctx, prompt)
   └── Dispatches to seedreamM01/M02/M03/M04/M05
   └── Each assembles refs (public GCS URLs) + builds prompt
   └── Calls generateSeedreamImage() (seedream-client.ts)
   └── Returns Buffer
5. If M01-M04: applyTeeEdit() — Gemini paints real top over sports bra
6. If M02/M04: applyAutoHybridLabel() — leather label composite
7. Upload to GCS, save anchor URLs (M03→m03AnchorUrl, M04→m04AnchorUrl)
```

#### Seedream Client (seedream-client.ts)

- **Endpoint**: `https://ark.ap-southeast.bytepluses.com/api/v3/images/generations`
- **Model**: `seedream-4-5-251128`
- **Auth**: `BYTEPLUS_API_KEY` env var (Bearer token)
- **Max refs**: 10 (hard limit — exceeding throws, no silent truncation)
- **Timeouts**: 180s generation, 30s image download
- **Retries**: 3 retries with exponential backoff (15s, 30s, 60s) for 429/5xx/timeout/network errors. 4xx (except 429) fails immediately.
- **Aspect ratios**: `9:16` → `1472x2624` (3.86M px), `3:4` → `1728x2304` (3.98M px). BytePlus minimum is 3,686,400 px.
- **Response**: Synchronous — POST returns URL, we fetch into Buffer immediately. URL is never persisted.

#### Reference Assembly Per Shot (seedream-generate.ts)

**CRITICAL**: Seedream follows images over text. Ref ORDER determines priority — FIRST ref is most dominant.

**M03 (full body front)**:
1. Model card (`referenceImageUrl`) — identity anchor
2. Flat front
3. 3 front fit model angles (front, front45Left, front45Right)
4. Shoes ref
= ~6 refs

**M04 (full body back)**:
1. Back ref (`backReferenceImageUrl`) if exists, else model card
2. Model card (if back ref used separately)
3. Flat front (used for garment length/silhouette only)
4. 3 back fit model angles (back, back45Left, back45Right)
5. Shoes ref
= ~7 refs

**M01 (cropped front)** — depends on M03 anchor:
1. **M03 anchor (PRIMARY)** — model wearing garment, front view. Leads because it shows correct hem/length/break
2. Model card (identity)
3. Flat front
4. 3 front fit model angles
5. Shoes ref
= ~7 refs

**M02 (cropped back)** — depends on M04 anchor:
1. **Fit model back angle[0] (PRIMARY)** — shows correct hem length pooling over shoes
2. Model card (identity only, NOT back ref — back-ref card is harmful here)
3. Flat front (garment proportions)
4. Remaining back angles (indices 1, 2)
5. **M04 anchor (SECONDARY)** — color/wash only, NOT hem length
6. Shoes ref (capped at 10 total)
= ~8 refs

**Why M04 anchor is demoted in M02**: If M04 was generated with short hem (a common Seedream failure), putting it as PRIMARY causes M02 to copy the short hem. Fit model back shows the REAL hem length.

**M05 (pocket detail)** — minimal refs for focus:
1. Fit model back (left hip/pocket visible)
2. Fit model back45Right (left hip closer to camera)
= 2 refs only (AI anchors add noise for pocket close-ups)

#### Top Handling: Sports Bra + Tee-Edit Pipeline

Seedream produces a **body seam artifact** when rendering full tops directly — the upper and lower body look like separate zones stitched together. The fix is a two-stage pipeline:

**Stage 1 — Seedream generation** (`seedream-generate.ts`):
- `rewriteTopForSeedream()` ALWAYS returns `'simple black sports bra'` regardless of actual top
- Top reference IMAGE is intentionally excluded from refs — only shoes are sent as styling refs
- Top is described as text only (`{top_description}` placeholder in prompt) to prevent Seedream from copying crop-top styling
- This produces clean body rendering with no seam artifact

**Stage 2 — Gemini tee-edit** (`seedream-tee-edit.ts`):
- Takes Seedream output (sports bra) + flat top image + Opus-generated description
- Calls Gemini `gemini-3-pro-image-preview` with edit prompt
- V2 "layered under waistband" prompt (validated across 20+ style variants):
  ```
  The top covers the entire torso from shoulders to below the waistband.
  The bottom of the top is hidden UNDER the jeans — the denim waistband
  sits ON TOP of the shirt fabric.
  ```
- **Skipped for M05** (pocket close-up — no top visible)
- **Graceful fallback**: Returns original Seedream image if no top in wardrobe, missing flat image, or Gemini edit fails

**Top description generation** (`top-description.ts`):
- Claude Opus 4.6 analyzes flat top image → 40-word text description
- Cached on wardrobe item doc as `topDescription` + `topDescriptionAnalyzedAt`
- Lazy-computed on first use if not cached
- Prompt instructs: do NOT mention how the top should be worn (tucked/untucked)
- Used in both Seedream prompt (`{top_description}` placeholder) and tee-edit prompt

**Model ref consideration**: Model cards (identity refs) should ideally show sports bras for Seedream consistency. If the model card shows a t-shirt, Seedream may copy the t-shirt appearance (images > text), partially defeating the sports bra approach. Regenerating model cards with sports bras avoids this conflict — the Gemini pipeline uses dressed bases (not model cards) for Phase 2, so this change doesn't affect Gemini.

#### Image Size Guard (seedream-image-safe.ts)

BytePlus rejects refs > 10 MiB. Some GCS fit model photos exceed this. The guard:
- Checks GCS object size via metadata
- If ≤ 9 MiB → pass through unchanged
- If > 9 MiB → check for cached `_seedream.jpg` sibling
- If no sibling → download, Sharp resize to ≤ 2000px long edge, JPEG quality 85→60, upload as sibling
- Gemini is unaffected (takes inline buffers with higher limit)

#### Prompt System (vault + seeding)

**Loading**: `loadPrompt(shotType, category, pipeline)` queries Firestore `promptVault` with `pipeline: 'seedream'`. Each shot type has its own active prompt doc.

**Placeholder injection** (in `buildPrompt()`):
- `{silhouette}` → front/back silhouette analysis text
- `{top_description}` → Opus-generated top description (rewritten to "simple black sports bra" for Seedream)
- `{shoes_description}` → shoes item description text
- `{gender}`, `{gender_pronoun}`, `{gender_possessive}`, `{gender_pose}` → male/female variants
- `{garment_type}` → garment category (e.g., "jeans", "Pants")

**Seeding**: `POST /api/admin/seed-seedream-vault` pushes all 5 shot prompts into Firestore with `pipeline: 'seedream'`, `isActive: true`. Idempotent — deactivates existing active Seedream prompts for each shot type before inserting. **MUST be called after every deploy that changes prompts.**

**Current prompt versions (v3.0)**:
- M01: Waist-to-ankle crop, front view, sports bra visible at top
- M02: Waist-to-ankle crop, back view + EXTRA-LONG INSEAM (hem pools on floor)
- M03: Full body front, head to feet, sports bra top
- M04: Full body back, head to feet + EXTRA-LONG INSEAM (hem pools on floor)
- M05: Lateral left-side pocket close-up, even studio lighting, 2 refs only

### Seedream Prompt Lessons Learned

- **Hem length**: Text instructions like "cover the shoes" don't work — Seedream follows reference images. Use "inseam 4 inches LONGER than the model's legs" (physical property framing).
- **M02 ref order matters**: Fit model back (showing correct hem) must be FIRST ref. M04 anchor demoted to secondary — if M04 was generated with short hem, Seedream copies it.
- **M05 lighting**: "side or three-quarter light" causes sunset rendering. Must use "bright even studio lighting from directly in front — flat, diffused, no directional shadows, no warm color cast, no golden tones."
- **M05 camera angle**: "LEFT back pocket" + "camera positioned to MODEL'S RIGHT side" = correct left-side lateral view.
- **Top description gotcha**: Words like "relaxed", "loose", "oversized" in the Opus description override tuck instructions. Strip style adjectives if tuck fails.
- **Seedream follows images over text**: When text and reference images conflict, Seedream follows the images. Order images so the most important reference is FIRST.
- **Model card with t-shirt**: If the model card shows a t-shirt, Seedream may render the t-shirt instead of the sports bra prompt instruction. Model cards should show sports bras for Seedream consistency.

### Offline Testing Methodology (MANDATORY before platform changes)

**NEVER push prompt or ref-order changes to the codebase without testing them offline first.** Seedream is stochastic — a change that sounds logical can fail 3 out of 5 runs. The workflow:

1. **Write a standalone Node.js test script** (e.g., `m05-lighting-fix.js`) that calls the BytePlus Seedream API directly. Match the platform setup EXACTLY: same refs, same ref order, same prompt (after all `{placeholder}` replacements), same image size.

2. **Run multiple variants** in one script (V1, V2, V3 with different prompt approaches). Save each to `/mnt/gstar/` so Bruno can inspect them visually.

3. **Run the winning variant 3x** to check consistency. Seedream can produce a good result once and fail the next. 3/3 passing = safe to ship.

4. **Compare to platform setup explicitly.** If the test uses 7 refs but the platform sends 2, the test proves nothing. Check `seedreamM0X()` in `seedream-generate.ts` for the exact ref list and order.

5. **Only after consistent offline results** → update the vault prompt in `seed-seedream-vault/route.ts`, update any ref-order logic in `seedream-generate.ts`, deploy, and seed.

**Test script template:**
```javascript
const fs = require('fs');
const API_KEY = process.env.BYTEPLUS_API_KEY || 'key-here';
const BYTEPLUS_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations';
const MODEL = 'seedream-4-5-251128';

const PROMPT = `...`;  // Exact prompt after placeholder injection
const REFS = ['https://storage.googleapis.com/gstar-ai-studio-assets/...'];  // Match platform exactly

async function main() {
  for (let i = 1; i <= 3; i++) {
    const response = await fetch(BYTEPLUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({ model: MODEL, prompt: PROMPT, image: REFS, size: '1728x2304', response_format: 'url', watermark: false }),
    });
    const result = await response.json();
    const imgResp = await fetch(result.data[0].url);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    fs.writeFileSync(`/path/to/output-v${i}.png`, buf);
    console.log(`[v${i}] Saved (${buf.length} bytes)`);
    await new Promise(r => setTimeout(r, 5000));
  }
}
main().catch(console.error);
```

**Key pitfalls caught by offline testing:**
- M05 sunset lighting → caused by "side or three-quarter light" in prompt text. Fixed with "even studio lighting from directly in front." Would have shipped broken without 5-run consistency check.
- M02 short hem → "CRITICAL HEM LENGTH: cover the shoes" text was ignored by Seedream. Only "inseam 4 inches LONGER than model's legs" (physical property framing) worked. Required 9 test variants across 3 rounds.
- M02 ref order → M04 anchor as PRIMARY ref overrode fit model hem length. Moving fit model back to position 1 fixed it. Only discovered by running platform-matching refs side-by-side with test refs.
- M05 wrong side → "left pocket" was ambiguous (model's left vs viewer's left). Required "camera positioned to MODEL'S RIGHT side, aimed at MODEL'S LEFT back pocket" + 3-run consistency.

### Model Identity References (Front + Back)

Each model has two identity reference images used as anchors during shot generation:
- `referenceImageUrl` — front view (stored at `model-cards/{modelId}.png`)
- `backReferenceImageUrl` — back view (stored at `model-cards/{modelId}_back.png`)

**v2 uniform setup** (for Seedream pipeline compatibility):
- Women: simple black sports bra + black compression shorts, barefoot
- Men: bare torso + black compression shorts, barefoot
- Seamless infinity cove (#D5D3CC), no horizon line, no wall-floor seam
- Even diffused studio lighting, no directional shadows, no color cast
- Generated via Gemini Flash (`gemini-3.1-flash-image-preview`)

**Prompts**: Shared in `src/lib/pipeline/model-ref-prompts.ts` — identical studio environment and proportion blocks for front and back, only view direction and gender-specific top differ.

**Endpoints**:
- `POST /api/models/generate-front` — regenerates front ref with uniform setup. Preserves original upload in `originalReferenceImageUrl`. Single + batch (`{ modelIds: [...] }`).
- `POST /api/models/generate-back` — regenerates back ref from front. Single + batch.
- `POST /api/models/regenerate-refs` — batch: front + back for all active models (or specific `modelIds`). Options: `skipFront`, `skipBack`. 5s cooldown between calls. Long-running — use curl, not browser.

**Why sports bra for Seedream**: Seedream follows images over text. If the model card shows a t-shirt, Seedream copies the t-shirt instead of following the "sports bra" prompt instruction. Uniform sports bra refs eliminate this conflict. The Gemini pipeline uses dressed bases (not model cards) for Phase 2, so this change doesn't affect Gemini.

**Batch regeneration** (after deploy):
```bash
curl -s -X POST https://gstar-ai-studio-674145888056.europe-west1.run.app/api/models/regenerate-refs
```

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

| Shot | Description | Aspect | Notes |
|------|-------------|--------|-------|
| M03 | Full body front | 9:16 | Generated FIRST as garment anchor. v38: 3 front angles only |
| M01 | Cropped front (waist to ankle) | 3:4 | No model card ref (would defeat crop) |
| M02 | Cropped back | 3:4 | Uses back dressed base. Manual label composite available |
| M04 | Full body back | 9:16 | Uses back dressed base. Manual label composite available. v38: 3 back angles only |
| M05 | Detail shot (back pocket close-up) | 3:4 | Uses back dressed base, tight crop |

**Two-phase pipeline** (for full-body shots M03/M04):
- **Phase 1** (Gemini Flash, 2K): Generates garment template from flat + fit model references. View-specific: front shots get FRONT VIEW CONSTRUCTION prompt block, back shots get BACK VIEW CONSTRUCTION block.
- **Phase 2** (Gemini Flash, 2K): Combines garment template with model identity from dressed base. View-specific construction details in prompt.

**For cropped shots** (M01/M02): Single phase, no model card, generates anonymous model wearing garment.
**For detail shot** (M05): Single phase, tight close-up of one back pocket. Gets M03 garment template as color lock + color anchor fit model.

**Label strategy**: Gemini renders labels naturally (no suppression prompt). The real leather label and woven Originals pocket label are composited on top via manual mapping from the results page. See "Label Composite Pipeline" section.

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

**Why this matters**: Gemini was picking up front seam patterns from front fit model images and hallucinating them onto back views. Full isolation means back shots see ZERO front references, and front shots see ZERO back references.

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

Back shots (M02, M04) get two real labels composited onto AI-generated images: the leather waistband label and the woven Originals pocket label. Gemini renders labels naturally (no suppression prompt) — the real labels are composited on top via manual corner mapping from the results page.

### Architecture: Three-Layer System

1. **Browser preview** (`LabelCornerPicker.tsx` + `matrix3d.ts`):
   - User opens "Map label manually" on results page → opens full-screen picker modal
   - 8-point control for leather label (4 corners + 4 midpoints for edge bending)
   - 4-point control for woven pocket label (toggle via "+ Pocket" button)
   - CSS `matrix3d()` live perspective warp preview for both labels
   - Leather label shows debossed text preview via Python `run_preview()` subprocess
   - Submit sends corners to `/api/shots/[id]/apply-label`

2. **TypeScript wrapper** (`src/lib/label-hybrid.ts`):
   - `applyLeatherLabel()` — calls Python with `mode: "composite"`, 8-point corners
   - `applyWovenLabel()` — calls Python with `mode: "woven"`, 4-point corners
   - Both download images to temp files, spawn Python subprocess, parse JSON result
   - `PocketLabelCorners` interface: `{ tl, tr, br, bl }` (4 corners, no midpoints)

3. **Python script** (`scripts/label_hybrid.py`):
   - `run()` — leather label: perspective warp into 8-point polygon, Sobel-based deboss/emboss shader, tint to garment color
   - `run_preview()` — fast leather preview for browser (lower quality, skips some steps)
   - `run_woven()` — woven pocket label: perspective warp, luminance matching, cast shadow, soft-edge blend
   - Outputs JSON to stdout, logs to stderr

### Leather Label Composite (run / run_preview)

1. **8-point polygon** — 4 corners + 4 midpoints allow V-shaped edge bending for natural label curvature
2. **Sobel-based deboss shader** — embosses text into the leather texture using gradient-based relief. Hilite parameter: 20.0 (reduced from 45.0 to avoid specular shine on dark leather)
3. **Tint to garment color** — LAB color space: L channel recentered to target mean (preserves grain variance), a/b channels flattened to target chroma (pure target color, no variance)
4. **Adaptive Gaussian blur** — kernel scales with image diagonal: `max(11, int(diag * 0.004) | 1)` for natural edge softening
5. **Alpha blend** — NOT seamless clone (Poisson blending washes out label colors)

### Woven Pocket Label Composite (run_woven)

1. **Source**: `public/originals-label-gold-woven.png` — 1024×705 RGBA, gold-on-dark with diagonal twill textile texture, edge stitching
2. **Perspective warp** — 4-corner homography via `cv2.getPerspectiveTransform()`, `INTER_LANCZOS4`
3. **Local luminance matching** — samples denim brightness in a dilated ring around the label quad, shifts label L channel 35% toward ambient value. Prevents "sticker" look without washing out gold text
4. **Cast shadow** — offset mask down-right by `diag * 0.0015` px, blur with `diag * 0.006` kernel, subtract label footprint, darken target 15%. Grounds the label on fabric
5. **Soft-edge blend** — adaptive Gaussian blur on mask edges, `diag * 0.003` kernel

### API Endpoint: `/api/shots/[id]/apply-label`

Single POST handles both labels in one call:
- `body.corners` — leather label 8-point corners (required)
- `body.pocketLabelCorners` — woven pocket label 4-point corners (optional)
- Pipeline: leather composite first → woven composite on top of result
- Updates shot imageUrl in Firestore, stores previous version

### Manual Label Mapping UI (LabelCornerPicker)

Opened from results page via "Map label manually" button on M02/M04 shots:
- Full-screen modal with zoomable/pannable shot image
- Green handles: leather label (8-point — 4 corners + 4 draggable midpoints)
- Blue handles: woven pocket label (4-point, toggled via "+ Pocket" button)
- Opacity slider for label preview transparency
- CSS matrix3d live preview for both labels simultaneously
- "Warp" button submits both sets of corners in single API call
- **CSS gotcha**: pocket label img needs `maxWidth: 'none'` to override Tailwind preflight's `img { max-width: 100% }`

## Prompt Conventions

Key prompt building blocks in `src/lib/prompts.ts`:
- `ANTI_AI_RULES` — Prevents AI-looking artifacts (plastic skin, symmetric faces, etc.)
- `ANTI_HALLUCINATION` — Forces garment fidelity to reference images
- `VIEW_POSES` — View-specific pose instructions (front relaxed, back 3/4 turn, etc.)
- `STYLING_RULES` — G-Star brand styling (raw denim aesthetic, urban, minimal)

Prompts reference images by index: `"image 1 shows the flat lay, image 2 shows the mannequin front..."` — order matters and must match the images array passed to Gemini.

**Label strategy change**: The old `LABEL_SUPPRESSION_PROMPT` and `appendLabelNegative()` have been REMOVED from `generate.ts`. Gemini now renders the leather label naturally in back shots. The real label is composited on top via manual mapping. This avoids the contradiction of telling Gemini to both render a realistic back view AND suppress the label.

**v38 view-specific prompt blocks** (in generate/route.ts Phase 1):
- `CRITICAL — BACK VIEW CONSTRUCTION:` block for back shots — emphasizes back panel seam lines, yoke seams, pocket arcs, diagonal seams below knee
- `CRITICAL — FRONT VIEW CONSTRUCTION:` block for front shots — emphasizes front pocket shapes, fly stitching, rivet placement, front panel seams

## Deploy Commands

**CRITICAL: NEVER deploy without Bruno's explicit permission. He will say "deploy" when ready.**

**PREFERRED — Cloud Build with no-cache** (guarantees fresh build, no kaniko layer cache issues):
```bash
gcloud builds submit --config cloudbuild.yaml --project gstar-ai-studio
```

**DEPRECATED — `gcloud run deploy --source .`** (uses kaniko which caches Docker layers between builds — has caused stale deploys where old code persisted despite source changes):
```bash
gcloud run deploy gstar-ai-studio --source . --region europe-west1 --project gstar-ai-studio
```

**Why cloudbuild.yaml**: The `--no-cache` flag in `cloudbuild.yaml` forces a completely fresh Docker build. Without it, kaniko's remote layer cache can serve stale `npm run build` output even when source files changed. This caused a bug where a removed UI component persisted across multiple deploys.

**IMPORTANT**: Deploy takes 5-8 minutes. Desktop Commander MCP has a 60s timeout. Tell Bruno to run the command in his terminal.

**Cloud Run URL**: https://gstar-ai-studio-674145888056.europe-west1.run.app

## Known Issues & Pitfalls

1. **Deploy with `cloudbuild.yaml`, NOT `--source .`** — `gcloud run deploy --source .` uses kaniko which caches Docker layers remotely. Even after changing source files, the cached `npm run build` output can persist. The `cloudbuild.yaml` has `--no-cache` which forces a fresh build every time. This has caused a real bug where a removed component kept appearing in production.

2. **`.gcloudignore` and `.dockerignore` MUST NOT exclude `scripts/` or `*.py`** — The label hybrid pipeline needs `scripts/label_hybrid.py` in the Docker image. If excluded, label compositing fails.

3. **Dockerfile must install Python + OpenCV** — The multi-stage build installs `python3`, `python3-pip`, `opencv-python-headless`, and `numpy` in the final image.

4. **Tailwind preflight `img { max-width: 100% }` breaks absolutely positioned images** — Any `<img>` with explicit pixel width inside a smaller container gets clamped. The pocket label overlay (1024×705px) needs `maxWidth: 'none'` inline style. Without it, the CSS matrix3d transform maps from wrong source dimensions and the label doesn't fill the quad.

5. **Skin mask + luminance match on leather label was REVERTED** — An attempt to add `detect_skin_mask()` (HSV-based skin detection) and `match_local_luminance()` to the leather label path caused worse artifacts: visible cut-lines on the arm and completely unreadable label text. These functions exist in `label_hybrid.py` but are NOT called from any active code path. DO NOT re-enable without careful testing.

6. **Gemini corner detection can return bad corners** — `detectLabelCorners()` sometimes returns corners outside image bounds or in wrong order (not TL→TR→BR→BL). The Python script validates and clamps corners.

7. **Foot resize can clip legs** — The bottom-12% resize logic assumes feet are in the bottom portion. The edge detection guard (>10% non-background pixels) usually prevents this.

8. **SSE streams and Cloud Run timeouts** — Generation can take 2-5 minutes per shot. Cloud Run timeout is currently 3600s.

9. **Auth cookies on loopback** — Internal SSE calls to `localhost:${PORT}` must forward the original request's cookies. Without this, the internal endpoints return 401.

10. **Worker kick pattern — DO NOT CHANGE** — The respond-then-fire pattern has broken 3 times. NEVER `await` the process-queue fetch. See "Worker Kick Pattern" section above.

11. **Front/back reference isolation** — If M04 back construction looks wrong, check that back shots are getting ONLY back angles and flat back — any front reference leaking in will cause hallucinated seam lines.

12. **Codebase path has `.nosync` suffix** — `/Users/bdheedene/Documents/Claude folder.nosync/gstar/gstar-studio`. The `.nosync` prevents iCloud sync.

## Shot Regeneration

Individual shots can be re-run from the job results page (`/jobs/[id]/results`):
- Each shot card has a "Re-run This Shot" button
- Optional "MODIFICATION INSTRUCTIONS" textarea for prompt tweaks
- Calls `POST /api/generate` with `{ shotId, jobId, modification, originalPrompt: '', version: shot.version + 1 }`
- The shot version increments, previous versions are kept in GCS
- M02/M04 shots have "Map label manually" button → opens LabelCornerPicker for leather + pocket label composite

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
