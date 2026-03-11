# IA Friendly - Dockerfile optimisé multi-stage
# Build: from repo root with docker build -f webapp/Dockerfile .
# Run:   docker run -p 3000:3000 ia-friendly:latest

FROM node:20-alpine AS base

# Étape 1: installer les dépendances (cache séparé)
FROM base AS deps
WORKDIR /app
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci
RUN mkdir -p prisma
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate

# Étape 2: build Next.js (standalone)
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY webapp/ .
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Étape 3: image de production minimale
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy Prisma engine for runtime
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]