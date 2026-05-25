#!/usr/bin/env python3
"""
One-shot: commit a hand-tuned description for the boxy black tee
(kP9CgnGLwOaJiUrFdJFE) — Gemini's regen called it "deep navy blue", but
pixel sampling + photo review confirm it's effectively BLACK with a faint
blue cast from cool studio lighting. Brand intent is BLACK.

This script takes Gemini's regen output and swaps the color descriptor to
"black", then writes to Firestore. Original Gemini regen + previous
description are archived in topDescriptionRegen.
"""
import json
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SA_KEY_PATH = PROJECT_ROOT / "sa_key.json"
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(SA_KEY_PATH)

from google.cloud import firestore  # noqa

WID = "kP9CgnGLwOaJiUrFdJFE"

# Hand-tuned: Gemini's regen with "deep navy blue" → "black".
NEW_DESCRIPTION = (
    "A solid black, medium-weight cotton jersey knit top with a ribbed crew "
    "neck. It features wide, elbow-length sleeves and a boxy, cropped fit, "
    "finished with double-stitched hems on the body and sleeves. A white "
    "rectangular label is visible at the back of the neck."
)
NEW_HINT = "cropped — natural hem at navel level, expose 3-4 inches midriff above waistband"


def main():
    commit = "--commit" in sys.argv
    print(f"Mode: {'COMMIT' if commit else 'DRY-RUN'}")

    with open(SA_KEY_PATH) as f:
        sa = json.load(f)
    db = firestore.Client(project=sa.get("project_id", "gstar-ai-studio"))
    ref = db.collection("wardrobe").document(WID)
    snap = ref.get()
    if not snap.exists:
        print(f"{WID} not found"); sys.exit(1)
    data = snap.to_dict()
    print(f"\n=== {WID}  {data.get('name')} ===\n")
    print(f"  OLD topDescription:\n    {data.get('topDescription', '-')}\n")
    print(f"  NEW topDescription:\n    {NEW_DESCRIPTION}\n")
    print(f"  OLD topRenderingHint:\n    {data.get('topRenderingHint', '(none)')}\n")
    print(f"  NEW topRenderingHint:\n    {NEW_HINT}\n")

    if not commit:
        print("💡 dry-run — re-run with --commit to write")
        return

    prior = data.get("topDescriptionRegen") or {}
    ref.update({
        "topDescription": NEW_DESCRIPTION,
        "topRenderingHint": NEW_HINT,
        "topDescriptionRegen": {
            **prior,
            "regeneratedAt": firestore.SERVER_TIMESTAMP,
            "regeneratedBy": "manual color-correction (Gemini called it navy; brand intent is black)",
            "model": "manual",
            "previousDescription": data.get("topDescription", ""),
            "geminiSaidNavy": True,
        },
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    print("  ✓ Firestore updated.")


if __name__ == "__main__":
    main()
