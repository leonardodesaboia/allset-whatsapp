#!/bin/sh
set -e

echo "Applying database migrations..."
node /app/node_modules/prisma/build/index.js migrate deploy

echo "Starting application..."
exec node server.js
