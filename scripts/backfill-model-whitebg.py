#!/usr/bin/env python3
"""
Backfill model reference images to pure-white background.

For each active model whose referenceImageUrl has a non-white backdrop
(corner samples > tolerance from 255,255,255), run the matte job and
update the referenceImageUrl to the white-bg variant. Same logic as the
new /api/models POST pipeline, applied to existing models.

SAFE: only updates referenceImageUrl. Preserves the previous URL as
originalReferenceImageUrl (if not already set). Idempotent — re-running
skips models already at white-bg.

Cost: $0 (matte job is rembg + sharp, no Gemini/Seedream).
Time: ~30-60s per model (sequential — could parallelise but rembg job
has concurrency=1 anyway).

Run from project root:
  ./scripts/backfill-model-whitebg.py            # process all active models
  ./scripts/backfill-model-whitebg.py F3 F8 F10  # specific model IDs only
"""
import urllib.request, urllib.parse, json, os, time, sys, io

TOKEN = os.popen('gcloud auth application-default print-access-token').read().strip()
PROJECT = 'gstar-ai-studio'
REGION = 'europe-west1'
BUCKET = 'gstar-ai-studio-assets'
MATTE_JOB = 'subject-matte-job'
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
RUN_API_BASE = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}"

# Tolerance for "already white" detection. RGB(243,243,243) and above is
# considered white-bg already (matte job overhead isn't worth running).
WHITE_TOLERANCE = 243

def list_active_models():
    q = {"structuredQuery": {
        "from": [{"collectionId": "models"}],
        "where": {"fieldFilter": {"field": {"fieldPath": "active"}, "op": "EQUAL", "value": {"booleanValue": True}}},
        "limit": 200,
    }}
    req = urllib.request.Request(BASE+":runQuery", data=json.dumps(q).encode(), method='POST',
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read(), strict=False)
    out = []
    for d in data:
        doc = d.get('document', {})
        if not doc: continue
        mid = doc['name'].split('/')[-1]
        f = doc.get('fields', {})
        ref = f.get('referenceImageUrl', {}).get('stringValue', '')
        if ref:
            out.append({
                'modelId': mid,
                'name': f.get('name', {}).get('stringValue', '?'),
                'referenceImageUrl': ref,
                'hasOriginal': 'originalReferenceImageUrl' in f,
            })
    return out

def sample_corners(image_url):
    """Return (r, g, b) average of the 4 corners. Lazily imports PIL."""
    from PIL import Image
    clean = image_url.split('?')[0]
    proto, rest = clean.split('://', 1); host, path = rest.split('/', 1)
    enc = proto + '://' + host + '/' + urllib.parse.quote(path)
    with urllib.request.urlopen(enc) as r:
        buf = r.read()
    im = Image.open(io.BytesIO(buf))
    samples = []
    for x, y in [(50, 50), (im.width-150, 50), (50, im.height-150), (im.width-150, im.height-150)]:
        px = im.crop((x, y, x+100, y+100)).resize((1, 1)).getpixel((0, 0))[:3]
        samples.append(px)
    avg = tuple(round(sum(s[i] for s in samples) / 4) for i in range(3))
    return avg

def is_already_white(rgb):
    return all(c >= WHITE_TOLERANCE for c in rgb)

def https_to_gcs(url):
    u = urllib.parse.urlparse(url.split('?')[0])
    parts = u.path.lstrip('/').split('/', 1)
    return f"gs://{parts[0]}/{parts[1]}"

def run_matte(src_gcs, dst_white_gcs):
    """Trigger matte job, poll until done."""
    dst_grey = dst_white_gcs.replace('_white.png', '_tmpgrey.png')
    body = {"overrides": {"containerOverrides": [{
        "env": [
            {"name": "SRC_GCS_URL", "value": src_gcs},
            {"name": "DST_WHITE_GCS_URL", "value": dst_white_gcs},
            {"name": "DST_GREY_GCS_URL", "value": dst_grey},
            {"name": "DISABLE_SHADOW", "value": "1"},
        ],
    }]}}
    url = f"{RUN_API_BASE}/jobs/{MATTE_JOB}:run"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        op = json.loads(r.read(), strict=False)
    op_url = f"https://run.googleapis.com/v2/{op['name']}"
    deadline = time.time() + 300
    while time.time() < deadline:
        time.sleep(8)
        with urllib.request.urlopen(urllib.request.Request(op_url, headers={'Authorization': f'Bearer {TOKEN}'})) as r:
            st = json.loads(r.read(), strict=False)
        if st.get('done'):
            if st.get('error'):
                raise RuntimeError(f"matte job failed: {st['error'].get('message')}")
            return
    raise TimeoutError(f"matte job timed out after 300s")

def update_model(model_id, new_ref_url, original_url_to_save):
    fields = {"referenceImageUrl": {"stringValue": new_ref_url}}
    if original_url_to_save:
        fields["originalReferenceImageUrl"] = {"stringValue": original_url_to_save}
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields.keys())
    body = {"fields": fields}
    url = f"{BASE}/models/{model_id}?{mask}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='PATCH',
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    urllib.request.urlopen(req).read()

# ── main ──
arg_ids = set(sys.argv[1:])
print(f"Listing active models{f' (filtered to {arg_ids})' if arg_ids else ''}...")
all_models = list_active_models()
to_process = [m for m in all_models if not arg_ids or m['modelId'] in arg_ids]
print(f"Considering {len(to_process)} of {len(all_models)} active models.\n")

processed = []
skipped = []
errors = []
for i, m in enumerate(to_process, start=1):
    mid = m['modelId']
    ref = m['referenceImageUrl']
    print(f"[{i}/{len(to_process)}] {mid} ({m['name']})")
    try:
        # Skip if URL already points to a _whitebg path (from previous backfill or new-create pipeline)
        if '_whitebg' in ref:
            print(f"  ↪ URL already points to _whitebg path — skip")
            skipped.append((mid, 'already-whitebg-url'))
            continue
        # Sample corners
        avg = sample_corners(ref)
        if is_already_white(avg):
            print(f"  ↪ Already white-bg (corners avg RGB{avg}) — skip")
            skipped.append((mid, f'already-white-RGB{avg}'))
            continue
        print(f"  Corner avg RGB{avg} → needs matte")
        # Run matte
        src_gcs = https_to_gcs(ref)
        dst_gcs = f"gs://{BUCKET}/model-cards/_whitebg/{mid}_white.png"
        run_matte(src_gcs, dst_gcs)
        new_ref = f"https://storage.googleapis.com/{BUCKET}/model-cards/_whitebg/{mid}_white.png?v={int(time.time()*1000)}"
        update_model(mid, new_ref, original_url_to_save=(ref.split('?')[0] if not m['hasOriginal'] else None))
        print(f"  ✓ Updated → {new_ref[:80]}...")
        processed.append(mid)
    except Exception as e:
        print(f"  ✗ ERROR: {e}")
        errors.append((mid, str(e)))

print(f"\n=== Summary ===")
print(f"Processed: {len(processed)}  {processed}")
print(f"Skipped:   {len(skipped)}")
for s in skipped[:10]: print(f"  {s[0]}: {s[1]}")
print(f"Errors:    {len(errors)}")
for e in errors: print(f"  {e[0]}: {e[1]}")
