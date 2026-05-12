# Cloud Run Job — Phase 2 worker (Bruno 2026-05-11).
# Builds from the gstar-studio repo root; reuses src/lib/worker/loop.ts via tsx
# so the in-proc worker and the Job run identical code. No Next.js framework
# needed in this image — pure Node + Firestore client.
#
# Build context: gstar-studio repo root (so the Dockerfile can COPY src/ etc).
# Build via:
#   gcloud builds submit --tag gcr.io/gstar-ai-studio/gstar-worker-job:latest \
#     --gcs-source-staging-dir gs://gstar-ai-studio-cloudbuild-staging \
#     --config cloud-run-job-worker/cloudbuild.yaml .
# Or simpler:
#   gcloud run jobs deploy gstar-worker-job --source . \
#     --region europe-west1 --project gstar-ai-studio \
#     --no-traffic --cpu=2 --memory=2Gi
# (works when this Dockerfile is at the path noted by --source, which means
# we need a top-level wrapper Dockerfile during deploy OR use Cloud Build
# explicitly. See README.md.)

FROM node:22-slim

WORKDIR /app

# Bring in package files first for layer caching
COPY package.json package-lock.json* ./
# Install only runtime deps — no Next.js needed here, but the worker pulls
# from @/lib/firestore + @/lib/config which themselves use @google-cloud/firestore
# + sharp etc. Install full set; tsx will resolve at runtime.
RUN npm install --production=false

# Copy source. The worker entrypoint runs via tsx; the path alias `@/lib/*`
# resolves to /app/src/lib/* via tsconfig.json (copied below).
COPY tsconfig.json ./
COPY src ./src
COPY cloud-run-job-worker/main.ts ./cloud-run-job-worker/main.ts

# Default env — INTERNAL_BASE_URL MUST be overridden at deploy time to the
# public service URL. WORKER_STALE_INFLIGHT_WATCHDOG defaults to ON.
ENV NODE_ENV=production

# Use tsx directly. Worker exits 0 when queue is idle.
CMD ["npx", "tsx", "cloud-run-job-worker/main.ts"]
