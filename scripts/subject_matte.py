#!/usr/bin/env python3
"""
Subject matte + backdrop variants — produces white/grey deliverables for M0x shots.

Pipeline:
  1. rembg + U²-Net + alpha_matting=True → subject alpha (clean hair edges, no halo)
  2. Build TWO shadow layers (one matting pass, reused across all backdrop colors):
     a. Directional cast shadow (full body silhouette projected upward + sheared,
        anchored at the foot mass bottom — light from upper-front-RIGHT, shadow
        extends to upper-LEFT).
     b. Per-foot heel-tip contact pad (small soft ellipse glued to each foot's
        actual floor contact — auto-detected per-column for asymmetric stances).
  3. For each requested backdrop color: solid canvas + cast + heel + matte.

Mirrors the scripts/label_hybrid.py pattern: takes a JSON args file path on argv[1],
emits a JSON result to stdout, logs to stderr.

Args JSON:
  {
    "src_path": "/tmp/in.png",
    "outputs": [
      {"name": "white", "color": [255,255,255], "out_path": "/tmp/out_white.png"},
      {"name": "grey",  "color": [217,218,210], "out_path": "/tmp/out_grey.png"}
    ],
    "disable_shadow": false,  # optional; true for shots with no feet visible (M05)
    "shadow": {  # optional; defaults applied if absent (ignored when disable_shadow=true)
      "cast":         {"shear": -0.30, "compress": 0.12, "opacity": 0.20, "blur": 130, "tint": [20,20,25]},
      "heel_contact": {"width": 130, "height": 20, "opacity": 110, "blur": 22, "y_offset": -5, "tint": [20,20,25]}
    }
  }

Result JSON:
  { "ok": true, "outputs": [{"name": "white", "out_path": "..."}, ...] }
"""

import io
import json
import sys
import time
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rembg import new_session, remove


_SESSION = None


def get_session():
    global _SESSION
    if _SESSION is None:
        log("loading u2net session (first call downloads ~170MB)")
        t0 = time.time()
        _SESSION = new_session("u2net")
        log(f"u2net session loaded in {time.time()-t0:.1f}s")
    return _SESSION


def log(msg: str) -> None:
    print(f"[subject_matte] {msg}", file=sys.stderr, flush=True)


def matte_subject(src_path: str) -> tuple[Image.Image, Image.Image]:
    """Returns (rgba_matte, alpha) for the subject extracted from src_path."""
    log(f"matting {src_path}")
    t0 = time.time()
    with open(src_path, "rb") as f:
        raw = f.read()
    out_bytes = remove(
        raw,
        session=get_session(),
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=10,
    )
    rgba = Image.open(io.BytesIO(out_bytes)).convert("RGBA")
    alpha = rgba.split()[-1]
    log(f"matted in {time.time()-t0:.1f}s ({rgba.size[0]}x{rgba.size[1]})")
    return rgba, alpha


def find_foot_mass_bottom(alpha: Image.Image) -> int:
    """Return y of foot mass bottom — the visible sole/foot pad, NOT the heel pin tip.

    Sample alpha row by row; lowest row where >=20% of subject width is opaque is the
    foot mass. (bbox.y1 is the heel pin tip for high heels — the cast shadow should
    anchor to the foot mass, not the pin tip, or it ends up "pinned" too far down.)
    """
    bbox = alpha.getbbox()
    if not bbox:
        return 0
    x0, y0, x1, y1 = bbox
    sw = x1 - x0
    threshold = max(30, int(sw * 0.10))
    arr = np.array(alpha)
    for y in range(y1, y0, -1):
        if (arr[y] > 200).sum() >= threshold * 2:
            return y
    return y1


def find_heel_tips(alpha: Image.Image) -> list[tuple[int, int, int]]:
    """Return per-foot heel-tip positions: list of (cx, cy, foot_width).

    Per-column scan of the alpha for the lowest opaque pixel. Group adjacent columns
    into runs (each is a foot). For each foot, contact point is the column with the
    deepest y in the run. Each foot can contact at a different y-level (asymmetric
    stance), so per-foot detection is essential.
    """
    bbox = alpha.getbbox()
    if not bbox:
        return []
    x0, y0, x1, y1 = bbox
    arr = np.array(alpha)
    w = arr.shape[1]
    col_lowest = np.full(w, -1, dtype=int)
    for x in range(w):
        col = arr[:, x]
        opaque = np.where(col > 200)[0]
        if len(opaque) > 0:
            col_lowest[x] = opaque[-1]
    feet_cols = (col_lowest > y1 - 100) & (col_lowest <= y1)
    runs: list[tuple[int, int]] = []
    in_run = False
    start = 0
    for x in range(w):
        if feet_cols[x] and not in_run:
            start = x
            in_run = True
        elif not feet_cols[x] and in_run:
            runs.append((start, x))
            in_run = False
    if in_run:
        runs.append((start, w))
    feet: list[tuple[int, int, int]] = []
    for s, e in runs:
        if e - s < 5:
            continue
        cx = (s + e) // 2
        cy = int(col_lowest[s:e].max())
        feet.append((cx, cy, e - s))
    return feet


def build_cast_shadow(
    alpha: Image.Image,
    y_foot_mass: int,
    canvas_size: tuple[int, int],
    shear: float,
    compress: float,
    opacity: float,
    blur: int,
    tint: tuple[int, int, int],
) -> Image.Image:
    """Build a directional cast shadow layer (RGBA, transparent except shadow).

    Forward projection per source pixel (x_src, y_src):
      y_dst = y_foot_mass - (y1 - y_src) * compress
      x_dst = x_src + shear * (y1 - y_src)
    Inverse (PIL.AFFINE expects this):
      y_src = y1 + (y_dst - y_foot_mass) / compress
      x_src = x_dst + shear * (y_dst - y_foot_mass) / compress
    """
    w, h = canvas_size
    bbox = alpha.getbbox()
    if not bbox:
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))
    _, _, _, y1 = bbox

    a, b, c = 1.0, shear / compress, -shear * y_foot_mass / compress
    d, e, f = 0.0, 1.0 / compress, y1 - y_foot_mass / compress
    projected = alpha.transform(
        (w, h), Image.AFFINE, (a, b, c, d, e, f),
        resample=Image.BILINEAR, fillcolor=0,
    )
    arr = np.array(projected)
    arr[y_foot_mass + 1:, :] = 0  # strict backward cast (no forward extension)
    projected = Image.fromarray(arr, "L")

    dark = Image.new("RGB", (w, h), tint)
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shadow.paste(dark, (0, 0))
    shadow.putalpha(projected.point(lambda p: int(p * opacity)))
    return shadow.filter(ImageFilter.GaussianBlur(radius=blur))


def build_heel_contact(
    heel_tips: list[tuple[int, int, int]],
    canvas_size: tuple[int, int],
    width: int,
    height: int,
    opacity: int,
    blur: int,
    y_offset: int,
    tint: tuple[int, int, int],
) -> Image.Image:
    """Per-foot heel-tip contact ellipse, glued to floor (y_offset places ellipse
    mostly above heel tip → overlaps heel pin in matte → only bottom edge bleeds
    onto the visible floor → no floating gap)."""
    w, h = canvas_size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if not heel_tips:
        return layer
    sd = ImageDraw.Draw(layer)
    for hx, hy, _hw in heel_tips:
        cy = hy + y_offset
        sd.ellipse(
            [hx - width // 2, cy - height // 2, hx + width // 2, cy + height // 2],
            fill=(*tint, opacity),
        )
    return layer.filter(ImageFilter.GaussianBlur(radius=blur))


# Bruno-approved defaults (2026-05-05, after softening pass):
#   cast: G_compress12 — soft directional shadow extending upper-LEFT, FLAT against floor
#         (compress 0.12 keeps head shadow within ~530px of foot, so floor doesn't look uphill)
#   heel: B_diffuse — softened per-foot contact pad, opacity 110, blur 22
DEFAULT_SHADOW = {
    "cast": {
        "shear": -0.30,
        "compress": 0.12,
        "opacity": 0.20,
        "blur": 130,
        "tint": [20, 20, 25],
    },
    "heel_contact": {
        "width": 130,
        "height": 20,
        "opacity": 110,
        "blur": 22,
        "y_offset": -5,
        "tint": [20, 20, 25],
    },
}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing args.json path"}))
        sys.exit(1)
    args_path = sys.argv[1]
    with open(args_path) as f:
        args = json.load(f)

    src_path: str = args["src_path"]
    outputs: list[dict[str, Any]] = args["outputs"]
    disable_shadow: bool = bool(args.get("disable_shadow", False))
    shadow_cfg = {**DEFAULT_SHADOW, **(args.get("shadow") or {})}

    matte, alpha = matte_subject(src_path)
    w, h = matte.size

    if disable_shadow:
        log("disable_shadow=True — skipping cast + heel layer build")
        cast_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        heel_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    else:
        y_foot_mass = find_foot_mass_bottom(alpha)
        heel_tips = find_heel_tips(alpha)
        log(f"foot_mass_bottom y={y_foot_mass}  heel_tips={heel_tips}")
        cast_cfg = shadow_cfg["cast"]
        cast_layer = build_cast_shadow(
            alpha=alpha, y_foot_mass=y_foot_mass, canvas_size=(w, h),
            shear=cast_cfg["shear"], compress=cast_cfg["compress"],
            opacity=cast_cfg["opacity"], blur=cast_cfg["blur"],
            tint=tuple(cast_cfg["tint"]),
        )
        hc_cfg = shadow_cfg["heel_contact"]
        heel_layer = build_heel_contact(
            heel_tips=heel_tips, canvas_size=(w, h),
            width=hc_cfg["width"], height=hc_cfg["height"],
            opacity=hc_cfg["opacity"], blur=hc_cfg["blur"],
            y_offset=hc_cfg["y_offset"], tint=tuple(hc_cfg["tint"]),
        )

    written = []
    for out in outputs:
        name = out["name"]
        color = tuple(out["color"])
        out_path = out["out_path"]
        t0 = time.time()
        canvas = Image.new("RGBA", (w, h), (color[0], color[1], color[2], 255))
        canvas.alpha_composite(cast_layer)
        canvas.alpha_composite(heel_layer)
        canvas.alpha_composite(matte)
        canvas.convert("RGB").save(out_path, format="PNG", optimize=False)
        log(f"wrote '{name}' on color {color} in {time.time()-t0:.1f}s -> {out_path}")
        written.append({"name": name, "out_path": out_path})

    print(json.dumps({"ok": True, "outputs": written}))


if __name__ == "__main__":
    main()
