#!/bin/sh
set -e

# Railway injects $PORT — nginx must listen on it
export NGINX_PORT=${PORT:-80}
envsubst '${NGINX_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Prefer a mounted persistent Railway volume when available
export PERSISTENT_DATA_DIR=${PERSISTENT_DATA_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-/data}}
if [ -d "$PERSISTENT_DATA_DIR" ] || mkdir -p "$PERSISTENT_DATA_DIR" 2>/dev/null; then
  export DATABASE_PATH=${DATABASE_PATH:-$PERSISTENT_DATA_DIR/tickets.db}
else
  export DATABASE_PATH=${DATABASE_PATH:-/app/backend/data/tickets.db}
fi

# Ensure persistent data directory exists before NestJS starts
mkdir -p "$(dirname "$DATABASE_PATH")"
echo "[docker] Database path resolved to $DATABASE_PATH"
if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then
  echo "[docker] Railway volume mounted at $RAILWAY_VOLUME_MOUNT_PATH"
fi

# Start NestJS on a fixed internal port (never conflicts with nginx)
echo "[docker] Starting NestJS backend on port 3001..."
PORT=3001 node /app/backend/dist/main.js > /tmp/nestjs.log 2>&1 &
NESTJS_PID=$!

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
