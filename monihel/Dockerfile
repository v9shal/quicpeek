FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source + prisma schema
COPY tsconfig.json prisma.config.ts ./
COPY prisma/ prisma/
COPY api/ api/
COPY workers/ workers/

# Generate Prisma client + compile TypeScript
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npx tsc

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Non-root user
RUN addgroup -S monihel && adduser -S monihel -G monihel

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output + prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma/ prisma/
COPY prisma.config.ts ./

USER monihel

# Default: API server. Override via docker-compose command: for workers.
CMD ["node", "dist/api/src/index.js"]
