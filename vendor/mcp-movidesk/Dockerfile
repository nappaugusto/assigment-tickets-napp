# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
COPY testes/ ./testes/

RUN npm run build

# ---- Stage 2: Production ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

# Porta padrão do servidor HTTP
ENV MCP_PORT=3000
EXPOSE 3000

# Usar o entrypoint HTTP (Streamable HTTP / SSE)
ENTRYPOINT ["node", "dist/httpServer.js"]
