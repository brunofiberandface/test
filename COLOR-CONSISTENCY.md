# G-Star AI Studio — Color & Wash Consistency Pipeline

## The Problem

Gemini treats every generation as a fresh synthesis. Even with the same flat lay reference image, color/wash drifts between the 5 shot types (M01-M05). A dark indigo might render as medium blue in M03 but near-black in M04. This is a fundamental limitation — the model simulates lighting on a 3D form, and each pose/angle creates different shadow and highlight distributions.

## Current Mitigation (v12)

- **M03 anchor system**: M03 generates first and is saved as a "garment anchor" — subsequent shots reference it for color consistency
- **14 reference images**: Flat lay + mannequin + fit model photos all sent as references
- **Positive prompt framing**: "reproduce ONLY the exact color/wash from references"

These help but don't eliminate drift. The wash can still shift 10-20% between shots.

## Planned Solution: LAB Histogram Matching

Same hybrid architecture as the label composite: AI for semantic understanding, deterministic code for pixel precision.

### Architecture

```
AI-generated shot (any M01-M04)
    ↓
Gemini Vision → bounding boxes per visible garment section
    ↓
cv2.grabCut per box → pixel-perfect garment mask (with skin HSV exclusion)
    ↓
Convert generated image + flat lay reference to LAB color space
    ↓
skimage.exposure.match_histograms on A+B channels only (within mask)
Keep L channel from generated image (preserves 3D lighting)
    ↓
Gaussian-feathered alpha-blend corrected pixels into original using mask
    ↓
Final color-corrected shot
```

### Why LAB Color Space

RGB histogram matching would flatten the 3D lighting — shadows and highlights would shift to match the flat lay's even lighting. LAB separates luminance (L) from color (A = green-red, B = blue-yellow):

- **L channel (luminance)**: Keep from AI generation — this is the 3D lighting, fabric folds, shadow depth
- **A channel (green-red)**: Match to flat lay — snaps color hue back to reality
- **B channel (blue-yellow)**: Match to flat lay — snaps wash tone back to reality

Result: photorealistic 3D lighting + mathematically correct color.

### Dependencies

```
pip install scikit-image  # for skimage.exposure.match_histograms
# OpenCV already installed for label composite
# numpy already installed
```

Add to Dockerfile alongside existing OpenCV dependencies.

---

## Implementation Plan

### Step 1: Garment Segmentation — Bounding Boxes + GrabCut

**Important:** Do NOT ask Gemini Vision for polygon coordinates. VLMs return simplified, low-resolution polygons (8-12 points) that create blocky masks. Coordinate hallucination is common. Instead, use the same proven pattern as the label composite: Gemini Vision for semantic understanding (bounding boxes) → OpenCV for pixel-precise masking (GrabCut).

**Gemini Vision prompt for bounding boxes:**
```
Analyze this image and return JSON bounding boxes for each separately visible section of the MAIN GARMENT FABRIC ONLY (the denim pants/jeans).

Return a separate bounding box for each contiguous visible area (e.g., if a hand occludes the garment, return separate boxes for the fabric visible on each side).

Strictly EXCLUDE from boxes:
- Background (white studio)
- Model's skin (hands, ankles, neck)
- Shoes and socks
- Belt and belt loops
- Brand labels (leather patch, woven tags)
- Styling items (shirt, jacket — only the PRIMARY garment)

Return bounding boxes in the format [ymin, xmin, ymax, xmax]. Use a normalized coordinate system from 0 to 1000, where [0,0] is the top-left corner and [1000,1000] is the bottom-right corner.

Return format:
{
  "boxes": [
    { "label": "left-leg", "bbox": [ymin, xmin, ymax, xmax] },
    { "label": "right-leg", "bbox": [ymin, xmin, ymax, xmax] },
    { "label": "waistband", "bbox": [ymin, xmin, ymax, xmax] }
  ]
}

Return ONLY valid JSON.
```

**Why bounding boxes over polygons:** VLMs are reliable at bounding boxes (simple 4-number outputs) but brittle at dense polygon coordinates. GrabCut then refines to pixel-perfect edges using color clustering — the same bbox-first, pixel-second discipline used by the hybrid label pipeline (Gemini 2.5 Flash Lite returns a 4-corner pocket quad; homography + OpenCV handles the rest).

**Fallback:** If Gemini returns malformed JSON, fall back to full-image approach: white background exclusion (>240 gray) + skin HSV exclusion.

### Step 2: Pixel-Perfect Mask via GrabCut

```python
import cv2
import numpy as np

def normalize_to_pixel(norm_coord, dimension):
    """Convert Gemini's 0-1000 normalized coordinate to pixel coordinate."""
    return int((norm_coord / 1000.0) * dimension)

def create_garment_mask(image, boxes):
    """
    Create pixel-perfect garment mask using Gemini bounding boxes + GrabCut.
    Same Gemini-for-semantic / OpenCV-for-pixels split used by the hybrid
    label pipeline (see LABEL-STRATEGY.md).

    Args:
        image: BGR image (the generated shot)
        boxes: List of {"label": str, "bbox": [ymin, xmin, ymax, xmax]}
               Coordinates are NORMALIZED 0-1000 (Gemini's native spatial grid)

    Returns:
        Binary mask (255 = garment, 0 = not garment)
    """
    h, w = image.shape[:2]
    combined_mask = np.zeros(image.shape[:2], dtype=np.uint8)

    for box in boxes:
        ny, nx, ny2, nx2 = box['bbox']

        # Convert normalized 0-1000 coords to pixel coords
        # Gemini Vision uses a 1000x1000 spatial token grid internally.
        # Asking for raw pixel coords forces the LLM to do math (unreliable).
        # Normalized coords are the model's native output → no hallucination.
        ymin = normalize_to_pixel(ny, h)
        xmin = normalize_to_pixel(nx, w)
        ymax = normalize_to_pixel(ny2, h)
        xmax = normalize_to_pixel(nx2, w)

        # Clamp to image bounds
        ymin = max(0, ymin)
        xmin = max(0, xmin)
        ymax = min(h, ymax)
        xmax = min(w, xmax)

        # Skip degenerate boxes
        if ymax - ymin < 10 or xmax - xmin < 10:
            continue

        # GrabCut with bounding box initialization
        gc_mask = np.zeros(image.shape[:2], dtype=np.uint8)
        bgd_model = np.zeros((1, 65), np.float64)
        fgd_model = np.zeros((1, 65), np.float64)

        rect = (xmin, ymin, xmax - xmin, ymax - ymin)
        cv2.grabCut(image, gc_mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)

        # Extract foreground (definite + probable)
        fg_mask = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

        # Exclude skin pixels via HSV (same approach as label pipeline)
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        # Skin tones: H 0-25, S 40-170, V 80-255
        skin_mask = cv2.inRange(hsv, (0, 40, 80), (25, 170, 255))
        skin_mask = cv2.dilate(skin_mask, np.ones((5, 5), np.uint8), iterations=1)
        fg_mask[skin_mask > 0] = 0

        combined_mask = cv2.bitwise_or(combined_mask, fg_mask)

    # Morphological cleanup
    kernel = np.ones((5, 5), np.uint8)
    combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel)
    combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, kernel)

    return combined_mask
```

### Step 3: LAB Histogram Matching

```python
from skimage.exposure import match_histograms
import cv2
import numpy as np

def correct_garment_color(generated_img, flat_lay_img, garment_mask):
    """
    Match garment color to flat lay reference while preserving AI lighting.

    Args:
        generated_img: BGR image from AI generation
        flat_lay_img: BGR image of flat lay reference (true color source)
        garment_mask: Binary mask of garment pixels (255 = garment)

    Returns:
        Color-corrected BGR image
    """
    # Convert to LAB
    gen_lab = cv2.cvtColor(generated_img, cv2.COLOR_BGR2LAB).astype(np.float32)
    flat_lab = cv2.cvtColor(flat_lay_img, cv2.COLOR_BGR2LAB).astype(np.float32)

    # Extract masked pixels only
    mask_bool = garment_mask > 0

    # Get garment pixels from generated image (A and B channels)
    gen_a = gen_lab[:, :, 1][mask_bool]
    gen_b = gen_lab[:, :, 2][mask_bool]

    # Get reference pixels from flat lay (entire garment area)
    # For flat lay, use simple background removal (white threshold)
    flat_gray = cv2.cvtColor(flat_lay_img, cv2.COLOR_BGR2GRAY)
    flat_mask = flat_gray < 240  # exclude white background
    flat_a = flat_lab[:, :, 1][flat_mask]
    flat_b = flat_lab[:, :, 2][flat_mask]

    # Match A and B channel histograms
    matched_a = match_histograms(gen_a, flat_a)
    matched_b = match_histograms(gen_b, flat_b)

    # Rebuild LAB image: keep L from generated, use matched A and B
    result_lab = gen_lab.copy()
    result_lab[:, :, 1][mask_bool] = matched_a
    result_lab[:, :, 2][mask_bool] = matched_b

    # Convert back to BGR
    result_bgr = cv2.cvtColor(result_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)

    # Alpha blend: corrected pixels inside mask, original outside
    # Feather the mask edges for smooth transition
    feathered = cv2.GaussianBlur(garment_mask, (7, 7), 0)
    feathered_3ch = np.stack([feathered, feathered, feathered], axis=-1) / 255.0

    final = (result_bgr * feathered_3ch + generated_img * (1 - feathered_3ch)).astype(np.uint8)
    return final
```

### Step 4: Integration in Pipeline

**Where to add** in `src/app/api/generate/route.ts`:
- After generation, before final GCS upload
- After label composite (for M02/M04) — color correct AFTER label placement
- Skip for M05 (detail/close-up — different lighting context)

**New file:** `scripts/color_match.py` (alongside `label_composite.py`)
**New wrapper:** `src/lib/color-match.ts` (same pattern as `label-composite.ts`)

**Pipeline order for back shots (M02/M04):**
1. Generate image (Gemini)
2. Label composite (OpenCV — extract real label, perspective warp, alpha blend)
3. Color correction (Gemini Vision segmentation → LAB histogram match)
4. Upload to GCS

---

## Edge Cases & Gotchas

1. **Flat lay lighting vs studio lighting**: The flat lay has flat, even lighting. The generated image has directional studio lighting. LAB separation handles this — but extreme shadow areas (deep folds) might look slightly off after A/B matching. Monitor quality.

2. **Multi-fabric garments**: A denim jacket with leather collar has two different color profiles. The segmentation prompt must handle this — either match only the primary fabric, or segment separately and match each to its reference.

3. **Wash gradients**: Some denim has intentional wash gradients (darker at waist, lighter at knee). Histogram matching preserves the overall distribution but might smooth gradients slightly. Test with gradient washes.

4. **Over-correction risk**: If the flat lay has very different lighting than what the model simulates, aggressive histogram matching can look unnatural. Consider a blending factor: `corrected = alpha * matched + (1 - alpha) * original` where alpha = 0.7-0.8 instead of 1.0.

5. **Segmentation failures**: Gemini Vision might include skin pixels in the mask (especially at hem/cuff edges). The morphological open step helps, but adding a skin HSV exclusion filter as a safety net is recommended.

6. **Performance**: Gemini Vision call for segmentation adds ~2-3s per shot. Histogram matching itself is <100ms. Total overhead per shot: ~3s.

7. **Normalized coordinates (0-1000)**: ALWAYS use 0-1000 range for Gemini Vision bounding boxes, never raw pixel coordinates. Gemini's spatial understanding uses a 1000x1000 quantized grid internally. Asking for raw 2K pixel coords forces the LLM to do inline math → coordinate drift and hallucination. Convert to pixels in Python after receiving the response. This applies to both the color consistency pipeline AND the label corner detection pipeline.

---

## Metrics to Track

- **Delta E (CIE2000)**: Perceptual color difference between flat lay and corrected garment. Target: Delta E < 3.0 (imperceptible to most viewers).
- **Before/after comparison**: Run same job with and without color correction, compare Delta E.
- **Per-shot variance**: Measure Delta E across all 5 shots. Variance should drop significantly with correction.

---

## Decision Record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-27 | LAB histogram matching over RGB | Preserves 3D lighting (L channel) while correcting color (A/B channels) |
| 2026-03-27 | Bounding boxes + GrabCut over VLM polygons | VLMs return blocky, low-res polygons (8-12 points) with hallucinated coordinates. Bounding boxes are reliable. GrabCut refines to pixel-perfect edges — same proven pattern as label extraction |
| 2026-03-27 | Multiple bounding boxes over single box | Handles occlusion (hands, crossed legs) — separate GrabCut per visible region |
| 2026-03-27 | GrabCut over SAM2 | Already in stack (OpenCV), no additional model deployment. SAM2 would require separate inference server |
| 2026-03-27 | Apply AFTER label composite | Label has its own colors — don't shift them to denim palette |
| 2026-03-27 | Skip M05 (detail shot) | Close-up lighting context differs too much from flat lay |
| 2026-03-27 | Rejected Gemini inpainting for color fix | Still a generation step — histogram matching is deterministic |

---

## Quick Reference: What To Build

When ready to implement:

1. **Add `scikit-image` to Dockerfile** alongside existing OpenCV deps
2. **Create `scripts/color_match.py`** with `create_garment_mask()` and `correct_garment_color()` functions
3. **Create `src/lib/color-match.ts`** wrapper (same pattern as `label-composite.ts`): downloads images, calls Gemini Vision for segmentation, spawns Python subprocess
4. **Add to `generate/route.ts`** as post-processing step after label composite, before GCS upload
5. **Add `colorCorrected: boolean` flag** to Shot type in Firestore for tracking
6. **Test with one garment across all 5 shots**, measure Delta E before/after
7. **Tune blending factor** (start at 0.8, adjust based on visual quality)
