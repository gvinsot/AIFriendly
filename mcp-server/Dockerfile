# AI Friendly — MCP Server Container
# Streamable HTTP MCP server with API key authentication

FROM node:20-alpine AS base

WORKDIR /app

# Copy MCP server package.json and install deps
COPY mcp-server/package.json mcp-server/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy Prisma schema and generate client
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate --schema=./prisma/schema.prisma

# Copy shared lib files (analyzers)
COPY lib/analyzer.ts ./lib/analyzer.ts
COPY lib/availability-checker.ts ./lib/availability-checker.ts
COPY lib/security-scanner.ts ./lib/security-scanner.ts

# Copy MCP server source
COPY mcp-server/index.ts ./index.ts
COPY mcp-server/tsconfig.json ./tsconfig.json

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcpserver
USER mcpserver

ENV NODE_ENV=production
ENV MCP_PORT=3001

EXPOSE 3001

CMD ["node", "--import", "tsx", "index.ts"]
