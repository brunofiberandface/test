"""
One-time setup: Download celebrity embeddings from HuggingFace,
convert to optimized format, upload to GCS.

Usage:
  pip install datasets deepface numpy google-cloud-storage
  python setup_embeddings.py

The HuggingFace dataset 'tonyassi/celebrity-1000-embeddings' contains
pre-computed face embeddings for 1000+ celebrities (18,184 images).
We average multiple embeddings per celebrity into a single representative
vector for faster comparison.
"""
import os
import pickle
import numpy as np
from collections import defaultdict
from google.cloud import storage

GCS_BUCKET = "gstar-ai-studio-assets"
GCS_PATH = "celebrity-check/celeb_embeddings.pkl"
GCP_PROJECT = "gstar-ai-studio"


def main():
    from datasets import load_dataset
    print("Loading HuggingFace dataset...")
    ds = load_dataset("tonyassi/celebrity-1000-embeddings", split="train")
    # Drop image column to avoid Pillow dependency and speed up iteration
    if "image" in ds.column_names:
        ds = ds.remove_columns(["image"])

    print(f"Dataset has {len(ds)} rows")

    # Get label-to-name mapping from ClassLabel feature
    label_names = ds.features["label"].names
    print(f"Label mapping has {len(label_names)} celebrity names")

    # Group embeddings by celebrity name and average them
    celeb_vectors = defaultdict(list)
    for row in ds:
        name = label_names[row["label"]]
        embedding = row["embeddings"]
        celeb_vectors[name].append(np.array(embedding, dtype=np.float32))

    print(f"Found {len(celeb_vectors)} unique celebrities")

    # Average embeddings per celebrity (more robust than single image)
    names = []
    embeddings = []
    for name, vectors in sorted(celeb_vectors.items()):
        avg = np.mean(vectors, axis=0)
        avg = avg / (np.linalg.norm(avg) + 1e-10)  # L2 normalize
        names.append(name)
        embeddings.append(avg)

    embeddings_array = np.stack(embeddings)  # (N, 512)
    print(f"Final database: {len(names)} celebrities, embedding shape: {embeddings_array.shape}")

    # Save locally
    db = {"names": names, "embeddings": embeddings_array}
    local_path = "celeb_embeddings.pkl"
    with open(local_path, "wb") as f:
        pickle.dump(db, f)
    print(f"Saved to {local_path} ({os.path.getsize(local_path) / 1024:.0f} KB)")

    # Upload to GCS
    print(f"Uploading to gs://{GCS_BUCKET}/{GCS_PATH}...")
    client = storage.Client(project=GCP_PROJECT)
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(GCS_PATH)
    blob.upload_from_filename(local_path)
    print("Done! Celebrity embeddings uploaded to GCS.")

    # Cleanup
    os.remove(local_path)


if __name__ == "__main__":
    main()
