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
