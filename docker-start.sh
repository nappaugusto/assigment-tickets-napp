#!/bin/sh
set -e

# Railway injects $PORT — nginx must listen on it
export NGINX_PORT=${PORT:-80}
envsubst '${NGINX_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start NestJS on a fixed internal port (never conflicts with nginx)
echo "[docker] Starting NestJS backend on port 3001..."
PORT=3001 node /app/backend/dist/main.js &

# Wait for backend to be ready (max 15s)
echo "[docker] Waiting for backend to be ready..."
for i in $(seq 1 15); do
  if wget -qO- http://127.0.0.1:3001/app-version >/dev/null 2>&1; then
    echo "[docker] Backend ready."
    break
  fi
  sleep 1
done

# Start nginx in foreground (keeps container alive)
echo "[docker] Starting nginx..."
exec nginx -g "daemon off;"
