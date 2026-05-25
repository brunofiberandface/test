#!/usr/bin/env python3
"""
Re-crop a layering ref to the hem ↔ shoe region only.

Same goal as recrop-layering-ref.ts (which was tripping Node 25 + tsx)
but written in Python to bypass the Node toolchain entirely. Uses the
same sa_key.json + GCS bucket as the rest of the scripts/.

The point: when a wardrobe item uses a substitute layering ref (a
different SKU from the actual garment), Seedream pulls wash/silhouette/
pocket signals from the full-image ref and renders the wrong garment.
Cropping to the bottom 40% (below-knee → floor) keeps only the hem ↔
shoe geometry — the only signal we actually want.

Overwrites gs://gstar-ai-studio-assets/layering-refs/{wid}.jpg so
test-m02-tier2-arch.ts picks up the new image on the next run. The
original full image is archived to layering-refs/full/{wid}.jpg
before overwrite (idempotent).

Usage:
  python3 scripts/recrop_layering_ref.py <wardrobeId> [--region=below-knee|tight]
  python3 scripts/recrop_layering_ref.py --all-substitutes [--region=below-knee|tight]

Regions:
  below-knee (default)  bottom 40% of source
  tight                  bottom 28%

Restore originals: gsutil cp gs://.../layering-refs/full/<wid>.jpg .../layering-refs/<wid>.jpg
"""
import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

# Resolve project root + ensure sa_key.json is on the credentials path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SA_KEY_PATH = PROJECT_ROOT / "sa_key.json"
if not SA_KEY_PATH.exists():
    print(f"sa_key.json not found at {SA_KEY_PATH}", file=sys.stderr)
    sys.exit(1)
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(SA_KEY_PATH)

# Lazy-import so error messages are clearer if a dep is missing
try:
    from PIL import Image
except ImportError:
    print("Pillow not installed. Run: pip3 install --user Pillow google-cloud-firestore google-cloud-storage", file=sys.stderr)
    sys.exit(1)
try:
    from google.cloud import firestore, storage
except ImportError:
    print("google-cloud-* not installed. Run: pip3 install --user google-cloud-firestore google-cloud-storage", file=sys.stderr)
    sys.exit(1)

BUCKET = "gstar-ai-studio-assets"
LIVE_PREFIX = "layering-refs"
ARCHIVE_PREFIX = "layering-refs/full"

REGION_BOTTOM = {
    "below-knee": 0.40,
    "tight": 0.28,
}

def process_one(db, bucket, wardrobe_id: str, region: str) -> tuple[bool, str | None]:
    region_frac = REGION_BOTTOM[region]
    doc_ref = db.collection("wardrobe").document(wardrobe_id)
    snap = doc_ref.get()
    if not snap.exists:
        return False, "wardrobe doc not found"
    data = snap.to_dict()

    live_path = f"{LIVE_PREFIX}/{wardrobe_id}.jpg"
    archive_path = f"{ARCHIVE_PREFIX}/{wardrobe_id}.jpg"
    live_blob = bucket.blob(live_path)
    if not live_blob.exists():
        return False, "GCS file not found"

    # 1. Archive the current full image once (idempotent)
    archive_blob = bucket.blob(archive_path)
    if not archive_blob.exists():
        bucket.copy_blob(live_blob, bucket, archive_path)
        print(f"  archived → gs://{BUCKET}/{archive_path}")
    else:
        print(f"  already archived (skip)")

    # 2. Download, crop, re-upload
    src_bytes = live_blob.download_as_bytes()
    img = Image.open(io.BytesIO(src_bytes)).convert("RGB")
    w, h = img.size
    crop_h = int(h * region_frac)
    cropped = img.crop((0, h - crop_h, w, h))
    out_buf = io.BytesIO()
    cropped.save(out_buf, format="JPEG", quality=92)
    out_bytes = out_buf.getvalue()
    live_blob.cache_control = "public, max-age=3600"
    live_blob.upload_from_string(out_bytes, content_type="image/jpeg")

    # 3. Update Firestore — cache-buster + flag
    new_url = f"https://storage.googleapis.com/{BUCKET}/{live_path}?v={int(time.time() * 1000)}"
    existing_source = data.get("layeringRefSource") or {}
    doc_ref.update({
        "layeringRefBackUrl": new_url,
        "layeringRefSource": {
            **existing_source,
            "cropped": True,
            "cropRegion": region,
            "croppedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    print(f"  ✓ recropped {region} ({w}×{h} → {w}×{crop_h}, {len(out_bytes)//1024} KB)")
    return True, None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("wardrobe_id", nargs="?", help="Wardrobe item ID to recrop")
    parser.add_argument("--all-substitutes", action="store_true", help="Iterate all bottoms with substitute layering refs")
    parser.add_argument("--region", choices=list(REGION_BOTTOM.keys()), default="below-knee")
    args = parser.parse_args()

    if not args.wardrobe_id and not args.all_substitutes:
        parser.error("provide a <wardrobeId> or --all-substitutes")

    with open(SA_KEY_PATH) as f:
        sa_key = json.load(f)
    project_id = sa_key.get("project_id", "gstar-ai-studio")
    db = firestore.Client(project=project_id)
    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(BUCKET)

    print(f"Mode: {'ALL substitutes' if args.all_substitutes else f'single ({args.wardrobe_id})'} | region: {args.region} (bottom {int(REGION_BOTTOM[args.region]*100)}%)")

    if args.all_substitutes:
        col = db.collection("wardrobe").where("category", "==", "bottom").stream()
        processed = skipped = failed = 0
        for doc in col:
            data = doc.to_dict()
            src = data.get("layeringRefSource") or {}
            if not src.get("substitute"):
                skipped += 1
                continue
            print(f"\n{doc.id}  {data.get('name')}  (substitute for {src.get('substituteFor')})")
            try:
                ok, note = process_one(db, bucket, doc.id, args.region)
                if ok: processed += 1
                else: failed += 1; print(f"  ⚠️  {note}")
            except Exception as e:
                failed += 1
                print(f"  ❌ {e}")
        print(f"\nSummary: {processed} cropped, {skipped} skipped (not substitutes), {failed} failed.")
    else:
        print(f"\n{args.wardrobe_id}")
        ok, note = process_one(db, bucket, args.wardrobe_id, args.region)
        if not ok:
            print(f"Failed: {note}", file=sys.stderr)
            sys.exit(1)

    print(f"\n💡 Re-run test-m02-tier2-arch.ts to see if the cropped ref improves stability.")
    print(f"💡 Restore: gsutil cp gs://{BUCKET}/{ARCHIVE_PREFIX}/<wid>.jpg gs://{BUCKET}/{LIVE_PREFIX}/<wid>.jpg")


if __name__ == "__main__":
    main()
