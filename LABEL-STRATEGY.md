# G-Star AI Studio — Label Composite Strategy

## The Problem

Gemini hallucinates brand labels, logos, and embroidered text on garments. No amount of prompt engineering fixes this — positive framing ("reproduce ONLY what references show") improved general garment fidelity but labels remain unreliable. The AI redraws from concept, it doesn't pixel-copy. This is a fundamental limitation of image generation models.

**Inpainting won't fix it either.** Even Gemini's edit/inpainting mode is still a generation step — it synthesizes new pixels based on surrounding context and text prompts. It optimizes for seamless blending, which is the opposite of what a rigid leather label with precise text needs.

## Current Solution: Deterministic Composite Pipeline

The only reliable approach: extract real label pixels from photography, then warp and blend them onto AI-generated images. No generation, no hallucination.

### Architecture

```
Mannequin photo (back view)
    ↓
HSV color detection → find brown/tan leather pixels
    ↓
GrabCut segmentation → pixel-perfect label extraction (RGBA PNG)
    ↓
[stored for reuse per garment]

AI-generated back shot (M02/M04)
    ↓
Gemini detectLabelCorners() → 4 corner points of hallucinated label area
    ↓
cv2.inpaint() → remove hallucinated label (TELEA, radius=5)
    ↓
cv2.getPerspectiveTransform() → warp extracted label to corner positions
    ↓
Alpha blend with Gaussian edge feathering → final composite
```

### Files

| File | Role |
|------|------|
| `scripts/label_composite.py` | All OpenCV operations: HSV detection, GrabCut, perspective warp, alpha blend |
| `src/lib/label-composite.ts` | TypeScript wrapper: downloads images, calls Gemini for corners, spawns Python subprocess |
| `src/app/api/generate/route.ts` | Integration: Section "3-LABEL" extracts, Section "POST-PROCESS 5" composites |

### Applied To

- **M02** (cropped back) — label composite after generation
- **M04** (full body back) — label composite after generation

### Why NOT Seamless Clone

Tried twice, failed twice:
- V1 (without inpainting): orange color bleeding from hallucinated label underneath
- V2 (with inpainting): Poisson blending shifted label brown/gray to match surrounding denim blue
- Alpha blending with Gaussian feathering preserves exact label colors

### Why NOT Gemini Inpainting

Even with precise masking and hyper-descriptive text prompts, inpainting is still generation:
- The model prioritizes seamless blending over pixel fidelity
- Text reproduction is unreliable (wrong font, wrong spacing, wrong characters)
- Leather texture/grain is approximated, not transferred
- Multiple retries needed with inconsistent results
- The composite pipeline is deterministic — same input always produces same output

---

## Input Requirements

### Current: Mannequin Back View Extraction

Labels are extracted from the mannequin 360° rotation photos (back view = angle index at totalAngles/2). Quality depends on:
- Resolution of mannequin photos
- Label visibility and contrast against fabric
- Lighting consistency

### Future: High-Resolution Flat Label Photos

Bruno will request dedicated high-res flat label photographs from G-Star. These will be:
- Shot flat on neutral background (not on garment)
- High resolution (minimum 1000×1000px for the label area)
- Consistent lighting, no shadows
- One photo per label type (leather patch, woven tag, embroidered logo, etc.)

**When these arrive, the pipeline should:**

1. **Skip HSV/GrabCut extraction** — flat photos on neutral background can be segmented with simple background removal (alpha matting or even threshold-based)
2. **Store as pre-extracted label assets** in GCS, linked to garment or garment category
3. **Use directly in the perspective warp step** — no extraction needed per generation
4. **Benefits**: cleaner edges, higher resolution label source, consistent quality across all garments of the same type

### Implementation Plan for Flat Label Photos

```
New field on WardrobeItem (Firestore):
  labelImageUrl: string       // high-res flat label photo URL in GCS
  labelType: 'leather-patch' | 'woven-tag' | 'embroidered' | 'printed'

Updated pipeline:
  IF wardrobe item has labelImageUrl:
    → Use flat label photo directly (skip HSV/GrabCut extraction)
    → Simple background removal (threshold or alpha matting)
    → Store extracted RGBA in GCS cache
  ELSE:
    → Fall back to current mannequin extraction pipeline
```

**Wardrobe page UI changes needed:**
- Add "Label Image" upload field per wardrobe item
- Label type selector dropdown
- Preview of extracted label (after background removal)

---

## Edge Cases & Known Issues

1. **Low-contrast labels** — Raw indigo denim + dark leather = GrabCut struggles. Flat label photos eliminate this entirely.

2. **Corner detection failures** — Gemini `detectLabelCorners()` sometimes returns bad corners (outside bounds, wrong order). Python script validates and clamps. If degenerate (zero area), falls back to center-placement. **Important:** Use normalized 0-1000 coordinate range (Gemini's native spatial grid), not raw pixel coordinates. Convert to pixels in Python after receiving the response. This eliminates coordinate drift from LLM math.

3. **Multiple labels per garment** — Some garments have waistband label + back pocket label + inside tag. Currently only compositing the primary back label. Flat label photos could enable multi-label composite.

4. **Label size variation** — Labels on different garment sizes (S vs XXL) have slightly different proportions on the garment. The perspective warp handles this naturally via corner detection.

5. **Non-leather labels** — Woven tags, embroidered logos, printed marks have different HSV profiles. Current HSV ranges are tuned for brown/tan leather only. Flat label photos bypass this limitation entirely.

---

## Decision Record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03 (v10) | Alpha blend over seamless clone | Preserves exact label colors; Poisson blending washes out |
| 2026-03-27 (v12) | Positive prompt framing for anti-hallucination | 100% vs 0% success rate per Google research — but labels still hallucinate |
| 2026-03-27 (v12) | Reject Gemini inpainting for labels | Still generation, not transfer. Composite pipeline is deterministic and reliable |
| 2026-03-27 (v12) | Reject ControlNet/Stable Diffusion | Would require second AI stack. SD quality below Gemini for fashion ECOM. Composite already solves the problem |
| 2026-03-27 (v12) | Plan: high-res flat label photos | Eliminates HSV/GrabCut extraction step, higher quality source, works for all label types |

---

## Quick Reference: What To Do When Labels Come Back

When Bruno gets the flat label photos from G-Star:

1. **Add `labelImageUrl` field** to WardrobeItem type in `src/types/index.ts`
2. **Add upload UI** to wardrobe page for label images
3. **Update `label-composite.ts`** to check for `labelImageUrl` before falling back to mannequin extraction
4. **Simple background removal** for flat photos: threshold on white/neutral background → alpha mask → save RGBA PNG
5. **Cache extracted labels** in GCS: `labels/{wardrobeItemId}/extracted.png`
6. **Test with one garment first**, compare composite quality vs current mannequin extraction
7. **Roll out** to all garments with flat label photos
