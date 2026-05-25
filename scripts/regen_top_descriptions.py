#!/usr/bin/env python3
"""
Regenerate top descriptions + add topRenderingHint via Gemini-2.5-flash.

For each top in the target list:
  1. Collect available product images (flat_front, flat_back, fitModels.front,
     fitModels.back).
  2. Send those images + a structured prompt to Gemini-2.5-flash.
  3. Get back STRICT JSON with two fields:
       - topDescription:    rich 2-3 sentence description (used for M03/M04/M06
                            full-top renders).
       - topRenderingHint:  concise instruction for how the top should appear
                            in M02 (waist-down back view) — specifies where the
                            hem lands and how much midriff is exposed. Used by
                            paintTeeHemStrip.
  4. Print old vs new, side-by-side. Write only when --commit is passed.

Target list (per Bruno 2026-05-24):
  kP9CgnGLwOaJiUrFdJFE  — boxy black tee
  SyEgAYZ2EhoxeqOg6ZH0  — white loose cropped top
  I0d5sDjiqyVY24BwWTAn  — grey long sleeve cropped

Usage:
  python3 scripts/regen_top_descriptions.py --all-three           # dry-run
  python3 scripts/regen_top_descriptions.py --all-three --commit  # write
  python3 scripts/regen_top_descriptions.py --only=<wid>          # single dry-run
  python3 scripts/regen_top_descriptions.py --only=<wid> --commit
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SA_KEY_PATH = PROJECT_ROOT / "sa_key.json"
ENV_PATH = PROJECT_ROOT / ".env.local"

# Load .env.local for GEMINI_API_KEY
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        m = re.match(r"^([A-Z_][A-Z0-9_]*)=(.*)$", line)
        if m and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip("'\"")
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(SA_KEY_PATH)

try:
    from google.cloud import firestore
    import google.auth
    from google.auth.transport.requests import Request as AuthRequest
except ImportError:
    print("pip3 install --user google-cloud-firestore google-auth", file=sys.stderr); sys.exit(1)

# Use Vertex AI Gemini-2.5-flash with the service account (sa_key.json).
# No GEMINI_API_KEY needed — auth via google.auth → Bearer token from SA.
# Project ID is read from sa_key.json so this works on any machine with the
# repo + sa_key.json.
with open(SA_KEY_PATH) as _sa_f:
    _SA = json.load(_sa_f)
VERTEX_PROJECT = _SA.get("project_id", "gstar-ai-studio")
VERTEX_LOCATION = "us-central1"
GEMINI_MODEL = "gemini-2.5-flash"
VERTEX_URL = (
    f"https://{VERTEX_LOCATION}-aiplatform.googleapis.com/v1/"
    f"projects/{VERTEX_PROJECT}/locations/{VERTEX_LOCATION}/"
    f"publishers/google/models/{GEMINI_MODEL}:generateContent"
)

# Resolve a Bearer token from the service account credentials. Cached so we
# don't re-resolve per call.
_auth_creds = None
def get_auth_token() -> str:
    global _auth_creds
    if _auth_creds is None:
        _auth_creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not _auth_creds.token or _auth_creds.expired:
        _auth_creds.refresh(AuthRequest())
    return _auth_creds.token

print(f"Using Vertex AI {GEMINI_MODEL} in project {VERTEX_PROJECT} ({VERTEX_LOCATION})", file=sys.stderr)

TARGETS = {
    "kP9CgnGLwOaJiUrFdJFE": "boxy black tee",
    "SyEgAYZ2EhoxeqOg6ZH0": "white loose cropped top",
    "I0d5sDjiqyVY24BwWTAn": "grey long sleeve cropped",
}

PROMPT = """You are looking at a top garment for a fashion e-commerce photo pipeline. Describe it precisely so an image-generation model can render it consistently across different shot types.

Output STRICT JSON with EXACTLY these two fields, no additional text outside the JSON:

{
  "topDescription": "...",
  "topRenderingHint": "..."
}

topDescription
  A complete, detailed description of the garment. Include: color (specific shade), fabric texture and weight, neckline style, sleeve length and shape, fit profile (slim / fitted / boxy / oversized / cropped), exact hem treatment (raw, finished, ribbed, etc.), any branding or labels visible, and any visible construction details. 2-3 sentences, roughly 50-80 words. Used for full-body shot rendering (M03 / M04 / M06).

topRenderingHint
  Short concrete instruction for how this top should appear when used as the top in a M02 back-view cropped product shot. The M02 frame shows the model from the waist down to the feet, plus a thin sliver of lower torso / midriff at the top of the frame. The hint specifies EXACTLY where the top's hem lands relative to the trouser waistband AND how much skin is visible between hem and waistband.

  For cropped tops, the hint must be in the form:
    "cropped — natural hem at <position>, expose <amount> midriff above waistband"
  Example positions: "navel level", "high waist", "lower ribcage". Example amounts: "1-2 inches", "3-4 cm", "narrow strip".

  For full-length tops that tuck under the waistband:
    "full-length, tucked — fabric continues to waistband, no visible hem, disappears under waistband"

  For tops that fall over the waistband without tucking:
    "full-length, untucked — hem falls over the waistband, drapes loosely, no visible midriff"

  Pick exactly one form based on what the images show. Keep the hint to one short sentence.

Be precise. No marketing copy. No filler. Output ONLY the JSON object.
"""


def fetch_image_as_base64(url: str) -> tuple[str, str]:
    req = urllib.request.Request(url.split("?")[0], headers={"User-Agent": "Mozilla/5.0"})
    resp = urllib.request.urlopen(req, timeout=30)
    data = resp.read()
    mime = resp.headers.get("Content-Type") or "image/jpeg"
    # Magic-byte sanity check — fall back to image/jpeg if Cloudinary returns text/html
    if data[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    return base64.b64encode(data).decode("ascii"), mime


def collect_image_urls(item: dict) -> list[tuple[str, str]]:
    """Return [(label, url), ...] of available product images for this top."""
    urls = []
    fm = item.get("fitModels") or {}
    for key, url in [
        ("flat front", item.get("flatFrontUrl")),
        ("flat back", item.get("flatBackUrl")),
        ("flat (other)", item.get("flatImageUrl")),
        ("fit-model front", fm.get("front")),
        ("fit-model back", fm.get("back")),
    ]:
        if url and url.strip() and url not in [u for _, u in urls]:
            urls.append((key, url))
    return urls


def call_gemini(image_urls: list[tuple[str, str]]) -> dict:
    parts = [{"text": PROMPT}]
    for label, url in image_urls:
        b64, mime = fetch_image_as_base64(url)
        parts.append({"text": f"[{label}]"})
        # Vertex AI uses camelCase: inlineData + mimeType (not inline_data / mime_type)
        parts.append({"inlineData": {"mimeType": mime, "data": b64}})

    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }
    req = urllib.request.Request(
        VERTEX_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {get_auth_token()}",
        },
    )
    resp = urllib.request.urlopen(req, timeout=60)
    parsed = json.loads(resp.read().decode("utf-8"))
    candidates = parsed.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini returned no candidates: {json.dumps(parsed)[:400]}")
    text = candidates[0]["content"]["parts"][0]["text"]
    # Sometimes Gemini wraps JSON in markdown fences even with responseMimeType set
    text = re.sub(r"^\s*```(?:json)?|```\s*$", "", text, flags=re.MULTILINE).strip()
    result = json.loads(text)
    if not isinstance(result.get("topDescription"), str) or not isinstance(result.get("topRenderingHint"), str):
        raise RuntimeError(f"Gemini result missing fields: {result}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="Single wardrobeId to regen")
    parser.add_argument("--all-three", action="store_true", help="Regen all 3 named tops")
    parser.add_argument("--commit", action="store_true", help="Write to Firestore (default: dry-run)")
    args = parser.parse_args()
    if not args.only and not args.all_three:
        parser.error("--only=<id> or --all-three required")

    with open(SA_KEY_PATH) as f:
        sa = json.load(f)
    db = firestore.Client(project=sa.get("project_id", "gstar-ai-studio"))

    ids = [args.only] if args.only else list(TARGETS.keys())
    print(f"Mode: {'COMMIT' if args.commit else 'DRY-RUN'} | targets: {len(ids)}")

    for wid in ids:
        ref = db.collection("wardrobe").document(wid)
        snap = ref.get()
        if not snap.exists:
            print(f"\n{wid}: NOT FOUND"); continue
        data = snap.to_dict()
        name = data.get("name", "?")
        print(f"\n=== {wid}  {name} ===")
        urls = collect_image_urls(data)
        if not urls:
            print("  no images — skip"); continue
        print(f"  feeding {len(urls)} image(s) to Gemini: {[label for label,_ in urls]}")

        try:
            result = call_gemini(urls)
        except Exception as e:
            print(f"  ❌ Gemini call failed: {e}"); continue

        old_desc = data.get("topDescription") or data.get("description") or ""
        old_hint = data.get("topRenderingHint") or "(none)"
        new_desc = result["topDescription"].strip()
        new_hint = result["topRenderingHint"].strip()
        print(f"\n  OLD topDescription:")
        print(f"    {old_desc[:300]}")
        print(f"  NEW topDescription:")
        print(f"    {new_desc}")
        print(f"\n  OLD topRenderingHint:")
        print(f"    {old_hint}")
        print(f"  NEW topRenderingHint:")
        print(f"    {new_hint}")

        if args.commit:
            ref.update({
                "topDescription": new_desc,
                "topRenderingHint": new_hint,
                "topDescriptionRegen": {
                    "regeneratedAt": firestore.SERVER_TIMESTAMP,
                    "regeneratedBy": "claude-cli regen_top_descriptions.py",
                    "model": GEMINI_MODEL,
                    "imagesFed": [label for label, _ in urls],
                    "previousDescription": old_desc,
                },
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            print(f"  ✓ Firestore updated.")

    print(f"\n{'✓ committed' if args.commit else '💡 dry-run only — re-run with --commit to write'}")


if __name__ == "__main__":
    main()
