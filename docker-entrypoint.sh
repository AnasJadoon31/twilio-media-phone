#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required."
  exit 1
fi

attempt=1
max_attempts="${PRISMA_DB_PUSH_MAX_ATTEMPTS:-20}"

until pnpm exec prisma db push --accept-data-loss; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Prisma schema sync failed after ${attempt} attempts."
    exit 1
  fi

  echo "Prisma schema sync failed. Retrying in 3s (${attempt}/${max_attempts})..."
  attempt=$((attempt + 1))
  sleep 3
done

exec node server.js
