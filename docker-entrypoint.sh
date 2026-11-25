#!/bin/sh
set -e
if [ -z "$ENCRYPTION_KEY" ]; then
  echo "ERROR: ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32" >&2
  exit 1
fi
mkdir -p "$DATA_DIR"
echo "Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy
echo "Starting server on port $PORT"
exec node node_modules/next/dist/bin/next start -p "$PORT" -H "$HOSTNAME"
