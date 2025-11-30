#!/bin/sh
set -e

echo "Running database migrations..."
cd apps/api
npx prisma migrate deploy
cd ../..

echo "Starting application..."
exec node apps/api/dist/main.js
