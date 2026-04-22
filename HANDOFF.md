# G-Star AI Studio — Session Handoff v13

## Session Date: March 27, 2026 (night session)

## Changes Made

### 1. Prompt Fixes (generate/route.ts)

**M02 White Stitches Fix**
- Added CRITICAL back pocket stitching color rule to BOTH Phase 1 and Phase 2 prompts
- Instructs Gemini to match exact stitching color from mannequin — no defaulting to white
- Root cause: Gemini defaults to high-contrast white stitching unless explicitly told otherwise

**M01 Over-Cropping Fix**
- Reduced crop percentage: 32% → 26% (flat shoes), 28% → 22% (heels)
- Root cause: Phase 2 generates at 3:4 aspect (not 9:16), so model is already tightly framed
- Previous values were calibrated for 9:16 full-body → waist-to-ankle crop

**M03/M04 Warm Skin Tone Fix**
- Added neutral skin tone lighting rules to Phase 2 prompt
- Specifies 5500K-6000K daylight-balanced studio lighting
- Explicitly prohibits golden hour, tungsten, and warm amber lighting
- M02 was fine (different generation path), M03/M04 were too warm

### 2. Label Detection Improvement (label-composite.ts)

**Normalized Coordinates Retrofit**
- detectLabelCorners() now auto-detects pixel vs 0-1000 normalized coordinates
- If max coordinate > 1000, converts from 1200px detection space to normalized
- Enhanced Gemini prompt with concrete examples ("center = [500, 500]")
- Added quadrilateral validation: aspect ratio (0.5-8.0), Y position (8-55%)
- Cost: $0 — uses same Gemini call, just better parsing

### 3. LAB Color Consistency Pipeline (NEW)

**Files:**
- `scripts/color_match.py` — Python/scikit-image LAB histogram matching
- `src/lib/color-match.ts` — TypeScript wrapper

**How it works:**
1. Takes mannequin front view as color reference
2. Creates garment mask (excludes skin via HSV, background via brightness)
3. Matches LAB histograms between reference and generated image
4. Applies at 50% strength with Gaussian edge blending
5. Runs as POST-PROCESS 3b (after flat-reference correction)

**Docker changes:**
- Added `scikit-image` to pip install in Dockerfile
- Added COPY for `scripts/color_match.py`
- Image size increase: ~200MB

### 4. SSE Error Recovery (run-all/route.ts)

**Retry Logic:**
- Failed shots get 1 automatic retry after 30s cooldown
- 5xx/network errors: retry. 4xx client errors: no retry
- SSE sends "retrying" event with attempt number

**Stream Error Boundary:**
- Entire stream body wrapped in try/catch
- Prevents unhandled errors from crashing the whole job

### 5. Test Fix (prompts.test.ts)

- Updated test for renamed ANTI_HALLUCINATION section header
- All 103 tests pass

## Testing Done

- TypeScript compilation: ✅ clean (0 errors)
- Vitest: ✅ 103/103 tests pass
- Label detection: ✅ tested on M04 back shot — coordinates valid, aspect ratio 2.85
- Color matching: ✅ tested on M03 vs mannequin — ΔE 39.2 → 37.3 (4.8% improvement)
- Python deps: ✅ scikit-image + OpenCV verified working

## Deployed

- **Rev 00193** deployed to Cloud Run (pre-v13 changes — deployed earlier this session)
- v13 changes NOT YET deployed — need `gcloud run deploy` after review

## What to Test Next

1. Run a new job on F15 / 3301 Slim to verify:
   - M02: tone-on-tone stitching (not white)
   - M01: waistband clearly visible after crop
   - M03/M04: neutral skin tone (not golden hour)
   - Label placement on M02/M04 back shots
   - Color consistency via histogram matching

2. Compare M02 stitching against fit model photos and M05 detail shot

## Cost Impact

- No new Gemini API calls added
- Color matching is CPU-only (Python/scikit-image)
- Estimated cost per job: unchanged (~$0.10-0.15)

## Files Changed

| File | Type | Summary |
|------|------|---------|
| src/app/api/generate/route.ts | Modified | Stitching prompt, crop fix, skin tone fix, color match integration |
| src/lib/label-composite.ts | Modified | Normalized coords, validation, prompt clarity |
| src/lib/color-match.ts | **New** | TypeScript wrapper for color matching |
| scripts/color_match.py | **New** | Python LAB histogram matching |
| Dockerfile | Modified | Added scikit-image, color_match.py COPY |
| src/app/api/jobs/[id]/run-all/route.ts | Modified | Retry logic, error boundary |
| src/__tests__/prompts.test.ts | Modified | Updated test for renamed section |

---

# Audit Fixes — April 2, 2026

## Changes Made (Architecture hardening — no image generation changes)

### 1. Sequential Queue (process-queue/route.ts)

Removed parallel same-job shot execution (`MAX_PARALLEL_SHOTS = 2` with `Promise.all()`). Now strictly sequential: 1 shot at a time within a job.

**Why:** M03 is the front garment anchor reused by later shots. If M01 starts before M03 finishes, it picks up a stale/missing anchor. Parallelism is only safe between jobs, not within.

### 2. Killed Dressed-Base Fallback (generate/route.ts)

Removed permissive fallback that used ANY dressed base when no exact wardrobe hash match was found. Now returns HTTP 400 with `MISSING_DRESSED_BASE` error code.

**Why:** Using a dressed base from a different outfit poisons Phase 2 with wrong shirt color, shoe style, and silhouette cues. Silent degradation was worse than explicit failure.

### 3. Two-Layer QC System (NEW: shot-qc.ts + wired into pipeline)

**Layer 1 — Deterministic pixel checks (no AI cost):**
- Background cleanliness: samples bottom 10% (floor hallucination), left/right edges. Checks luminance stddev (texture) and color deviation from studio grey.
- Framing: aspect ratio validation per shot type (9:16 for M03/M04, 3:4 for M01/M02/M05).
- Exposure: center region luminance check (min 60, max 245).

**Layer 2 — Flat-vs-generated comparison via Gemini Flash Lite (~$0.002/call):**
- 6 scored dimensions (1-10): color_match, seam_fidelity, pocket_accuracy, silhouette_match, length_correct, background_check.
- Uses flat front image for front shots, flat back for back shots.
- Pass criteria: weighted_score >= 7.0 AND no dimension below 4.
- Both images downscaled to 1024px for cost efficiency.

**Pipeline integration:**
- QC runs after all post-processing, before GCS upload.
- Scores stored on shot Firestore document (`qcPass`, `qcScore`, `qcDetails`, `qcTimestamp`).
- M03 anchor gate: if M03 QC fails, `phase1AnchorUrl` is revoked (prevents bad anchor from propagating to M01/M02).
- M03 QC failure sets shot status to `qc_failed` instead of `done`.
- QC results included in API response.

**On-demand QC:** `/api/qc` endpoint re-enabled for manual re-runs on existing shots.

### 4. Rollback Patch

Saved at `rollback-2026-04-02-sequential-and-fallback.patch` — covers the sequential queue and dressed-base fallback changes.

## Testing Done

- TypeScript compilation: ✅ clean (0 errors)
- Vitest: ✅ 103/103 tests pass

## Cost Impact

- QC Layer 1: $0 (CPU-only pixel analysis)
- QC Layer 2: ~$0.002 per shot (~$0.01 per 5-shot job)
- Estimated cost per job: ~$0.11-0.16 (was ~$0.10-0.15)

## NOT YET DEPLOYED — awaiting explicit deploy instruction.

## Files Changed

| File | Type | Summary |
|------|------|---------|
| src/app/api/jobs/process-queue/route.ts | Modified | Sequential queue (removed parallel same-job shots) |
| src/app/api/generate/route.ts | Modified | Killed dressed-base fallback, wired QC into pipeline, M03 anchor gate |
| src/lib/shot-qc.ts | **New** | Two-layer QC module (deterministic + Gemini Flash Lite) |
| src/app/api/qc/route.ts | Modified | Re-enabled with new flat-comparison QC logic |

---

# Hybrid Leather Label — Option B Full Port — April 11, 2026

## Changes Made

### 1. Three-Tier Label Schema (NEW)

Replaces the old per-wardrobe `labelConfig` with three Firestore collections:

- **`labelTemplates`** — one doc per physical label SKU (e.g. `L2936-8.0`). Holds artwork URL + grain tile URLs per variant (pebbled/smooth/coarse) + aspect ratio.
- **`labelStyles`** — one doc per styleCode (e.g. `D22889`). Holds `templateId` + saved `pocketCorners` and `labelCorners` on an `anchorPhoto`. Geometry is set up once per style and reused by every colorway.
- **`labelColorways`** — one doc per `${styleCode}_${colorwayCode}`. Holds only the color delta: `baseColor`, `stitchColor`, `grainVariant`, `embossStrength`.

`resolveLabelRenderConfig(styleCode, colorwayCode)` in `src/lib/firestore.ts` joins all three. Returns null if any tier is missing.

### 2. API Routes (NEW)

- `GET/POST /api/label/templates` + `GET /api/label/templates/[templateId]`
- `GET/PUT /api/label/styles/[styleCode]` — validates 4-length quads of `{x,y}`
- `GET/PUT /api/label/colorways/[docId]` — `docId = ${styleCode}_${colorwayCode}`
- `GET/POST /api/label/bootstrap` — idempotent `L2936-8.0` seed
- `GET /api/label/image-proxy?url=...` — CORS proxy for canvas color sampling

### 3. Pocket-Anchor Homography (NEW)

**Files:**
- `src/lib/pocket-detector.ts` — Gemini 2.5 Flash Lite finds the right back pocket's 4 corners in a generated image. Strict JSON-only prompt, bounds clamp, rejects quads <20px. Returns null on any error.
- `src/lib/label-render.ts` — pure TypeScript 4-point DLT homography via 8×8 Gauss elimination. Takes saved `pocketCorners` + `labelCorners` (setup anchor coords) + newly detected `pocketCorners`, returns projected label corners in the generated image's coord space.

No OpenCV SVD needed in TS — the shader still uses `cv2.getPerspectiveTransform` for the actual warp, but TS handles the re-projection maths.

### 4. Setup UI (NEW)

`src/app/wardrobe/[id]/label-setup/page.tsx` (~1280 lines). React port of `label_POC/wardrobe_mockup/index.html`.

- 4-photo picker: `fitModels.back`, `back45Left`, `back45Right`, `flatBackUrl`
- Pan/zoom canvas with CSS transform, `--ptscale` CSS var for inverted point sizing
- 8 draggable corner points (pocket quad + label quad), TL/TR/BR/BL enforced via `sortQuad` (sum/diff trick)
- 5×5-pixel color sampler — requires CORS, routed through `/api/label/image-proxy`
- Grain variant select + emboss slider
- Luminance-preserving multiply tint live preview (POC math)
- Dual PUT save → `/api/label/styles/${styleCode}` + `/api/label/colorways/${styleCode}_${colorwayCode}`
- Auto-bootstraps `L2936-8.0` on first load
- Save blocked if `designNumber` doesn't parse

Entry point: "Configure leather label →" button in the wardrobe detail panel in `src/app/wardrobe/page.tsx`, shown only for `bottom` category items with a parseable `designNumber`.

### 5. Runtime Orchestration (NEW)

`src/lib/label-auto.ts` — `applyAutoHybridLabel()` — single entry called from `src/app/api/generate/route.ts` after Gemini returns. Reads `ENABLE_HYBRID_LABEL_AUTO` (default ON). Guards: shotType ∈ {M02, M04}, env flag, Python available, parseable designNumber, resolvable config, detectable pocket, valid homography. **ANY failure logs and returns the original buffer. Never throws.**

### 6. Gated Negative Prompt (NEW)

`src/lib/pipeline/generate.ts`:

- Added `LABEL_NEGATIVE_PROMPT` constant telling Gemini NOT to draw any text / letters / logos in the pocket patch area (prevents bleed under the shader output).
- Added `hasLabelConfigForItem(focusItem)` — parses designNumber via `styleAndColorwayOf()`, calls `resolveLabelRenderConfig()`, returns true only if all three tiers exist. Never throws.
- Wrapped three back-shot `finalPrompt` assignments (`generateM04WithDressedBase`, `generateM04`, `generateM02`) with the gate:
  ```ts
  const hasLabel = await hasLabelConfigForItem(focusItem);
  if (hasLabel) finalPrompt = appendLabelNegative(finalPrompt);
  ```
- **M05 is intentionally NOT wrapped** — pocket close-up has no composite pass, so Gemini should draw its best-effort label.

The gate keeps prompt and shader in lockstep: unconfigured garments render exactly like today (no negative prompt, no composite). Configured garments get both.

### 7. Design Number Parser (NEW)

`src/lib/design-number.ts` — `parseDesignNumber('D22889-D933-H087')` → `{styleCode: 'D22889', colorwayCode: 'D933', sizeCode: 'H087'}`. Tolerates missing segments and case. Unparseable → null.

### 8. Asset Pipeline

- `public/label-assets/L2936-8.0.png` — RGBA template artwork (alpha = height map for Sobel deboss)
- `public/label-assets/leather-pebbled.png` — shared pebbled grain tile
- Served by Next.js at build time; referenced as relative `/label-assets/...` URLs in Firestore; `resolveAssetUrl()` converts to `http://localhost:${PORT}/...` for Cloud Run self-fetch.

## Testing Done

- TypeScript compilation: ✅ `./node_modules/.bin/tsc --noEmit` clean (exit 0)
- Failure-isolation audit: every error path in `applyAutoHybridLabel` returns the original buffer
- Gate predicate verification: `hasLabelConfigForItem` and `applyAutoHybridLabel` both use `resolveLabelRenderConfig` — prompt/shader stay locked together

**NOT tested:** runtime execution against a real generated shot. First run will be in prod.

## Deployed

- **NOT YET DEPLOYED** — awaiting explicit deploy instruction. See `NEXT-STEP.md`.

## Rollback

- `gcloud run services update gstar-ai-studio --set-env-vars ENABLE_HYBRID_LABEL_AUTO=0` — kills the auto-label path without a redeploy. OFF values (case-insensitive): `0`, `false`, `off`, `no`.
- Per-garment: delete the `labelStyles/${styleCode}` doc in Firestore. Gate flips to unconfigured on the next job.
- Manual escape hatch: `POST /api/shots/[id]/apply-label` still works.

## Cost Impact

- Pocket detection: +1 Gemini 2.5 Flash Lite call per configured M02/M04 shot (~$0.002)
- Firestore reads: +1 to +3 per back shot for the gate (~€0.0001/doc, negligible)
- Python subprocess: CPU only, no API cost
- Estimated cost per job: +$0.004 to +$0.008 total when all shots are configured

## Files Changed

| File | Type | Summary |
|------|------|---------|
| src/lib/pipeline/generate.ts | Modified | Negative prompt + `hasLabelConfigForItem` gate on M04/M02 back shots |
| src/app/api/generate/route.ts | Modified | Post-process hook calls `applyAutoHybridLabel()` at 78% |
| src/app/wardrobe/page.tsx | Modified | "Configure leather label →" button in detail panel |
| src/lib/label-auto.ts | **New** | Orchestrator with full failure isolation |
| src/lib/label-render.ts | **New** | Homography + asset URL resolver + config bridge |
| src/lib/pocket-detector.ts | **New** | Gemini pocket corner detection |
| src/lib/design-number.ts | **New** | `D{style}-D{colorway}-H{size}` parser |
| src/app/api/label/templates/route.ts | **New** | Templates CRUD |
| src/app/api/label/templates/[templateId]/route.ts | **New** | Template fetch |
| src/app/api/label/styles/[styleCode]/route.ts | **New** | Styles tier CRUD |
| src/app/api/label/colorways/[docId]/route.ts | **New** | Colorways tier CRUD |
| src/app/api/label/bootstrap/route.ts | **New** | Idempotent L2936-8.0 seed |
| src/app/api/label/image-proxy/route.ts | **New** | CORS proxy for canvas sampling |
| src/app/wardrobe/[id]/label-setup/page.tsx | **New** | Setup UI (~1280 lines) |
| LABEL-STRATEGY.md | Rewrite | 3-tier hybrid shader pipeline |
| NEXT-STEP.md | Rewrite | Deploy + post-deploy checklist |
| docs/SKILL-UPDATE-HYBRID-LABEL.md | **New** | Patch text for the read-only SKILL.md mount |

## Label isolation mode (future hook)

L2936 is a full-rectangle label, so `run_preview()` in `scripts/label_hybrid.py`
writes `alpha = 255` for the entire output canvas. That's fine for rectangular
labels. For future non-rectangular labels (woven tags, patches, embroidered
labels, cut-out shapes) the hook is:

1. Add `labelSilhouetteUrl: string` to the `labelTemplates` Firestore schema
   (RGBA PNG where the alpha channel defines where the label is vs transparent).
2. `resolveLabelRenderConfig()` in `src/lib/firestore.ts` passes it through.
3. `src/app/api/label/preview/route.ts` downloads it alongside `materialTileUrl`
   and `artworkUrl`, forwards the temp path in the args JSON.
4. `run_preview()` uses it as the output alpha channel: resize to canvas, then
   `label_bgra[:, :, 3] = silhouette_alpha`. If absent, keep current full-rect.
5. `run()` uses the same silhouette to confine the composite mask (instead of
   the current full-rectangle quad fill).

Backward compatible: existing templates without the field fall back to full-rect.

## Blue-in-preview bug (fixed 2026-04-11)

Symptom: picker preview PNG showed blue-ish pixels scattered through the
tinted leather, visible when dragged onto a white t-shirt.

Root cause: `tint_texture()` preserved L, a, AND b channel variance from the
source material tile. For a target near-neutral colour like `#3d3934`
(target_lab ≈ 128/128 in a/b), any source pixel below `mean_b` ended up below
128 in b after recentering → blue half of the a*b* plane → visible blue.
Same mechanism for the a channel → green contamination.

Fix: keep L variance (grain is a luminance phenomenon), flatten a/b to target
chroma with zero variance. Pure target colour, grain preserved through L.

Related reverts done in the same fix:
- Removed cv2.inpaint stage from `run()` — was smearing t-shirt/jeans pixels
  around the label quad because it was compensating for the wrong diagnosis.
- Removed 9x9 mask dilate in `warp_texture_into_quad()` — same reason.
- Removed `PREVIEW_DILATION = 0.08` in `LabelCornerPicker.tsx` — same.

The user handles are now the single source of truth for label position, and
the tint is mathematically free of chroma surprises.
