FROM node:20-slim AS base

# v2 Pro pipeline — no Python/OpenCV needed (label composite removed)

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

EXPOSE 8080
CMD ["node", "server.js"]
