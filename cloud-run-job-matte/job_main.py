#!/usr/bin/env python3
"""
Cloud Run Job entry point for the rembg subject-matte pipeline.

Runs as a Cloud Run Job with always-on CPU (no throttling), avoiding the silent
hang LEARNINGS #77/#78 documented for the same workload running inside the main
gstar-ai-studio service.

Inputs (env vars set by the invoking gstar-ai-studio service):
  SRC_GCS_URL         — gs:// URL of the source PNG to mat
  DST_WHITE_GCS_URL   — gs:// URL to write the white-bg deliverable
  DST_GREY_GCS_URL    — gs:// URL to write the brand-grey-bg deliverable
  DISABLE_SHADOW      — "true"/"1" to skip cast + heel layers (M05 close-up, no feet)

Reuses subject_matte.py (the working POC from the previous session) for all the
matting + composite logic — copied here verbatim. Bruno-approved shadow params
(G_compress12 + B_diffuse) baked in.

Exit codes:
  0  — success (both outputs uploaded)
  1  — argument/env error
  2  — GCS read failure
  3  — matting/composite failure
  4  — GCS write failure
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

from google.cloud import storage  # google-cloud-storage SDK
from subject_matte import matte_subject, find_foot_mass_bottom, find_heel_tips, build_cast_shadow, build_heel_contact, DEFAULT_SHADOW
from PIL import Image


def log(msg: str) -> None:
    print(f"[matte-job] {msg}", flush=True)


def parse_gcs_url(url: str) -> tuple[str, str]:
    """gs://bucket/path/to/file.png → (bucket, path/to/file.png)"""
    if not url.startswith("gs://"):
        raise ValueError(f"expected gs:// URL, got: {url}")
    rest = url[5:]
    bucket, _, key = rest.partition("/")
    if not bucket or not key:
        raise ValueError(f"malformed GCS URL: {url}")
    return bucket, key


def main() -> int:
    src_url = os.environ.get("SRC_GCS_URL")
    white_url = os.environ.get("DST_WHITE_GCS_URL")
    grey_url = os.environ.get("DST_GREY_GCS_URL")
    disable_shadow = os.environ.get("DISABLE_SHADOW", "").lower() in ("1", "true", "yes")

    if not src_url or not white_url or not grey_url:
        log("MISSING ENV: SRC_GCS_URL / DST_WHITE_GCS_URL / DST_GREY_GCS_URL")
        return 1

    log(f"src={src_url}")
    log(f"white={white_url}")
    log(f"grey={grey_url}")
    log(f"disable_shadow={disable_shadow}")

    client = storage.Client()

    # 1. Download source
    try:
        src_bucket, src_key = parse_gcs_url(src_url)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            local_src = f.name
        t0 = time.time()
        client.bucket(src_bucket).blob(src_key).download_to_filename(local_src)
        log(f"downloaded source in {time.time()-t0:.1f}s ({Path(local_src).stat().st_size} bytes)")
    except Exception as e:
        log(f"GCS read failed: {e}")
        return 2

    # 2. Matte + composite
    try:
        t0 = time.time()
        matte, alpha = matte_subject(local_src)
        w, h = matte.size

        if disable_shadow:
            log("disable_shadow=True — skipping cast + heel layer build")
            cast_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            heel_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        else:
            y_foot_mass = find_foot_mass_bottom(alpha)
            heel_tips = find_heel_tips(alpha)
            log(f"foot_mass_bottom y={y_foot_mass}  heel_tips={heel_tips}")

            cast_cfg = DEFAULT_SHADOW["cast"]
            cast_layer = build_cast_shadow(
                alpha=alpha, y_foot_mass=y_foot_mass, canvas_size=(w, h),
                shear=cast_cfg["shear"], compress=cast_cfg["compress"],
                opacity=cast_cfg["opacity"], blur=cast_cfg["blur"],
                tint=tuple(cast_cfg["tint"]),
            )
            hc_cfg = DEFAULT_SHADOW["heel_contact"]
            heel_layer = build_heel_contact(
                heel_tips=heel_tips, canvas_size=(w, h),
                width=hc_cfg["width"], height=hc_cfg["height"],
                opacity=hc_cfg["opacity"], blur=hc_cfg["blur"],
                y_offset=hc_cfg["y_offset"], tint=tuple(hc_cfg["tint"]),
            )

        # Composite onto white + brand-grey.
        outputs = [
            ("white", (255, 255, 255), white_url),
            ("grey",  (217, 218, 210), grey_url),
        ]
        out_files = []
        for name, color, _url in outputs:
            canvas = Image.new("RGBA", (w, h), (color[0], color[1], color[2], 255))
            canvas.alpha_composite(cast_layer)
            canvas.alpha_composite(heel_layer)
            canvas.alpha_composite(matte)
            out_path = tempfile.mktemp(suffix=f"_{name}.png")
            canvas.convert("RGB").save(out_path, format="PNG", optimize=False)
            out_files.append((name, out_path, _url))
            log(f"composed '{name}' → {out_path}")

        log(f"matte + composite done in {time.time()-t0:.1f}s")
    except Exception as e:
        log(f"matting/composite failed: {e}")
        import traceback
        traceback.print_exc()
        return 3

    # 3. Upload results
    try:
        t0 = time.time()
        for name, local_path, gcs_url in out_files:
            bucket, key = parse_gcs_url(gcs_url)
            client.bucket(bucket).blob(key).upload_from_filename(local_path, content_type="image/png")
            size = Path(local_path).stat().st_size
            log(f"uploaded '{name}' ({size} bytes) → {gcs_url}")
        log(f"uploads done in {time.time()-t0:.1f}s")
    except Exception as e:
        log(f"GCS write failed: {e}")
        return 4

    log("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
