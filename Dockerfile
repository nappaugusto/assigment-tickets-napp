# ─────────────────────────────────────────────
# Stage 1: Build frontend (Vite)
# ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

RUN npm install -g pnpm

WORKDIR /build/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm run build

# ─────────────────────────────────────────────
# Stage 2: Build backend (NestJS)
# ─────────────────────────────────────────────
FROM node:20-alpine AS backend-builder

RUN npm install -g pnpm

WORKDIR /build/backend
COPY backend/package.json backend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY backend/ ./
RUN pnpm run build

# ─────────────────────────────────────────────
# Stage 3: Production image
# ─────────────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache nginx gettext

# ── Backend runtime ──────────────────────────
WORKDIR /app/backend
RUN mkdir -p /app/backend/data
RUN mkdir -p /data

# Only install production dependencies
COPY backend/package.json backend/pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod

COPY --from=backend-builder /build/backend/dist ./dist

# ── Frontend static files ────────────────────
COPY --from=frontend-builder /build/frontend/dist /usr/share/nginx/html

# ── nginx config ─────────────────────────────
COPY nginx.conf /etc/nginx/nginx.conf.template

# ── Startup script ───────────────────────────
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

ENV PERSISTENT_DATA_DIR=/data
ENV DATABASE_PATH=/data/tickets.db

EXPOSE 8080

CMD ["/app/docker-start.sh"]
