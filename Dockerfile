FROM node:20-slim AS base

# Hybrid leather-label pipeline needs Python3 + cv2 + numpy in the final runner
# stage. See src/lib/label-hybrid.ts → scripts/label_hybrid.py.
#
# Subject-matte pipeline (src/lib/subject-matte.ts) runs OUTSIDE this image —
# it triggers a separate Cloud Run Job (subject-matte-job) over GCS handoff.
# That keeps rembg + onnxruntime out of this image (saves ~300MB) and avoids
# the silent CPU-throttling-during-await hangs documented in LEARNINGS #77/#78.
# The Job's source lives in cloud-run-job-matte/.

# Install dependencies only
FROM base AS deps
WORKDIR /app
# libvips42 is sharp's native dep. Installed here so sharp's postinstall
# can link its prebuilt binary against the system libvips.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libvips42 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Build
FROM base AS builder
WORKDIR /app
# libvips42 again — next build's "Collecting page data" phase dlopens sharp
# while executing route handlers, so the builder stage needs it too.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libvips42 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Python + OpenCV + rembg runtime
#  - scripts/label_hybrid.py needs cv2 + numpy
#  - scripts/subject_matte.py needs rembg (U²-Net + ONNX) + Pillow + numpy
# libgl1 + libglib2.0-0 are the shared libs opencv-python-headless loads at import.
# libvips42 is sharp's native dep (used by foot-resize, dressed-base-pipeline, image-prep).
# rembg pulls onnxruntime; numba<0.60 + coverage==7.4.4 pins are mandatory — newer
# coverage breaks the numba/coverage_support module that rembg's onnx pipeline imports.
# First call to subject_matte.py downloads U²-Net (~170MB) into ~/.u2net at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        libgl1 \
        libglib2.0-0 \
        libvips42 \
    && pip3 install --no-cache-dir --break-system-packages \
        opencv-python-headless==4.10.0.84 \
        numpy==1.26.4 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy Next.js runtime
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Python scripts — consumed by src/lib/label-hybrid.ts and src/lib/subject-matte.ts
# via child_process.execFile. .gcloudignore + .dockerignore must NOT exclude scripts/.
COPY --from=builder /app/scripts ./scripts

EXPOSE 8080
CMD ["node", "server.js"]
