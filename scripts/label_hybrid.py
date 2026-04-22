#!/usr/bin/env python3
"""
scripts/label_hybrid.py — Hybrid leather-label composite.

Pipeline (v1):
  1. Warp a plain leather "material tile" into a destination quad on the target image.
  2. Apply a Sobel-based deboss shader that treats the template PNG as a height map.
     The shader composites G-STAR / ORIGINALS / RAW | DENIM byte-identical from the
     template — no Gemini text ever enters the output. Text drift is impossible by
     construction.
  3. Tint the warped material toward `base_color` (per-colorway body colour) using
     a luminance-preserving multiply, so one tile serves every colorway.

Usage:
    python3 label_hybrid.py <args.json>

Two modes:

─── mode: "composite" (default) ───
Composites the label onto an AI-generated target image.
`args.json`:
{
  "target_image":      "/tmp/target.png",         # AI-generated shot (input)
  "material_tile":     "/tmp/pebbled_tan.png",    # plain leather from Gemini
  "template":          "/tmp/L2936-8.0.png",      # line art / height map
  "quad": [                                       # 4 corners TL,TR,BR,BL on target
    {"x": 1234, "y": 567}, ...
  ],
  "base_color":        "#987545",                 # colorway leather body
  "stitch_color":      "#6B4A2B",                 # optional, reserved
  "emboss_strength":   0.85,                      # 0..1
  "output":            "/tmp/out.png",
  "debug_dir":         "/tmp/dbg"                 # optional
}

─── mode: "preview" ───
Renders an upright RGBA leather-label PNG on a transparent canvas — no target
image, no quad. Used by the label-picker UI to get a pre-rendered preview that
can then be CSS-warped in the browser via matrix3d(). Caching this avoids
re-running the shader on every drag.
`args.json`:
{
  "mode":              "preview",
  "material_tile":     "/tmp/pebbled_tan.png",
  "template":          "/tmp/L2936-8.0.png",
  "base_color":        "#3d3934",
  "emboss_strength":   0.55,
  "width":             512,                       # output canvas width
  "height":            340,                       # output canvas height
  "output":            "/tmp/preview.png"
}

Writes JSON to stdout:
{"ok": true, "output": "/tmp/out.png", "quad": [...], "size": [w,h]}
or
{"ok": false, "error": "..."}
"""
import sys
import os
import json
import traceback
import numpy as np
import cv2


# ───────────────────────── helpers ──────────────────────────

def log(msg):
    print(f"[label_hybrid] {msg}", file=sys.stderr, flush=True)


def hex_to_rgb(h: str):
    h = h.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"bad hex colour: {h}")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def sort_quad(pts):
    """Sort 4 points into TL, TR, BR, BL using sum/diff trick.
    Handles out-of-order clicks and non-rectangular trapezoids."""
    a = np.array([[p["x"], p["y"]] for p in pts], dtype=np.float32)
    if a.shape != (4, 2):
        raise ValueError(f"quad must have exactly 4 points, got {a.shape}")
    s = a.sum(axis=1)
    d = a[:, 1] - a[:, 0]
    tl = a[np.argmin(s)]
    br = a[np.argmax(s)]
    tr = a[np.argmin(d)]
    bl = a[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def validate_quad(quad, img_shape):
    """Check the quad isn't degenerate and is inside the image (with small margin)."""
    h, w = img_shape[:2]
    xs = quad[:, 0]
    ys = quad[:, 1]
    # Clamp to image bounds with 1px margin
    quad[:, 0] = np.clip(xs, 0, w - 1)
    quad[:, 1] = np.clip(ys, 0, h - 1)
    # Area check
    area = cv2.contourArea(quad.astype(np.int32))
    if area < 100:
        raise ValueError(f"quad area too small: {area}")
    return quad


# ───────────────────────── material warp ──────────────────────────

def warp_texture_into_quad(tex_rgb, dst_quad, out_shape):
    h, w = tex_rgb.shape[:2]
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst_quad)
    warped = cv2.warpPerspective(
        tex_rgb, M, (out_shape[1], out_shape[0]),
        flags=cv2.INTER_LANCZOS4,
    )
    mask = np.zeros(out_shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, dst_quad.astype(np.int32), 255)
    # Soft edge — scale blur kernel to ~0.4% of image diagonal for natural fade
    diag = (out_shape[0] ** 2 + out_shape[1] ** 2) ** 0.5
    ksize = max(11, int(diag * 0.004) | 1)  # ensure odd
    mask = cv2.GaussianBlur(mask, (ksize, ksize), 0).astype(np.float32) / 255.0
    return warped, mask


def _build_8point_subquads(quad, midpoints_px):
    """Given the 4 outer corners (TL, TR, BR, BL) in image pixel space plus a
    dict of resolved midpoints (tm/rm/bm/lm, each a [x,y] in image px — auto
    or custom, already materialised by the caller), return a list of 4
    sub-quadrant destination quads walking clockwise from the outer corner
    of that quadrant to the centroid.

    Layout:
        TL ── TM ── TR
         │    │    │
        LM ── C ── RM
         │    │    │
        BL ── BM ── BR

    Sub-quads:
        TL: [TL, TM, C,  LM]
        TR: [TM, TR, RM, C ]
        BR: [C,  RM, BR, BM]
        BL: [LM, C,  BM, BL]

    Each is a 4x2 float32 in the same TL/TR/BR/BL ordering that the rest of
    the pipeline uses, so they slot directly into cv2.getPerspectiveTransform.
    """
    tl = quad[0]; tr_ = quad[1]; br_ = quad[2]; bl = quad[3]
    tm = np.array(midpoints_px["tm"], dtype=np.float32)
    rm = np.array(midpoints_px["rm"], dtype=np.float32)
    bm = np.array(midpoints_px["bm"], dtype=np.float32)
    lm = np.array(midpoints_px["lm"], dtype=np.float32)
    center = np.array(
        [
            float(tl[0] + tr_[0] + br_[0] + bl[0]) / 4.0,
            float(tl[1] + tr_[1] + br_[1] + bl[1]) / 4.0,
        ],
        dtype=np.float32,
    )
    return [
        ("tl", np.array([tl, tm, center, lm], dtype=np.float32)),
        ("tr", np.array([tm, tr_, rm, center], dtype=np.float32)),
        ("br", np.array([center, rm, br_, bm], dtype=np.float32)),
        ("bl", np.array([lm, center, bm, bl], dtype=np.float32)),
    ]


def _warp_8point(tex_rgb, height_field, sub_quads, out_shape):
    """Seamless 8-point warp via a single cv2.remap call.

    The earlier implementation split the source texture into 4 quarters and
    warped each quarter independently onto its destination sub-quadrant with
    cv2.warpPerspective + hard mask overwrite. That produced two visible
    artefacts:

      1. A dark cross through the centre of the label. Each sub-quad's
         warp used INTER_LANCZOS4, whose 8-pixel kernel bled past the edge
         of the source quarter into the black border, darkening every
         internal seam by ~4 px.

      2. Garbled text along the centre. The template's "G-STAR ORIGINALS"
         text straddles the centroid of the source; splitting at (hw, hh)
         cut letters in half, and the 4 independent perspective warps
         resampled the two halves at subtly different sub-pixel offsets.

    The fix: one cv2.remap, one continuous coordinate field. For each
    output pixel we determine which destination sub-quad it falls in and
    compute the *inverse* perspective transform for that sub-quad (dest →
    global-source-coordinates). Because adjacent sub-quads share their
    corner points exactly — tm, rm, bm, lm, and the centroid — the source
    coordinates along every shared seam are identical from both sides of
    the seam. Remap with INTER_LANCZOS4 then produces a single continuous
    resample across the whole label with zero internal seams and no text
    garbling.

    Same signature and return values as before so the caller is unchanged.
    """
    oh, ow = out_shape[:2]
    sh, sw = tex_rgb.shape[:2]
    hw = sw // 2
    hh = sh // 2
    # Guard against degenerate quarters on very small source tiles
    if hw < 2 or hh < 2 or (sw - hw) < 2 or (sh - hh) < 2:
        raise ValueError(
            f"source texture too small for 8-point split: {sw}x{sh}"
        )

    # Source quads in GLOBAL source-image coordinates, walking clockwise
    # from the outer corner to the centroid (tl, tr, br, bl). The centre
    # point (hw, hh) is shared by all 4, and adjacent sub-quads share one
    # edge exactly — this is the property that makes the combined remap
    # seamless.
    src_quads = {
        "tl": np.array([[0, 0],  [hw, 0], [hw, hh], [0,  hh]], dtype=np.float32),
        "tr": np.array([[hw, 0], [sw, 0], [sw, hh], [hw, hh]], dtype=np.float32),
        "br": np.array([[hw, hh],[sw, hh],[sw, sh], [hw, sh]], dtype=np.float32),
        "bl": np.array([[0, hh], [hw, hh],[hw, sh], [0,  sh]], dtype=np.float32),
    }

    # Union bbox of all 4 destination sub-quads — we only build the remap
    # over this bbox rather than the full oh x ow frame (saves ~500x work
    # on a 3072x5504 image where the label is ~200x150 px).
    all_pts = np.concatenate([q for _, q in sub_quads], axis=0)
    x_min = int(np.floor(all_pts[:, 0].min()))
    y_min = int(np.floor(all_pts[:, 1].min()))
    x_max = int(np.ceil(all_pts[:, 0].max())) + 1
    y_max = int(np.ceil(all_pts[:, 1].max())) + 1
    # Pad by 2 px so Lanczos kernel edge sampling has room
    x_min = max(0, x_min - 2)
    y_min = max(0, y_min - 2)
    x_max = min(ow, x_max + 2)
    y_max = min(oh, y_max + 2)
    bw = x_max - x_min
    bh = y_max - y_min
    if bw <= 0 or bh <= 0:
        raise ValueError(
            f"8-point dest quads outside output frame: bbox=({x_min},{y_min})-({x_max},{y_max})"
        )

    # Coordinate maps in bbox-local space. Values in the maps are SOURCE
    # pixel coordinates (global to the source texture). Unmapped pixels
    # stay at -1 and land on the border via BORDER_CONSTANT below.
    map_x = np.full((bh, bw), -1.0, dtype=np.float32)
    map_y = np.full((bh, bw), -1.0, dtype=np.float32)
    bbox_mask = np.zeros((bh, bw), dtype=np.uint8)

    for name, dst_quad in sub_quads:
        src_quad = src_quads[name]
        # Inverse perspective transform: given an output pixel, return
        # the matching source pixel. Adjacent sub-quads produce identical
        # source coordinates along their shared edge because they share
        # both the src and dst corners of that edge.
        M_inv = cv2.getPerspectiveTransform(dst_quad, src_quad)

        # Rasterize this sub-quad into a bbox-local mask so we only
        # compute source coords for pixels that actually belong to it.
        local_quad = dst_quad.copy()
        local_quad[:, 0] -= x_min
        local_quad[:, 1] -= y_min
        piece_mask = np.zeros((bh, bw), dtype=np.uint8)
        cv2.fillConvexPoly(piece_mask, local_quad.astype(np.int32), 255)
        sel = piece_mask > 0
        if not np.any(sel):
            continue

        ys_local, xs_local = np.where(sel)
        # Global output coordinates for each selected pixel
        xs_g = xs_local.astype(np.float32) + x_min
        ys_g = ys_local.astype(np.float32) + y_min
        ones = np.ones_like(xs_g)
        pts_h = np.stack([xs_g, ys_g, ones], axis=-1)  # (N, 3)

        # Apply M_inv to homogeneous dest coords → homogeneous src coords
        src_h = pts_h @ M_inv.T  # (N, 3)
        w = src_h[:, 2]
        # Avoid divide-by-zero at degenerate cases
        w = np.where(np.abs(w) < 1e-8, 1e-8, w)
        src_x = src_h[:, 0] / w
        src_y = src_h[:, 1] / w

        map_x[sel] = src_x
        map_y[sel] = src_y
        bbox_mask |= piece_mask

    # Single remap of the full tinted texture. BORDER_REFLECT_101 gives
    # clean extrapolation at the outer label edges (source texture is a
    # repeating leather tile, so reflection is visually indistinguishable
    # from continuation). Unmapped pixels carry map_x=-1 which also lands
    # in the reflect border — we overwrite those with zero afterwards.
    warped_tex_bbox = cv2.remap(
        tex_rgb,
        map_x,
        map_y,
        interpolation=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT_101,
    )

    # Height field remap. Same uint16 encode trick as before so the remap
    # linearly interpolates through the -1..1.5 range without clamping.
    h_scaled = ((height_field + 2.0) * 16000.0).astype(np.uint16)
    warped_h_scaled_bbox = cv2.remap(
        h_scaled,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=int(2.0 * 16000),
    )
    warped_h_bbox = (warped_h_scaled_bbox.astype(np.float32) / 16000.0) - 2.0

    # Zero out unmapped pixels in the bbox before pasting into full frame.
    unmapped = bbox_mask == 0
    warped_tex_bbox[unmapped] = 0
    warped_h_bbox[unmapped] = -2.0

    # Full-size output buffers. -2 sentinel for the height field means
    # "no label here" for the emboss shader.
    warped_tex = np.zeros((oh, ow, 3), dtype=np.uint8)
    warped_h = np.full((oh, ow), -2.0, dtype=np.float32)
    combined_hard = np.zeros((oh, ow), dtype=np.uint8)

    warped_tex[y_min:y_max, x_min:x_max] = warped_tex_bbox
    warped_h[y_min:y_max, x_min:x_max] = warped_h_bbox
    combined_hard[y_min:y_max, x_min:x_max] = bbox_mask

    diag = (oh ** 2 + ow ** 2) ** 0.5
    ksize = max(11, int(diag * 0.004) | 1)
    soft_mask = cv2.GaussianBlur(combined_hard, (ksize, ksize), 0).astype(np.float32) / 255.0
    return warped_tex, warped_h, soft_mask


def detect_skin_mask(rgb, quad):
    """Detect skin-coloured pixels inside the label quad region.
    Returns a float32 mask (0..1) where 1 = skin. Used to carve out
    arms/hands so they stay in front of the composited label."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    # Broad skin range in HSV — covers light to dark skin tones
    lo = np.array([0, 30, 50], dtype=np.uint8)
    hi = np.array([35, 255, 255], dtype=np.uint8)
    skin = cv2.inRange(hsv, lo, hi)
    # Also catch reddish wrap-around (H > 160)
    lo2 = np.array([160, 30, 50], dtype=np.uint8)
    hi2 = np.array([180, 255, 255], dtype=np.uint8)
    skin |= cv2.inRange(hsv, lo2, hi2)
    # Restrict to quad region only
    quad_mask = np.zeros(rgb.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(quad_mask, quad.astype(np.int32), 255)
    skin &= quad_mask
    # Dilate slightly to catch edges, then blur for soft transition
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    skin = cv2.dilate(skin, kernel, iterations=2)
    skin = cv2.GaussianBlur(skin, (15, 15), 0)
    return skin.astype(np.float32) / 255.0


def match_local_luminance(base_rgb, label_rgb, mask):
    """Adjust the composited label region to match the surrounding denim
    brightness. Samples a thin ring around the label quad to compute
    the local denim luminance, then shifts the label to match.
    This kills the 'sticker' look by ensuring lighting continuity."""
    # Dilate mask to create a sampling ring around the label
    hard = (mask > 0.3).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
    dilated = cv2.dilate(hard, kernel, iterations=3)
    ring = (dilated > 0) & (hard == 0)
    if ring.sum() < 100:
        return label_rgb  # not enough context to match

    base_lab = cv2.cvtColor(base_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    label_lab = cv2.cvtColor(label_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)

    # Mean L of the surrounding denim ring
    denim_L = float(base_lab[ring, 0].mean())
    # Mean L of the label area
    label_region = mask > 0.5
    if label_region.sum() < 100:
        return label_rgb
    label_L = float(label_lab[label_region, 0].mean())

    # Shift label L toward denim L (50% blend — subtle, not total override)
    shift = (denim_L - label_L) * 0.35
    label_lab[:, :, 0] = np.clip(label_lab[:, :, 0] + shift * mask, 0, 255)

    return cv2.cvtColor(label_lab.astype(np.uint8), cv2.COLOR_LAB2RGB)


def composite(base_rgb, texture_rgb, mask):
    base_f = base_rgb.astype(np.float32)
    tex_f = texture_rgb.astype(np.float32)
    m = mask[:, :, None]
    return np.clip(base_f * (1 - m) + tex_f * m, 0, 255).astype(np.uint8)


def tint_texture(tex_rgb, base_color_rgb):
    """Shift the texture toward base_color while preserving its local luminance
    structure (grain/pebbling).

    L: recentered to target mean, variance PRESERVED — grain stays visible.
    a/b: flattened to target chroma — NO variance — pure target colour.

    Rationale: preserving a/b variance means any cool pixel in the source tile
    (slightly below mean_b) lands below target_b after recentering → blue half
    of the a*b* plane → visible blue pixels in the output. Leather grain is a
    luminance phenomenon, not a chroma phenomenon, so we kill a/b variance.
    Result: clean chroma in the target colour, no surprise blue/green pixels,
    grain preserved through L variance."""
    tex_lab = cv2.cvtColor(tex_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    target = np.uint8([[base_color_rgb]])  # 1x1x3 RGB
    target_lab = cv2.cvtColor(target, cv2.COLOR_RGB2LAB).astype(np.float32)[0, 0]
    mean_L = float(tex_lab[:, :, 0].mean())
    # L: keep variance (grain), shift mean to target
    tex_lab[:, :, 0] = np.clip(tex_lab[:, :, 0] - mean_L + target_lab[0], 0, 255)
    # a, b: flat — no variance, pure target chroma
    tex_lab[:, :, 1] = target_lab[1]
    tex_lab[:, :, 2] = target_lab[2]
    out = cv2.cvtColor(tex_lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
    return out


# ───────────────────────── Sobel deboss shader ──────────────────────────

def template_height_map(tpl_rgba):
    """Treat template as a height/bump map. Dark pixels = pressed into leather.
    Returns a float field roughly in [-1, 1.5]."""
    rgb = tpl_rgba[:, :, :3]
    lum = rgb.mean(axis=2).astype(np.float32)
    bg = 180.0
    height = (bg - lum) / 180.0
    return np.clip(height, -1.0, 1.5)


def warp_height_field(field, dst_quad, out_shape):
    """Warp the height field into the destination quad using bilinear interpolation
    with a float-safe encoding. The 16-bit uint trick avoids clamping negatives."""
    h, w = field.shape
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst_quad)
    scaled = ((field + 2) * 16000).astype(np.uint16)
    warped = cv2.warpPerspective(
        scaled, M, (out_shape[1], out_shape[0]),
        flags=cv2.INTER_LINEAR,
        borderValue=int(2 * 16000),
    )
    return (warped.astype(np.float32) / 16000.0) - 2


def apply_emboss_sobel(base_rgb, height, shadow=60.0, hilite=40.0, fill=8.0):
    """Sobel-gradient-based deboss. Treats `height` as a bump map:
      - positive gradients at the 'into-the-leather' rim darken (edge_shadow)
      - negative gradients at the 'out-of-the-leather' rim brighten (edge_hilite)
      - the pressed interior gets a small uniform fill (flat darkening)

    This correctly handles knockout shapes (e.g. letters inside a dark box) because
    Sobel finds every polarity transition — not just the outer contour."""
    h = cv2.GaussianBlur(height.astype(np.float32), (3, 3), 0)
    gx = cv2.Sobel(h, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(h, cv2.CV_32F, 0, 1, ksize=3)
    edge_shadow = np.clip((gx + gy) * 0.5, 0, None)
    edge_hilite = np.clip(-(gx + gy) * 0.5, 0, None)
    mx = max(float(edge_shadow.max()), float(edge_hilite.max()), 1e-6)
    edge_shadow /= mx
    edge_hilite /= mx
    press = np.clip(h, 0, 1)
    out = base_rgb.astype(np.float32)
    out -= edge_shadow[:, :, None] * shadow
    out += edge_hilite[:, :, None] * hilite
    out -= press[:, :, None] * fill
    return np.clip(out, 0, 255).astype(np.uint8)


# ───────────────────────── top-level pipeline ──────────────────────────

def _parse_point_obj(raw):
    """Accept {'x': ..., 'y': ...} or [x, y]."""
    if raw is None:
        return None
    if isinstance(raw, dict) and "x" in raw and "y" in raw:
        return [float(raw["x"]), float(raw["y"])]
    if isinstance(raw, (list, tuple)) and len(raw) == 2:
        return [float(raw[0]), float(raw[1])]
    return None


def run(args):
    target_path = args["target_image"]
    material_path = args["material_tile"]
    template_path = args["template"]
    output_path = args["output"]
    quad_raw = args["quad"]
    midpoints_raw = args.get("midpoints")  # None | dict
    base_color = hex_to_rgb(args.get("base_color", "#987545"))
    emboss_strength = float(args.get("emboss_strength", 0.85))
    debug_dir = args.get("debug_dir")

    log(f"target={target_path}")
    log(f"material={material_path}")
    log(f"template={template_path}")
    log(f"base_color={base_color} emboss={emboss_strength}")
    log(f"midpoints_raw={midpoints_raw}")

    # Load
    target_bgr = cv2.imread(target_path, cv2.IMREAD_COLOR)
    if target_bgr is None:
        raise FileNotFoundError(f"target image not found: {target_path}")
    target_rgb = cv2.cvtColor(target_bgr, cv2.COLOR_BGR2RGB)

    material_bgr = cv2.imread(material_path, cv2.IMREAD_COLOR)
    if material_bgr is None:
        raise FileNotFoundError(f"material tile not found: {material_path}")
    material_rgb = cv2.cvtColor(material_bgr, cv2.COLOR_BGR2RGB)

    tpl_raw = cv2.imread(template_path, cv2.IMREAD_UNCHANGED)
    if tpl_raw is None:
        raise FileNotFoundError(f"template not found: {template_path}")
    if tpl_raw.ndim == 2:
        tpl_raw = cv2.cvtColor(tpl_raw, cv2.COLOR_GRAY2BGRA)
    elif tpl_raw.shape[2] == 3:
        tpl_raw = cv2.cvtColor(tpl_raw, cv2.COLOR_BGR2BGRA)
    # Normalise to RGBA for the shader
    tpl_rgba = cv2.cvtColor(tpl_raw, cv2.COLOR_BGRA2RGBA)

    # Quad prep
    quad = sort_quad(quad_raw)
    quad = validate_quad(quad, target_rgb.shape)
    log(f"sorted quad: {quad.tolist()}")

    # Resolve optional midpoints. If any are provided we run the 8-point
    # sub-quadrant composite path; otherwise the classic 4-point path.
    # NOTE: sort_quad reorders corners, so midpoints coming from the caller
    # (which were sent in TL/TR/BR/BL order relative to the caller's own
    # orientation) must be treated carefully. We match on the sum/diff trick
    # same as sort_quad: tm ≈ midpoint of TL+TR, etc., so we always recompute
    # auto-follow midpoints from the *sorted* corners, and only override with
    # user-custom midpoints when explicitly provided.
    use_8pt = False
    midpoints_px = None
    if isinstance(midpoints_raw, dict):
        any_custom = any(
            _parse_point_obj(midpoints_raw.get(k)) is not None
            for k in ("tm", "rm", "bm", "lm")
        )
        if any_custom:
            use_8pt = True
            # Auto-follow from sorted quad
            tl, tr_, br_, bl = quad[0], quad[1], quad[2], quad[3]
            midpoints_px = {
                "tm": [(tl[0] + tr_[0]) / 2.0, (tl[1] + tr_[1]) / 2.0],
                "rm": [(tr_[0] + br_[0]) / 2.0, (tr_[1] + br_[1]) / 2.0],
                "bm": [(br_[0] + bl[0]) / 2.0, (br_[1] + bl[1]) / 2.0],
                "lm": [(bl[0] + tl[0]) / 2.0, (bl[1] + tl[1]) / 2.0],
            }
            for k in ("tm", "rm", "bm", "lm"):
                pt = _parse_point_obj(midpoints_raw.get(k))
                if pt is not None:
                    midpoints_px[k] = pt
            log(f"8-point mode: midpoints={midpoints_px}")

    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)

    # Stage 2: tint material toward base colour, then warp into quad
    tinted = tint_texture(material_rgb, base_color)
    h_field = template_height_map(tpl_rgba)

    if use_8pt:
        sub_quads = _build_8point_subquads(quad, midpoints_px)
        warped_tex, h_warped, soft_mask = _warp_8point(
            tinted, h_field, sub_quads, target_rgb.shape
        )
    else:
        warped_tex, soft_mask = warp_texture_into_quad(tinted, quad, target_rgb.shape)
        h_warped = warp_height_field(h_field, quad, target_rgb.shape[:2])

    plain_leather = composite(target_rgb, warped_tex, soft_mask)

    if debug_dir:
        cv2.imwrite(f"{debug_dir}/01_tinted.png", cv2.cvtColor(tinted, cv2.COLOR_RGB2BGR))
        cv2.imwrite(f"{debug_dir}/02_plain_leather.png", cv2.cvtColor(plain_leather, cv2.COLOR_RGB2BGR))

    # Stage 3: Sobel deboss shader
    # Scale shader strengths by emboss_strength
    shadow = 70.0 * emboss_strength
    hilite = 20.0 * emboss_strength   # reduced from 45 — matte leather, less specular
    fill = 10.0 * emboss_strength
    final_rgb = apply_emboss_sobel(plain_leather, h_warped, shadow=shadow, hilite=hilite, fill=fill)

    if debug_dir:
        cv2.imwrite(f"{debug_dir}/03_final.png", cv2.cvtColor(final_rgb, cv2.COLOR_RGB2BGR))

    # Write output
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    cv2.imwrite(output_path, cv2.cvtColor(final_rgb, cv2.COLOR_RGB2BGR))
    log(f"wrote {output_path} ({final_rgb.shape[1]}x{final_rgb.shape[0]})")

    return {
        "ok": True,
        "output": output_path,
        "quad": quad.tolist(),
        "size": [int(final_rgb.shape[1]), int(final_rgb.shape[0])],
    }


def run_preview(args):
    """Render an upright RGBA leather-label PNG on a transparent canvas.

    Used by the label-picker UI as the draggable preview image. We render
    once server-side, cache the result, then the browser CSS-warps it via
    matrix3d() while the user drags handles. No target image is involved.
    """
    material_path = args["material_tile"]
    template_path = args["template"]
    output_path = args["output"]
    base_color = hex_to_rgb(args.get("base_color", "#987545"))
    emboss_strength = float(args.get("emboss_strength", 0.85))
    width = int(args.get("width", 512))
    height = int(args.get("height", 340))

    log(f"PREVIEW mode: {width}x{height} base={base_color} emboss={emboss_strength}")
    log(f"material={material_path}")
    log(f"template={template_path}")

    # Load material + template
    material_bgr = cv2.imread(material_path, cv2.IMREAD_COLOR)
    if material_bgr is None:
        raise FileNotFoundError(f"material tile not found: {material_path}")
    material_rgb = cv2.cvtColor(material_bgr, cv2.COLOR_BGR2RGB)

    tpl_raw = cv2.imread(template_path, cv2.IMREAD_UNCHANGED)
    if tpl_raw is None:
        raise FileNotFoundError(f"template not found: {template_path}")
    if tpl_raw.ndim == 2:
        tpl_raw = cv2.cvtColor(tpl_raw, cv2.COLOR_GRAY2BGRA)
    elif tpl_raw.shape[2] == 3:
        tpl_raw = cv2.cvtColor(tpl_raw, cv2.COLOR_BGR2BGRA)
    tpl_rgba = cv2.cvtColor(tpl_raw, cv2.COLOR_BGRA2RGBA)

    # Target canvas — full-rect quad
    canvas_shape = (height, width, 3)
    quad = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )

    # Stage A: tint material toward base colour
    tinted = tint_texture(material_rgb, base_color)
    # Resize tinted tile to canvas (identity warp is effectively a resize)
    tinted_resized = cv2.resize(tinted, (width, height), interpolation=cv2.INTER_LANCZOS4)

    # Stage B: Sobel deboss on the plain leather
    h_field = template_height_map(tpl_rgba)
    h_warped = warp_height_field(h_field, quad, (height, width))
    shadow = 70.0 * emboss_strength
    hilite = 20.0 * emboss_strength   # matte leather
    fill = 10.0 * emboss_strength
    label_rgb = apply_emboss_sobel(
        tinted_resized, h_warped, shadow=shadow, hilite=hilite, fill=fill,
    )

    # Stage C: build an RGBA PNG — fully opaque rectangle. No feathered edges
    # here; the picker shows a clean label and the final composite (which runs
    # the regular pipeline again) handles the soft mask / blending with the
    # underlying denim.
    alpha = np.full((height, width), 255, dtype=np.uint8)
    label_bgra = cv2.cvtColor(label_rgb, cv2.COLOR_RGB2BGRA)
    label_bgra[:, :, 3] = alpha

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    cv2.imwrite(output_path, label_bgra)
    log(f"wrote preview {output_path} ({width}x{height})")

    return {
        "ok": True,
        "mode": "preview",
        "output": output_path,
        "size": [width, height],
    }


def run_woven(args):
    """Composite a pre-rendered woven label (RGBA PNG) onto a target image.

    Much simpler than the leather path — no material tile, no emboss shader,
    no tint. Just: load → perspective warp → skin occlusion → luminance match
    → blend.

    `args`:
    {
      "target_image":  "/tmp/target.png",
      "woven_label":   "/tmp/originals-label-gold-woven.png",
      "quad": [{"x":..,"y":..}, ...],   # 4 corners TL,TR,BR,BL on target
      "output":        "/tmp/out.png",
      "debug_dir":     "/tmp/dbg"        # optional
    }
    """
    target_path = args["target_image"]
    label_path = args["woven_label"]
    output_path = args["output"]
    quad_raw = args["quad"]
    debug_dir = args.get("debug_dir")

    log(f"WOVEN mode: target={target_path}")
    log(f"woven_label={label_path}")

    # Load target
    target_bgr = cv2.imread(target_path, cv2.IMREAD_COLOR)
    if target_bgr is None:
        raise FileNotFoundError(f"target image not found: {target_path}")
    target_rgb = cv2.cvtColor(target_bgr, cv2.COLOR_BGR2RGB)

    # Load woven label (RGBA — may have alpha transparency at edges)
    label_raw = cv2.imread(label_path, cv2.IMREAD_UNCHANGED)
    if label_raw is None:
        raise FileNotFoundError(f"woven label not found: {label_path}")

    if label_raw.shape[2] == 4:
        label_rgb = cv2.cvtColor(label_raw[:, :, :3], cv2.COLOR_BGR2RGB)
        label_alpha = label_raw[:, :, 3].astype(np.float32) / 255.0
    else:
        label_rgb = cv2.cvtColor(label_raw, cv2.COLOR_BGR2RGB)
        label_alpha = np.ones(label_raw.shape[:2], dtype=np.float32)

    # Quad prep
    quad = sort_quad(quad_raw)
    quad = validate_quad(quad, target_rgb.shape)
    log(f"sorted quad: {quad.tolist()}")

    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)

    # Perspective warp the label into the quad
    lh, lw = label_rgb.shape[:2]
    src = np.array([[0, 0], [lw - 1, 0], [lw - 1, lh - 1], [0, lh - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, quad)

    warped_label = cv2.warpPerspective(
        label_rgb, M, (target_rgb.shape[1], target_rgb.shape[0]),
        flags=cv2.INTER_LANCZOS4,
    )
    warped_alpha = cv2.warpPerspective(
        (label_alpha * 255).astype(np.uint8), M,
        (target_rgb.shape[1], target_rgb.shape[0]),
        flags=cv2.INTER_LINEAR,
    )

    # Build soft mask from warped alpha + quad fill
    mask = np.zeros(target_rgb.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, quad.astype(np.int32), 255)
    # Combine with warped alpha
    mask = np.minimum(mask, warped_alpha)

    # Adaptive soft edge blur
    diag = (target_rgb.shape[0] ** 2 + target_rgb.shape[1] ** 2) ** 0.5
    ksize = max(11, int(diag * 0.003) | 1)
    soft_mask = cv2.GaussianBlur(mask, (ksize, ksize), 0).astype(np.float32) / 255.0

    if debug_dir:
        cv2.imwrite(f"{debug_dir}/woven_01_warped.png", cv2.cvtColor(warped_label, cv2.COLOR_RGB2BGR))
        cv2.imwrite(f"{debug_dir}/woven_02_mask.png", (soft_mask * 255).astype(np.uint8))

    # ── Local luminance matching ──
    # Sample the denim around the label quad and shift label brightness to match
    # the ambient lighting. This prevents the "sticker" look.
    target_lab = cv2.cvtColor(target_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    label_lab = cv2.cvtColor(warped_label, cv2.COLOR_RGB2LAB).astype(np.float32)

    # Build a sampling ring: dilate the quad mask, subtract the inner mask
    quad_mask_binary = (mask > 127).astype(np.uint8) * 255
    ring_kern = max(15, int(diag * 0.012)) | 1
    dilated = cv2.dilate(quad_mask_binary, np.ones((ring_kern, ring_kern), np.uint8))
    ring_mask = cv2.subtract(dilated, quad_mask_binary)

    if ring_mask.sum() > 0:
        surround_L = float(target_lab[:, :, 0][ring_mask > 0].mean())
        label_region = label_lab[:, :, 0][mask > 127]
        if label_region.size > 0:
            label_mean_L = float(label_region.mean())
            # Gentle shift — only 35% of the gap, enough to match ambient lighting
            # without washing out gold text on the dark label
            shift = (surround_L - label_mean_L) * 0.35
            label_lab[:, :, 0] = np.clip(label_lab[:, :, 0] + shift, 0, 255)
            warped_label = cv2.cvtColor(label_lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
            log(f"luminance shift: surround={surround_L:.0f} label={label_mean_L:.0f} shift={shift:+.1f}")

    # ── Subtle cast shadow ──
    # Offset the mask down-right a few pixels, darken the target underneath
    shadow_offset = max(2, int(diag * 0.0015))
    shadow_mask_raw = np.zeros_like(mask)
    h_img, w_img = mask.shape[:2]
    sy, sx = shadow_offset, shadow_offset
    shadow_mask_raw[sy:, sx:] = mask[:h_img - sy, :w_img - sx]
    # Blur the shadow more than the label edge
    shadow_ksize = max(15, int(diag * 0.006) | 1)
    shadow_mask = cv2.GaussianBlur(shadow_mask_raw, (shadow_ksize, shadow_ksize), 0).astype(np.float32) / 255.0
    # Remove overlap with the label itself — shadow only outside the label
    shadow_mask = np.clip(shadow_mask - soft_mask, 0, 1)
    # Darken by 15%
    shadow_layer = (target_rgb.astype(np.float32) * 0.85).astype(np.uint8)
    target_with_shadow = composite(target_rgb, shadow_layer, shadow_mask)

    if debug_dir:
        cv2.imwrite(f"{debug_dir}/woven_03_shadow.png", (shadow_mask * 255).astype(np.uint8))
        cv2.imwrite(f"{debug_dir}/woven_04_lum_label.png", cv2.cvtColor(warped_label, cv2.COLOR_RGB2BGR))

    # Composite label onto shadow-prepped target
    result = composite(target_with_shadow, warped_label, soft_mask)

    if debug_dir:
        cv2.imwrite(f"{debug_dir}/woven_05_final.png", cv2.cvtColor(result, cv2.COLOR_RGB2BGR))

    # Write output
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    cv2.imwrite(output_path, cv2.cvtColor(result, cv2.COLOR_RGB2BGR))
    log(f"wrote {output_path} ({result.shape[1]}x{result.shape[0]})")

    return {
        "ok": True,
        "mode": "woven",
        "output": output_path,
        "quad": quad.tolist(),
        "size": [int(result.shape[1]), int(result.shape[0])],
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: label_hybrid.py <args.json>"}))
        sys.exit(2)
    try:
        with open(sys.argv[1], "r") as f:
            args = json.load(f)
        mode = args.get("mode", "composite")
        if mode == "preview":
            result = run_preview(args)
        elif mode == "woven":
            result = run_woven(args)
        else:
            result = run(args)
        print(json.dumps(result))
    except Exception as e:
        tb = traceback.format_exc()
        log(tb)
        print(json.dumps({"ok": False, "error": str(e), "traceback": tb}))
        sys.exit(1)


if __name__ == "__main__":
    main()
