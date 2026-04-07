# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production=false

# Copy source
COPY tsconfig.json ./
COPY backend/ ./backend/
COPY utils/ ./utils/
COPY policies/ ./policies/

# Compile TypeScript
RUN npm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="CrocAgentic"
LABEL org.opencontainers.image.description="Secure, modular, lightweight AI agent core — Phase 1"
LABEL org.opencontainers.image.version="0.1.0"

# Create non-root user
RUN addgroup -S crocagentic && adduser -S crocagentic -G crocagentic

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy policy files
COPY --from=builder /app/policies ./policies

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R crocagentic:crocagentic /app/data

# Switch to non-root user
USER crocagentic

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Entry point
CMD ["node", "dist/backend/server.js"]
