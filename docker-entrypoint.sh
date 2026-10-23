#!/bin/sh
set -e

echo "==> Running database migrations..."
npx prisma migrate deploy

echo "==> Syncing questions and teams..."
npm run seed

echo "==> Starting Discord Cipher Hunt Bot..."
if [ "$#" -eq 0 ]; then
  exec npm start
else
  exec "$@"
fi
