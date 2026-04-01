#!/usr/bin/env python3
"""
Label Composite — Photoshop-quality label extraction, perspective warp, and seamless blending.

This replaces the Sharp-based bbox crop+paste approach with proper computer vision:
1. HSV color detection — finds the brown leather label specifically (not denim)
2. GrabCut segmentation — isolates the label with alpha transparency
3. Seamless clone — Poisson blending for natural edge integration

Usage (called from Node.js via subprocess):
  python3 scripts/label_composite.py extract <mannequin_path> <output_path>
  python3 scripts/label_composite.py composite <generated_path> <label_path> <output_path> [corners_json]
  python3 scripts/label_composite.py full <mannequin_path> <generated_path> <output_path> [corners_json]

All paths are local filesystem paths (downloaded by Node.js before calling this).
Outputs JSON to stdout with status and diagnostics.
"""

import sys
import json
import os
import numpy as np

try:
    import cv2
except ImportError:
    print(json.dumps({"error": "OpenCV not installed", "status": "fatal"}))
    sys.exit(1)


def log(msg: str):
    """Log to stderr (stdout is reserved for JSON result)."""
    print(f"[LabelCV] {msg}", file=sys.stderr)


def to_native(obj):
    """Convert numpy types to Python native for JSON serialization."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: to_native(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_native(x) for x in obj]
    return obj


# ─── STEP 1: EXTRACT LABEL WITH COLOR DETECTION + GRABCUT ───────────────────

def extract_label(image_path: str, output_path: str) -> dict:
    """
    Extract the leather label from a mannequin back-view image.

    Strategy:
    1. Load image, handle landscape orientation (mannequin 360° photos are landscape)
    2. Crop to waistband region (top 20-50% of back view)
    3. HSV color filter for brown/tan leather tones (NOT dark denim)
    4. Find the best rectangular contour that matches label size
    5. GrabCut refinement for pixel-perfect segmentation
    6. Output: RGBA PNG with transparent background
    """
    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"Cannot read image: {image_path}", "status": "failed"}

    h, w = img.shape[:2]
    log(f"Input: {w}x{h}")

    # Handle landscape mannequin images — rotate to portrait
    if w > h:
        log(f"Landscape detected ({w}x{h}) — rotating to portrait")
        img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        h, w = img.shape[:2]
        log(f"After rotation: {w}x{h}")

    # Focus on the waistband region (top 20-50% of portrait image)
    # The label sits on the back waistband
    y_start = int(h * 0.20)
    y_end = int(h * 0.50)
    x_start = int(w * 0.10)
    x_end = int(w * 0.90)

    waistband = img[y_start:y_end, x_start:x_end]
    crop_h, crop_w = waistband.shape[:2]
    log(f"Waistband crop: ({x_start},{y_start}) to ({x_end},{y_end}) = {crop_w}x{crop_h}")

    # ─── HSV COLOR DETECTION FOR LEATHER LABEL ───
    # G-Star leather labels are brown/tan colored patches.
    # In HSV space, leather is:
    #   Hue: 5-30 (orange-brown range)
    #   Saturation: 20-200 (moderate saturation)
    #   Value: 40-210 (not too dark, not too bright)
    hsv = cv2.cvtColor(waistband, cv2.COLOR_BGR2HSV)

    # Range 1: warm brown leather
    mask_leather1 = cv2.inRange(hsv, np.array([5, 20, 40]), np.array([30, 200, 210]))
    # Range 2: darker brown / aged leather
    mask_leather2 = cv2.inRange(hsv, np.array([0, 15, 30]), np.array([20, 180, 160]))
    # Range 3: reddish-brown leather
    mask_leather3 = cv2.inRange(hsv, np.array([0, 30, 50]), np.array([15, 220, 200]))

    leather_mask = cv2.bitwise_or(mask_leather1, mask_leather2)
    leather_mask = cv2.bitwise_or(leather_mask, mask_leather3)

    # Morphological cleanup — close gaps, remove noise
    kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    kernel_medium = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    leather_mask = cv2.morphologyEx(leather_mask, cv2.MORPH_CLOSE, kernel_medium, iterations=2)
    leather_mask = cv2.morphologyEx(leather_mask, cv2.MORPH_OPEN, kernel_small, iterations=1)

    # Find contours in the leather mask
    contours, _ = cv2.findContours(leather_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        log("No leather-colored contours found — trying broader color range")
        # Fallback: broader range for unusual label colors
        mask_broad = cv2.inRange(hsv, np.array([0, 10, 30]), np.array([35, 220, 220]))
        mask_broad = cv2.morphologyEx(mask_broad, cv2.MORPH_CLOSE, kernel_medium, iterations=2)
        mask_broad = cv2.morphologyEx(mask_broad, cv2.MORPH_OPEN, kernel_small, iterations=1)
        contours, _ = cv2.findContours(mask_broad, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        log("No leather contours found even with broad range")
        return {"error": "No leather-colored label found", "status": "failed"}

    log(f"Found {len(contours)} leather-colored contours")

    # Score contours: we want the LABEL, not random brown spots
    # Label characteristics:
    #   - Roughly rectangular (aspect 0.4 to 3.0 — can be taller or wider)
    #   - Small-to-medium size: 0.01% to 8% of waistband crop area
    #   - In the waistband region (center-ish, but can be off-center)
    #   - Compact (high extent = fill ratio of bounding rect)
    best_contour = None
    best_score = 0
    crop_area = crop_w * crop_h

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # Size constraints: label should be 0.01% to 8% of waistband area
        area_ratio = area / crop_area
        if area_ratio < 0.0001 or area_ratio > 0.08:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        if cw < 15 or ch < 15:
            continue

        aspect = cw / max(ch, 1)
        rect_area = cw * ch
        extent = area / max(rect_area, 1)  # Fill ratio (1.0 = perfect rectangle)

        # Labels can be wider or taller (aspect 0.4 to 3.5)
        if aspect < 0.3 or aspect > 4.0:
            continue

        # Prefer squarish to moderately rectangular
        aspect_score = 1.0 if 0.5 < aspect < 2.5 else 0.5

        # Prefer rectangular (high extent)
        extent_score = extent ** 0.5

        # Prefer medium size — not too small, not too large
        size_score = 1.0 if 0.001 < area_ratio < 0.03 else 0.5

        # Label can be off-center (right side is common on G-Star)
        center_x = (x + cw / 2) / crop_w
        center_score = max(0.2, 1.0 - abs(center_x - 0.55) * 2)  # Slight right bias

        # Prefer upper-to-middle portion (waistband area, not pockets)
        center_y = (y + ch / 2) / crop_h
        vertical_score = 1.0 if center_y < 0.65 else 0.3

        score = aspect_score * extent_score * size_score * center_score * vertical_score

        if score > best_score:
            best_score = score
            best_contour = cnt
            log(f"  Candidate: ({x},{y}) {cw}x{ch}, area={area_ratio*100:.2f}%, aspect={aspect:.2f}, "
                f"extent={extent:.2f}, center_x={center_x:.2f}, score={score:.3f}")

    if best_contour is None:
        log("No suitable leather label contour found")
        return {"error": "No label-shaped leather contour found", "status": "failed"}

    # Get bounding rect for GrabCut
    x, y, cw, ch = cv2.boundingRect(best_contour)
    log(f"Selected label: ({x},{y}) {cw}x{ch}")

    # Add generous padding for GrabCut context
    pad = max(20, int(max(cw, ch) * 0.3))
    gc_x1 = max(0, x - pad)
    gc_y1 = max(0, y - pad)
    gc_x2 = min(crop_w, x + cw + pad)
    gc_y2 = min(crop_h, y + ch + pad)
    gc_rect = (gc_x1, gc_y1, gc_x2 - gc_x1, gc_y2 - gc_y1)

    log(f"GrabCut rect: {gc_rect}")

    # GrabCut segmentation
    gc_mask = np.zeros(waistband.shape[:2], np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    try:
        cv2.grabCut(waistband, gc_mask, gc_rect, bgd_model, fgd_model, 8, cv2.GC_INIT_WITH_RECT)
        label_mask = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    except cv2.error as e:
        log(f"GrabCut failed: {e} — using contour mask")
        label_mask = np.zeros(waistband.shape[:2], np.uint8)
        cv2.drawContours(label_mask, [best_contour], -1, 255, -1)

    # Constrain GrabCut result to the area around our detected contour
    # GrabCut can "leak" into surrounding denim/skin — clip it tightly
    constraint_mask = np.zeros_like(label_mask)
    clip_pad = max(5, int(max(cw, ch) * 0.08))  # Tight clipping (~8%)
    clip_x1 = max(0, x - clip_pad)
    clip_y1 = max(0, y - clip_pad)
    clip_x2 = min(crop_w, x + cw + clip_pad)
    clip_y2 = min(crop_h, y + ch + clip_pad)
    constraint_mask[clip_y1:clip_y2, clip_x1:clip_x2] = 255
    label_mask = cv2.bitwise_and(label_mask, constraint_mask)

    # Additional constraint: only keep pixels that look like leather
    # This prevents skin/denim bleed at label edges
    leather_constraint = leather_mask[clip_y1:clip_y2, clip_x1:clip_x2]
    # Dilate the leather mask slightly to fill label interior
    leather_dilated = cv2.dilate(leather_constraint, np.ones((7, 7), np.uint8), iterations=2)
    label_region = label_mask[clip_y1:clip_y2, clip_x1:clip_x2]
    label_region_filtered = cv2.bitwise_and(label_region, leather_dilated)
    label_mask[clip_y1:clip_y2, clip_x1:clip_x2] = label_region_filtered

    # Morphological cleanup — erode to cut noisy edges, then close gaps
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    label_mask = cv2.morphologyEx(label_mask, cv2.MORPH_ERODE, kernel, iterations=1)
    label_mask = cv2.morphologyEx(label_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    label_mask = cv2.morphologyEx(label_mask, cv2.MORPH_OPEN, kernel, iterations=1)

    # Feather edges slightly for smoother blending
    label_mask = cv2.GaussianBlur(label_mask, (5, 5), 0)

    # Crop to just the label region
    label_x, label_y, label_w, label_h = cv2.boundingRect(label_mask)

    if label_w < 15 or label_h < 10:
        log(f"Label too small after GrabCut: {label_w}x{label_h}")
        return {"error": f"Label too small: {label_w}x{label_h}", "status": "failed"}

    # Small padding around the cropped label
    lpad = max(3, int(max(label_w, label_h) * 0.05))
    lx1 = max(0, label_x - lpad)
    ly1 = max(0, label_y - lpad)
    lx2 = min(crop_w, label_x + label_w + lpad)
    ly2 = min(crop_h, label_y + label_h + lpad)

    label_rgb = waistband[ly1:ly2, lx1:lx2]
    label_alpha = label_mask[ly1:ly2, lx1:lx2]

    # Create RGBA output
    b, g, r = cv2.split(label_rgb)
    rgba = cv2.merge([b, g, r, label_alpha])

    cv2.imwrite(output_path, rgba)

    final_h, final_w = rgba.shape[:2]
    non_transparent = np.count_nonzero(label_alpha) / max(label_alpha.shape[0] * label_alpha.shape[1], 1)

    log(f"Label extracted: {final_w}x{final_h}px, {non_transparent*100:.0f}% non-transparent")

    return {
        "status": "ok",
        "width": int(final_w),
        "height": int(final_h),
        "opacity_pct": round(float(non_transparent * 100), 1),
        "output": output_path,
        "source_bbox": {
            "x": int(x_start + lx1),
            "y": int(y_start + ly1),
            "w": int(lx2 - lx1),
            "h": int(ly2 - ly1),
        }
    }


# ─── STEP 2: DETECT 4 CORNERS + PERSPECTIVE WARP ───────────────────────────

def sort_corners(pts: list) -> list:
    """Sort 4 corner points into order: top-left, top-right, bottom-right, bottom-left."""
    pts = np.array(pts, dtype=np.float32)
    s = pts.sum(axis=1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    d = np.diff(pts, axis=1).flatten()
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return [tl.tolist(), tr.tolist(), br.tolist(), bl.tolist()]


def perspective_warp_label(label_rgba: np.ndarray, dst_corners: list) -> tuple:
    """
    Warp the flat label into the perspective of the target surface.
    Returns (warped_bgr, warped_mask).
    """
    lh, lw = label_rgba.shape[:2]
    src_corners = np.array([
        [0, 0], [lw - 1, 0], [lw - 1, lh - 1], [0, lh - 1],
    ], dtype=np.float32)
    dst = np.array(dst_corners, dtype=np.float32)
    M = cv2.getPerspectiveTransform(src_corners, dst)
    x_max = int(max(p[0] for p in dst_corners))
    y_max = int(max(p[1] for p in dst_corners))
    bgr = label_rgba[:, :, :3]
    alpha = label_rgba[:, :, 3]
    warped_bgr = cv2.warpPerspective(bgr, M, (x_max + 50, y_max + 50))
    warped_alpha = cv2.warpPerspective(alpha, M, (x_max + 50, y_max + 50))
    return warped_bgr, warped_alpha


# ─── STEP 3: COMPOSITE WITH SEAMLESS CLONE ─────────────────────────────────

def find_label_position_on_generated(target: np.ndarray) -> tuple:
    """
    Find where the hallucinated/existing label is on a generated back image.
    Returns (cx, cy, width, height) or None.

    Looks for brown/dark rectangular patches in the waistband area.
    """
    th, tw = target.shape[:2]

    # Waistband region: top 25-45% of the image
    y_start = int(th * 0.22)
    y_end = int(th * 0.42)
    x_start = int(tw * 0.20)
    x_end = int(tw * 0.80)
    roi = target[y_start:y_end, x_start:x_end]

    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

    # Look for brown/leather colored patches (hallucinated or real label)
    mask_label = cv2.inRange(hsv, np.array([5, 15, 30]), np.array([30, 200, 210]))
    # Also look for dark patches (some hallucinated labels are very dark)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, mask_dark = cv2.threshold(gray, 70, 255, cv2.THRESH_BINARY_INV)

    combined = cv2.bitwise_or(mask_label, mask_dark)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)
    combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    roi_h, roi_w = roi.shape[:2]
    best = None
    best_score = 0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        area_ratio = area / (roi_w * roi_h)
        if area_ratio < 0.002 or area_ratio > 0.15:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = cw / max(ch, 1)
        if aspect < 0.5 or aspect > 4.0:
            continue

        # Score: prefer rectangular, centered, label-sized
        center_x = (x + cw / 2) / roi_w
        center_score = max(0, 1.0 - abs(center_x - 0.5) * 3)
        aspect_score = 1.0 if 1.0 < aspect < 3.0 else 0.4
        size_score = 1.0 if 0.005 < area_ratio < 0.08 else 0.3

        score = center_score * aspect_score * size_score

        if score > best_score:
            best_score = score
            best = (x + x_start, y + y_start, cw, ch)

    if best:
        bx, by, bw, bh = best
        return (bx + bw // 2, by + bh // 2, bw, bh)
    return None


def composite_with_seamless_clone(
    target_path: str,
    label_path: str,
    output_path: str,
    corners_json: str = None,
) -> dict:
    """
    Composite the segmented label onto the generated image using OpenCV's seamlessClone.
    """
    target = cv2.imread(target_path)
    if target is None:
        return {"error": f"Cannot read target: {target_path}", "status": "failed"}

    label = cv2.imread(label_path, cv2.IMREAD_UNCHANGED)
    if label is None:
        return {"error": f"Cannot read label: {label_path}", "status": "failed"}

    th, tw = target.shape[:2]
    lh, lw = label.shape[:2]

    log(f"Target: {tw}x{th}, Label: {lw}x{lh} ({'RGBA' if label.shape[2] == 4 else 'BGR'})")

    # Parse corners if provided (from Gemini 4-corner detection)
    dst_corners = None
    if corners_json:
        try:
            dst_corners = json.loads(corners_json)
        except json.JSONDecodeError:
            log("Invalid corners JSON — will auto-detect")

    # Ensure label has alpha channel
    if label.shape[2] == 3:
        alpha = np.ones((lh, lw), dtype=np.uint8) * 255
        label = cv2.merge([label[:, :, 0], label[:, :, 1], label[:, :, 2], alpha])

    alpha = label[:, :, 3]
    label_bgr = label[:, :, :3]

    if dst_corners and len(dst_corners) == 4:
        # Perspective warp path (when Gemini provides corners)
        log(f"Perspective warp to corners: {dst_corners}")
        warped_bgr, warped_mask = perspective_warp_label(label, dst_corners)
        _, mask = cv2.threshold(warped_mask, 128, 255, cv2.THRESH_BINARY)

        moments = cv2.moments(mask)
        if moments["m00"] > 0:
            cx = int(moments["m10"] / moments["m00"])
            cy = int(moments["m01"] / moments["m00"])
        else:
            cx = int(np.mean([p[0] for p in dst_corners]))
            cy = int(np.mean([p[1] for p in dst_corners]))

        if warped_bgr.shape[0] < th or warped_bgr.shape[1] < tw:
            padded_bgr = np.zeros_like(target)
            padded_mask = np.zeros((th, tw), dtype=np.uint8)
            paste_h = min(warped_bgr.shape[0], th)
            paste_w = min(warped_bgr.shape[1], tw)
            padded_bgr[:paste_h, :paste_w] = warped_bgr[:paste_h, :paste_w]
            padded_mask[:paste_h, :paste_w] = mask[:paste_h, :paste_w]
            warped_bgr = padded_bgr
            mask = padded_mask

    else:
        # Auto-detect label position on the generated image
        log("No corners — auto-detecting label position on generated image")

        detected = find_label_position_on_generated(target)

        if detected:
            cx, cy, det_w, det_h = detected
            # Use detected size as guide, but ensure reasonable proportions
            target_w = max(det_w, int(tw * 0.04))
            target_h = max(det_h, int(target_w * lh / lw))
            log(f"Detected existing label at ({cx},{cy}), size {det_w}x{det_h} → resize to {target_w}x{target_h}")
        else:
            # Fallback: center of waistband, standard label size (~6% of image width)
            cx = tw // 2
            cy = int(th * 0.33)
            target_w = int(tw * 0.06)
            target_h = int(target_w * lh / lw)
            log(f"No label detected — placing at center ({cx},{cy}), size {target_w}x{target_h}")

        # Resize label to target size
        resized_bgr = cv2.resize(label_bgr, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        resized_alpha = cv2.resize(alpha, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

        # Create full-size source and mask
        warped_bgr = np.zeros_like(target)
        mask = np.zeros((th, tw), dtype=np.uint8)

        y1 = max(0, cy - target_h // 2)
        x1 = max(0, cx - target_w // 2)
        y2 = min(th, y1 + target_h)
        x2 = min(tw, x1 + target_w)
        ph = y2 - y1
        pw = x2 - x1

        warped_bgr[y1:y2, x1:x2] = resized_bgr[:ph, :pw]
        mask[y1:y2, x1:x2] = resized_alpha[:ph, :pw]

        _, mask = cv2.threshold(mask, 128, 255, cv2.THRESH_BINARY)

    # Verify mask has enough content
    mask_pixels = int(np.count_nonzero(mask))
    if mask_pixels < 100:
        log(f"Mask too small ({mask_pixels} pixels) — skipping composite")
        return {"error": "Label mask too small", "status": "failed"}

    log(f"Mask: {mask_pixels} pixels, center: ({cx},{cy})")

    # ─── INPAINT HALLUCINATED LABEL FIRST ─────────────────
    # The generated image may have a hallucinated label (wrong color/text) underneath.
    # Solution: inpaint the area first to get clean denim surface.
    try:
        inpaint_mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=2)
        target_clean = cv2.inpaint(target, inpaint_mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
        log("Inpainted hallucinated label area before compositing")
    except cv2.error as e:
        log(f"Inpainting failed: {e} — using original target")
        target_clean = target

    # ─── ALPHA BLEND WITH GAUSSIAN EDGE FEATHERING ─────────────────
    # Seamless clone (Poisson blending) washes out label colors by matching surrounding denim.
    # Instead: alpha-blend preserves exact label appearance, Gaussian feathering smooths edges.
    try:
        # Erode mask slightly to cut off noisy edges from GrabCut
        eroded_mask = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)

        # Create feathered mask: hard center with soft Gaussian edges
        # The blur radius controls the edge softness (larger = smoother transition)
        blur_radius = max(3, int(min(tw, th) * 0.004))  # ~4-7px for typical images
        if blur_radius % 2 == 0:
            blur_radius += 1  # Must be odd for GaussianBlur
        feathered_mask = cv2.GaussianBlur(eroded_mask.astype(np.float32), (blur_radius, blur_radius), 0)

        # Normalize to 0-1 range
        max_val = feathered_mask.max()
        if max_val > 0:
            feathered_mask = feathered_mask / max_val

        # Apply alpha blend: label on clean target
        mask_3ch = cv2.merge([feathered_mask, feathered_mask, feathered_mask])
        blended = (warped_bgr.astype(np.float32) * mask_3ch +
                   target_clean.astype(np.float32) * (1.0 - mask_3ch))
        result = blended.astype(np.uint8)

        cv2.imwrite(output_path, result, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        log(f"Composite saved: {output_path}")

        return {
            "status": "ok",
            "output": output_path,
            "target_size": f"{tw}x{th}",
            "label_center": [int(cx), int(cy)],
            "mask_pixels": mask_pixels,
            "method": "alpha_feathered",
        }
    except Exception as e:
        log(f"Alpha blend failed: {e} — falling back to simple overlay")

        mask_f = mask.astype(np.float32) / 255.0
        mask_3ch = cv2.merge([mask_f, mask_f, mask_f])
        blended = (warped_bgr.astype(np.float32) * mask_3ch +
                   target_clean.astype(np.float32) * (1.0 - mask_3ch))
        result = blended.astype(np.uint8)

        cv2.imwrite(output_path, result, [cv2.IMWRITE_PNG_COMPRESSION, 3])

        return {
            "status": "ok",
            "output": output_path,
            "target_size": f"{tw}x{th}",
            "label_center": [int(cx), int(cy)],
            "mask_pixels": mask_pixels,
            "method": "alpha_blend_fallback",
        }


# ─── FULL PIPELINE ─────────────────────────────────────────────────────────

def full_pipeline(mannequin_path: str, generated_path: str, output_path: str, corners_json: str = None) -> dict:
    """
    Run the complete label composite pipeline:
    1. Extract label from mannequin with GrabCut segmentation
    2. Composite onto generated image with seamless clone
    """
    import tempfile

    label_tmp = tempfile.mktemp(suffix='.png')
    extract_result = extract_label(mannequin_path, label_tmp)

    if extract_result.get("status") != "ok":
        return {"error": f"Extraction failed: {extract_result.get('error')}", "status": "failed", "extract": extract_result}

    composite_result = composite_with_seamless_clone(generated_path, label_tmp, output_path, corners_json)

    try:
        os.unlink(label_tmp)
    except:
        pass

    return {
        "status": composite_result.get("status"),
        "output": output_path,
        "extract": to_native(extract_result),
        "composite": to_native(composite_result),
    }


# ─── CLI INTERFACE ─────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: label_composite.py <extract|composite|full> <args...>"}))
        sys.exit(1)

    command = sys.argv[1]

    try:
        if command == "extract":
            if len(sys.argv) < 4:
                print(json.dumps({"error": "Usage: extract <input_path> <output_path>"}))
                sys.exit(1)
            result = extract_label(sys.argv[2], sys.argv[3])

        elif command == "composite":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "Usage: composite <target_path> <label_path> <output_path> [corners_json]"}))
                sys.exit(1)
            corners = sys.argv[5] if len(sys.argv) > 5 else None
            result = composite_with_seamless_clone(sys.argv[2], sys.argv[3], sys.argv[4], corners)

        elif command == "full":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "Usage: full <mannequin_path> <generated_path> <output_path> [corners_json]"}))
                sys.exit(1)
            corners = sys.argv[5] if len(sys.argv) > 5 else None
            result = full_pipeline(sys.argv[2], sys.argv[3], sys.argv[4], corners)

        else:
            result = {"error": f"Unknown command: {command}"}

    except Exception as e:
        result = {"error": str(e), "status": "exception"}

    print(json.dumps(to_native(result)))


if __name__ == "__main__":
    main()
