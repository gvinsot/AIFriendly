# AI Friendly — Worker Container
# Runs scheduled site analyses and 60-day cleanup

FROM node:20-alpine AS base

WORKDIR /app

# Copy worker package.json and install deps
COPY worker/package.json worker/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy Prisma schema and generate client
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate --schema=./prisma/schema.prisma

# Copy worker source
COPY worker/index.ts ./index.ts
COPY worker/tsconfig.json ./tsconfig.json

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker
USER worker

ENV NODE_ENV=production

CMD ["node", "--import", "tsx", "index.ts"]
