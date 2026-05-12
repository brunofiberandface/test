#!/usr/bin/env bash
# Deploy the subject-matte-job Cloud Run Job with the resource settings that
# match LEARNING #80 (May 6, 2026) and prevent the OOM regression that hit
# May 11, 2026 (matte returned null → M03/M04 fell back to raw Seedream output
# → users saw the brand-grey backdrop disappear).
#
# IMPORTANT — these flags are LOAD-BEARING. Do NOT remove without running a
# 4K matte end-to-end after redeploy to confirm it still completes.
#
#   --memory=8Gi  — rembg + onnxruntime + 3584×4800 buffers peak above 4Gi
#                    during alpha matting. 2Gi (gcloud default) and 4Gi both
#                    OOM. 8Gi is the validated working size from LEARNING #80.
#   --cpu=4       — rembg/onnxruntime is CPU-bound; 4 cores keeps the matte
#                    + procedural shadow under ~30s per shot.
#   --task-timeout=600  — 10 min hard ceiling. Typical run is 25-150s, but
#                          allow headroom for backdrop variants + grounding
#                          shadow if those ever get added back to this job.
#   --max-retries=1     — fail fast (we'd rather see the failure in logs +
#                          let the main service fall back to raw output than
#                          retry-pile-up that masks systemic issues).
#
# Run from this directory:
#   ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

/Users/bdheedene/google-cloud-sdk/bin/gcloud run jobs deploy subject-matte-job \
  --source . \
  --region=europe-west1 \
  --project=gstar-ai-studio \
  --memory=8Gi \
  --cpu=4 \
  --task-timeout=600 \
  --max-retries=1
