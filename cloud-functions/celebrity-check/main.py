"""
Celebrity Resemblance Detection — Cloud Function.

Receives a model's reference image URL, extracts a 768-dim embedding using
the same ViT model (tonyassi/celebrity-classifier) that produced the celebrity
database, compares via cosine similarity, writes audit record to Firestore.

Triggered via HTTP from the main gstar-ai-studio app.
"""
import os
import json
import time
import tempfile
import hashlib
import numpy as np
import requests as http_requests
import functions_framework
from google.cloud import firestore, storage
from datetime import datetime, timezone

# ── Config ──
GCP_PROJECT = os.environ.get("GCP_PROJECT", "gstar-ai-studio")
GCS_BUCKET = os.environ.get("GCS_BUCKET", "gstar-ai-studio-assets")
CELEB_DB_GCS_PATH = os.environ.get("CELEB_DB_GCS_PATH", "celebrity-check/celeb_embeddings.pkl")
REVIEW_THRESHOLD = float(os.environ.get("CELEB_REVIEW_THRESHOLD", "0.40"))
BLOCK_THRESHOLD = float(os.environ.get("CELEB_BLOCK_THRESHOLD", "0.55"))
HF_MODEL_NAME = "tonyassi/celebrity-classifier"
MODEL_VERSION = "celebrity-classifier-vit-768d"

# ── Lazy-loaded globals (cached across warm invocations) ──
_celeb_db = None
_celeb_db_hash = None
_model = None
_processor = None


def _load_celeb_db():
    """Load celebrity embeddings from GCS. Cached in /tmp for warm starts."""
    global _celeb_db, _celeb_db_hash
    import pickle

    local_path = f"/tmp/celeb_embeddings.pkl"

    if _celeb_db is not None:
        return _celeb_db, _celeb_db_hash

    if os.path.exists(local_path):
        print("[CelebCheck] Loading embeddings from /tmp cache")
        with open(local_path, "rb") as f:
            data = f.read()
        _celeb_db = pickle.loads(data)
        _celeb_db_hash = hashlib.md5(data).hexdigest()[:12]
        print(f"[CelebCheck] Loaded {len(_celeb_db['names'])} celebrities (hash: {_celeb_db_hash})")
        return _celeb_db, _celeb_db_hash

    print(f"[CelebCheck] Downloading embeddings from gs://{GCS_BUCKET}/{CELEB_DB_GCS_PATH}")
    client = storage.Client(project=GCP_PROJECT)
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(CELEB_DB_GCS_PATH)
    data = blob.download_as_bytes()

    with open(local_path, "wb") as f:
        f.write(data)

    _celeb_db = pickle.loads(data)
    _celeb_db_hash = hashlib.md5(data).hexdigest()[:12]
    print(f"[CelebCheck] Loaded {len(_celeb_db['names'])} celebrities (hash: {_celeb_db_hash})")
    return _celeb_db, _celeb_db_hash


def _load_model():
    """Load the celebrity-classifier ViT model. Cached across warm invocations."""
    global _model, _processor
    if _model is not None:
        return _model, _processor

    import torch
    from transformers import ViTImageProcessor, ViTModel

    print(f"[CelebCheck] Loading model {HF_MODEL_NAME}...")
    cache_dir = "/tmp/hf_cache"
    _processor = ViTImageProcessor.from_pretrained(HF_MODEL_NAME, cache_dir=cache_dir)
    _model = ViTModel.from_pretrained(HF_MODEL_NAME, cache_dir=cache_dir)
    _model.eval()
    print("[CelebCheck] Model loaded")
    return _model, _processor


def _download_image(image_url: str) -> str:
    """Download image from URL to a temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    try:
        if "storage.googleapis.com" in image_url or image_url.startswith("gs://"):
            client = storage.Client(project=GCP_PROJECT)
            bucket = client.bucket(GCS_BUCKET)
            if "storage.googleapis.com" in image_url:
                path = image_url.split(f"{GCS_BUCKET}/", 1)[-1].split("?")[0]
            else:
                path = image_url.replace(f"gs://{GCS_BUCKET}/", "")
            blob = bucket.blob(path)
            blob.download_to_filename(tmp.name)
        else:
            resp = http_requests.get(image_url, timeout=30)
            resp.raise_for_status()
            tmp.write(resp.content)
            tmp.close()
        return tmp.name
    except Exception as e:
        os.unlink(tmp.name)
        raise RuntimeError(f"Failed to download image: {e}")


def _extract_embedding(image_path: str) -> np.ndarray:
    """Extract 768-dim embedding from image using celebrity-classifier ViT."""
    import torch
    from PIL import Image

    model, processor = _load_model()

    img = Image.open(image_path).convert("RGB")
    inputs = processor(images=img, return_tensors="pt")

    with torch.no_grad():
        outputs = model(**inputs)
        # CLS token embedding from the last hidden state (768-dim)
        embedding = outputs.last_hidden_state[:, 0, :].squeeze().numpy()

    # L2 normalize
    embedding = embedding / (np.linalg.norm(embedding) + 1e-10)
    return embedding.astype(np.float32)


def _compare_against_celebrities(embedding: np.ndarray, celeb_db: dict) -> tuple:
    """Compare embedding against all celebrity embeddings using cosine similarity."""
    celeb_embeddings = np.array(celeb_db["embeddings"], dtype=np.float32)
    celeb_names = celeb_db["names"]

    embedding_norm = embedding / (np.linalg.norm(embedding) + 1e-10)
    celeb_norms = celeb_embeddings / (np.linalg.norm(celeb_embeddings, axis=1, keepdims=True) + 1e-10)

    similarities = celeb_norms @ embedding_norm

    top_idx = int(np.argmax(similarities))
    top_score = float(similarities[top_idx])
    top_name = celeb_names[top_idx]

    review_mask = similarities >= REVIEW_THRESHOLD
    flagged = [
        {"name": celeb_names[i], "score": round(float(similarities[i]), 4)}
        for i in np.where(review_mask)[0]
    ]
    flagged.sort(key=lambda x: x["score"], reverse=True)

    return top_name, top_score, flagged[:10]


def _write_audit_to_firestore(model_id: str, audit: dict):
    """Write celebrity check audit record to the model document."""
    db = firestore.Client(project=GCP_PROJECT)
    doc_ref = db.collection("models").document(model_id)
    doc_ref.update({"celebrityCheck": audit, "updatedAt": datetime.now(timezone.utc)})
    print(f"[CelebCheck] Audit written to models/{model_id}: status={audit['status']}")


@functions_framework.http
def celebrity_check(request):
    """HTTP Cloud Function entry point.

    Request JSON: { "modelId": "A1", "imageUrl": "https://..." }
    Response JSON: { "status": "pass"|"review"|"blocked", ... }
    """
    if request.method == "OPTIONS":
        return ("", 204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
        })

    headers = {"Access-Control-Allow-Origin": "*"}
    model_id = None

    try:
        body = request.get_json(silent=True) or {}
        model_id = body.get("modelId")
        image_url = body.get("imageUrl")

        if not model_id or not image_url:
            return (json.dumps({"error": "Missing modelId or imageUrl"}), 400, headers)

        print(f"[CelebCheck] Starting check for model {model_id}")
        start_time = time.time()

        celeb_db, db_hash = _load_celeb_db()
        image_path = _download_image(image_url)

        try:
            embedding = _extract_embedding(image_path)
            top_name, top_score, flagged = _compare_against_celebrities(embedding, celeb_db)

            if top_score >= BLOCK_THRESHOLD:
                status = "blocked"
            elif top_score >= REVIEW_THRESHOLD:
                status = "review"
            else:
                status = "pass"

            duration_ms = int((time.time() - start_time) * 1000)
            print(f"[CelebCheck] {model_id}: {status} (top: {top_name} @ {top_score:.3f}, {duration_ms}ms)")

            audit = {
                "timestamp": datetime.now(timezone.utc),
                "status": status,
                "facesDetected": 1,
                "topMatch": top_name if top_score >= REVIEW_THRESHOLD else None,
                "topScore": round(top_score, 4),
                "flaggedMatches": flagged,
                "modelVersion": MODEL_VERSION,
                "databaseVersion": db_hash,
                "thresholds": {"review": REVIEW_THRESHOLD, "block": BLOCK_THRESHOLD},
                "durationMs": duration_ms,
            }
            _write_audit_to_firestore(model_id, audit)

            return (json.dumps({
                "status": status,
                "topMatch": audit["topMatch"],
                "topScore": audit["topScore"],
                "facesDetected": 1,
                "flaggedMatches": flagged,
                "durationMs": duration_ms,
            }), 200, headers)

        finally:
            if os.path.exists(image_path):
                os.unlink(image_path)

    except Exception as e:
        print(f"[CelebCheck] ERROR: {e}")
        import traceback
        traceback.print_exc()

        try:
            error_audit = {
                "timestamp": datetime.now(timezone.utc),
                "status": "error",
                "error": str(e),
                "modelVersion": MODEL_VERSION,
                "databaseVersion": _celeb_db_hash or "unknown",
                "thresholds": {"review": REVIEW_THRESHOLD, "block": BLOCK_THRESHOLD},
            }
            if model_id:
                _write_audit_to_firestore(model_id, error_audit)
        except Exception:
            pass

        return (json.dumps({"error": str(e)}), 500, headers)
