#!/bin/sh
set -e

# nginx serves the public HTTP port; NestJS always uses the internal 3001 port.
export NGINX_PORT=${NGINX_PORT:-8080}
envsubst '${NGINX_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

if [ -n "$DATABASE_URL" ]; then
  echo "[docker] PostgreSQL configured via DATABASE_URL"
else
  echo "[docker] PostgreSQL configured via POSTGRES_* variables"
fi

# Use the MCP server bundled in the Docker image unless explicitly overridden.
export MOVIDESK_MCP_COMMAND=${MOVIDESK_MCP_COMMAND:-node}
export MOVIDESK_MCP_ARGS=${MOVIDESK_MCP_ARGS:-'["/app/mcp-movidesk/dist/index.js"]'}
export MOVIDESK_MCP_CWD=${MOVIDESK_MCP_CWD:-/app/mcp-movidesk}

# Start NestJS on a fixed internal port (never conflicts with nginx)
echo "[docker] Starting NestJS backend on port 3001..."
touch /tmp/nestjs.log
tail -n +1 -f /tmp/nestjs.log &
TAIL_PID=$!
PORT=3001 node /app/backend/dist/main.js 2>&1 | tee -a /tmp/nestjs.log &
NESTJS_PID=$!

cleanup() {
  kill "$TAIL_PID" 2>/dev/null || true
}

trap cleanup EXIT

# Wait for backend to be ready (max 45s), checking if process is still alive
echo "[docker] Waiting for backend to be ready..."
READY=0
for i in $(seq 1 45); do
  # Check if process died
  if ! kill -0 "$NESTJS_PID" 2>/dev/null; then
    echo "[docker] ERROR: NestJS process died. Logs:"
    cat /tmp/nestjs.log
    exit 1
  fi

  if wget -qO- http://127.0.0.1:3001/app-version >/dev/null 2>&1; then
    echo "[docker] Backend ready after ${i}s."
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" = "0" ]; then
  echo "[docker] WARNING: Backend did not respond in 45s. NestJS logs:"
  cat /tmp/nestjs.log
fi

# Start nginx in foreground (keeps container alive)
echo "[docker] Starting nginx on port ${NGINX_PORT}..."
exec nginx -g "daemon off;"
