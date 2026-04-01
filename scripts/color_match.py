#!/usr/bin/env python3
"""
Color consistency via LAB histogram matching.
Uses scikit-image match_histograms in LAB space for perceptual color transfer.

Usage:
  python3 color_match.py match <reference> <generated> <output> [mask_json]
"""
import sys
import json
import numpy as np
import cv2

def compute_delta_e(lab1, lab2):
    """CIE76 delta E between two LAB images (mean over garment pixels)."""
    diff = lab1.astype(np.float64) - lab2.astype(np.float64)
    return float(np.mean(np.sqrt(np.sum(diff**2, axis=2))))

def create_garment_mask(image_bgr, mask_bounds=None):
    """Create binary mask: 1=garment, 0=skin/background."""
    h, w = image_bgr.shape[:2]
    mask = np.ones((h, w), dtype=np.uint8)

    # Exclude background (very bright, low saturation)
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    bright_low_sat = (hsv[:,:,2] > 200) & (hsv[:,:,1] < 40)
    mask[bright_low_sat] = 0

    # Exclude skin pixels (HSV range for various skin tones)
    skin_lower1 = np.array([0, 20, 70])
    skin_upper1 = np.array([25, 180, 255])
    skin_lower2 = np.array([335//2, 20, 70])  # wrapping hue
    skin_upper2 = np.array([360//2, 180, 255])
    skin1 = cv2.inRange(hsv, skin_lower1, skin_upper1)
    skin2 = cv2.inRange(hsv, skin_lower2, skin_upper2)
    skin_mask = cv2.bitwise_or(skin1, skin2)
    # Only exclude high-confidence skin (large connected areas, not small patches)
    kernel = np.ones((7, 7), np.uint8)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN, kernel)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, kernel)
    mask[skin_mask > 0] = 0

    # Apply region bounds if provided
    if mask_bounds:
        region_mask = np.zeros((h, w), dtype=np.uint8)
        x1 = int(mask_bounds.get('x1', 0) * w)
        y1 = int(mask_bounds.get('y1', 0) * h)
        x2 = int(mask_bounds.get('x2', 1) * w)
        y2 = int(mask_bounds.get('y2', 1) * h)
        region_mask[y1:y2, x1:x2] = 1
        mask = mask & region_mask

    return mask

def match_colors(ref_path, gen_path, out_path, mask_bounds=None, strength=0.5):
    """Match generated image colors to reference using LAB histogram matching."""
    from skimage.exposure import match_histograms

    ref_bgr = cv2.imread(ref_path)
    gen_bgr = cv2.imread(gen_path)

    if ref_bgr is None:
        return {"status": "failed", "error": f"Could not load reference: {ref_path}"}
    if gen_bgr is None:
        return {"status": "failed", "error": f"Could not load generated: {gen_path}"}

    # Resize reference to match generated dimensions
    gen_h, gen_w = gen_bgr.shape[:2]
    ref_resized = cv2.resize(ref_bgr, (gen_w, gen_h), interpolation=cv2.INTER_LANCZOS4)

    # Convert to LAB
    ref_lab = cv2.cvtColor(ref_resized, cv2.COLOR_BGR2LAB)
    gen_lab = cv2.cvtColor(gen_bgr, cv2.COLOR_BGR2LAB)

    # Create garment masks
    gen_mask = create_garment_mask(gen_bgr, mask_bounds)
    ref_mask = create_garment_mask(ref_resized, mask_bounds)

    garment_pixels_gen = np.sum(gen_mask > 0)
    garment_pixels_ref = np.sum(ref_mask > 0)
    sys.stderr.write(f"[ColorMatch] Garment pixels — gen: {garment_pixels_gen}, ref: {garment_pixels_ref}\n")

    if garment_pixels_gen < 1000 or garment_pixels_ref < 1000:
        return {"status": "failed", "error": "Not enough garment pixels for matching"}

    # Extract garment-only pixels for histogram matching
    gen_garment = gen_lab[gen_mask > 0]
    ref_garment = ref_lab[ref_mask > 0]

    # Delta E before (sample-based since dimensions might differ)
    # Use minimum of both for comparison
    min_len = min(len(gen_garment), len(ref_garment))
    de_before = compute_delta_e(
        gen_garment[:min_len].reshape(-1, 1, 3),
        ref_garment[:min_len].reshape(-1, 1, 3)
    )

    # Match histograms in LAB space (channel by channel)
    matched_garment = match_histograms(
        gen_garment.reshape(-1, 1, 3).astype(np.float64),
        ref_garment.reshape(-1, 1, 3).astype(np.float64),
        channel_axis=2
    ).reshape(-1, 3).astype(np.uint8)

    # Reconstruct full image — only replace garment pixels
    result_lab = gen_lab.copy()

    # Blend at specified strength (default 50%)
    gen_garment_float = gen_garment.astype(np.float64)
    matched_float = matched_garment.astype(np.float64)
    blended = (gen_garment_float * (1 - strength) + matched_float * strength).astype(np.uint8)

    result_lab[gen_mask > 0] = blended

    # Smooth the transition at mask edges with Gaussian blur
    mask_float = gen_mask.astype(np.float32)
    mask_blurred = cv2.GaussianBlur(mask_float, (21, 21), 0)
    mask_3ch = np.stack([mask_blurred] * 3, axis=2)

    result_lab_smooth = (gen_lab.astype(np.float64) * (1 - mask_3ch) + result_lab.astype(np.float64) * mask_3ch).astype(np.uint8)

    # Convert back to BGR
    result_bgr = cv2.cvtColor(result_lab_smooth, cv2.COLOR_LAB2BGR)

    # Delta E after
    result_lab_check = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2LAB)
    gen_result_garment = result_lab_check[gen_mask > 0]
    min_len = min(len(gen_result_garment), len(ref_garment))
    de_after = compute_delta_e(
        gen_result_garment[:min_len].reshape(-1, 1, 3),
        ref_garment[:min_len].reshape(-1, 1, 3)
    )

    cv2.imwrite(out_path, result_bgr)

    return {
        "status": "ok",
        "delta_e_before": round(de_before, 1),
        "delta_e_after": round(de_after, 1),
        "garment_pixels": int(garment_pixels_gen),
        "strength": strength
    }

if __name__ == '__main__':
    if len(sys.argv) < 5:
        print(json.dumps({"status": "failed", "error": "Usage: color_match.py match <ref> <gen> <out> [mask_json]"}))
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == 'match':
        ref_path = sys.argv[2]
        gen_path = sys.argv[3]
        out_path = sys.argv[4]
        mask_bounds = json.loads(sys.argv[5]) if len(sys.argv) > 5 else None

        result = match_colors(ref_path, gen_path, out_path, mask_bounds)
        print(json.dumps(result))
    else:
        print(json.dumps({"status": "failed", "error": f"Unknown command: {cmd}"}))
