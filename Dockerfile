FROM node:20-slim AS base

# v40-build-7 cache bust
RUN echo "v40-build-7"

# Install Python 3 + OpenCV headless for label composite pipeline
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages \
       numpy opencv-python-headless scikit-image rembg[cpu] \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install dependencies only
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Python script directly from build context (not from builder stage)
# This avoids .dockerignore issues with *.py exclusion
COPY scripts/label_composite.py ./scripts/label_composite.py
COPY scripts/color_match.py ./scripts/color_match.py
COPY scripts/remove_bg.py ./scripts/remove_bg.py

EXPOSE 8080
CMD ["node", "server.js"]
