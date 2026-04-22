FROM node:20-slim AS base

# Hybrid leather-label pipeline — needs Python3 + OpenCV (cv2) + numpy
# in the final runner stage. See src/lib/label-hybrid.ts and scripts/label_hybrid.py.

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

# Python + OpenCV runtime for scripts/label_hybrid.py
# libgl1 and libglib2.0-0 are the two shared libs opencv-python-headless loads at import
# libvips42 is needed at runtime because sharp is used in the pipeline (foot-resize,
# dressed-base-pipeline, image-prep, skin-tone, pocket-detector, wardrobe/image-action)
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

# Copy Python scripts — consumed by src/lib/label-hybrid.ts via child_process.execFile
COPY --from=builder /app/scripts ./scripts

EXPOSE 8080
CMD ["node", "server.js"]
