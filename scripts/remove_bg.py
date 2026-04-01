#!/usr/bin/env python3
"""
Background removal using rembg (IS-Net model) for G-Star AI Studio.
Called from Node.js via child_process.

Usage: python3 scripts/remove_bg.py <input_path> <output_path> [--shadow]

Input: JPEG/PNG image of model on studio background
Output: PNG with flat #D5D3CC background + optional synthetic drop shadow
"""

import sys
import json
import numpy as np
import cv2

def remove_bg_isnet(input_path: str, output_path: str, add_shadow: bool = True):
    """Remove background using rembg IS-Net model, composite on #D5D3CC."""
    try:
        from rembg import remove, new_session
    except ImportError:
        print(json.dumps({"error": "rembg not installed. Run: pip install rembg[cpu]"}), flush=True)
        sys.exit(1)

    # Load image
    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(json.dumps({"error": f"Could not read image: {input_path}"}), flush=True)
        sys.exit(1)

    h, w = img.shape[:2]

    # Convert BGR to RGB for rembg
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Create session with IS-Net (better edge quality than default u2net)
    session = new_session("isnet-general-use")

    # Remove background — returns RGBA
    result_rgba = remove(
        img_rgb,
        session=session,
        post_process_mask=True,  # Clean up mask edges
    )

    # result_rgba is a PIL Image, convert to numpy
    result_np = np.array(result_rgba)

    # Extract alpha channel
    alpha = result_np[:, :, 3].astype(np.float32) / 255.0

    # Create flat #D5D3CC background (RGB: 213, 211, 204)
    bg_color = np.array([213, 211, 204], dtype=np.float32)
    canvas = np.full((h, w, 3), bg_color, dtype=np.float32)

    # Extract foreground RGB
    fg = result_np[:, :, :3].astype(np.float32)

    # Synthesize drop shadow if requested
    if add_shadow:
        # Find bottom of the person (lowest non-transparent row)
        alpha_rows = np.any(alpha > 0.1, axis=1)
        if np.any(alpha_rows):
            bottom_row = np.max(np.where(alpha_rows))
            # Find horizontal extent at bottom for shadow width
            bottom_cols = np.where(alpha[max(0, bottom_row-20):bottom_row+1, :] > 0.1)
            if len(bottom_cols[1]) > 0:
                left_col = np.min(bottom_cols[1])
                right_col = np.max(bottom_cols[1])
                center_x = (left_col + right_col) // 2
                shadow_width = int((right_col - left_col) * 0.8)

                # Create shadow ellipse
                shadow_mask = np.zeros((h, w), dtype=np.float32)
                shadow_y = min(bottom_row + 5, h - 1)
                shadow_h = max(int(shadow_width * 0.15), 8)
                cv2.ellipse(
                    shadow_mask,
                    (center_x, shadow_y),
                    (shadow_width // 2, shadow_h),
                    0, 0, 360,
                    1.0, -1
                )
                # Heavy blur for soft shadow
                blur_size = max(shadow_width // 3, 21)
                if blur_size % 2 == 0:
                    blur_size += 1
                shadow_mask = cv2.GaussianBlur(shadow_mask, (blur_size, blur_size), 0)
                # Normalize and apply opacity (25%)
                if shadow_mask.max() > 0:
                    shadow_mask = (shadow_mask / shadow_mask.max()) * 0.25

                # Darken background where shadow falls
                shadow_color = bg_color * 0.7  # 30% darker
                shadow_3ch = shadow_mask[:, :, np.newaxis]
                canvas = canvas * (1.0 - shadow_3ch) + shadow_color * shadow_3ch

    # Alpha composite: foreground over background
    alpha_3ch = alpha[:, :, np.newaxis]
    composited = fg * alpha_3ch + canvas * (1.0 - alpha_3ch)
    composited = np.clip(composited, 0, 255).astype(np.uint8)

    # Convert RGB back to BGR for OpenCV save
    composited_bgr = cv2.cvtColor(composited, cv2.COLOR_RGB2BGR)

    # Save as PNG
    cv2.imwrite(output_path, composited_bgr, [cv2.IMWRITE_PNG_COMPRESSION, 6])

    print(json.dumps({
        "success": True,
        "output": output_path,
        "dimensions": f"{w}x{h}",
        "shadow": add_shadow,
    }), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python3 remove_bg.py <input> <output> [--shadow]"}))
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    add_shadow = "--shadow" in sys.argv

    remove_bg_isnet(input_path, output_path, add_shadow)
