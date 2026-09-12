#!/bin/bash
# Bring a stack up with the right compose pair. `docker compose` (v2), not the
# v1 `docker-compose` binary this used to call — v1 happened to exist on one
# machine, which is the only reason it ever worked.
set -euo pipefail

ENV=${1:-development}
cd "$(dirname "$0")/.."

case $ENV in
  development) FILES=() ;;
  staging)     FILES=(-f docker-compose.yml -f docker-compose.staging.yml) ;;
  production)  FILES=(-f docker-compose.yml -f docker-compose.production.yml) ;;
  *)
    echo "Usage: $0 {development|staging|production}" >&2
    exit 1
    ;;
esac

SOURCE=".env.$ENV"
if [ ! -f "$SOURCE" ]; then
  echo "$SOURCE does not exist — copy .env.example to it first." >&2
  exit 1
fi

# `cp .env.production .env` used to run unconditionally, so a hand-edited
# root .env was overwritten without a word. Keep a copy and say so.
if [ -f .env ] && ! cmp -s .env "$SOURCE"; then
  BACKUP=".env.bak.$(date +%Y%m%d%H%M%S)"
  cp .env "$BACKUP"
  echo "Existing .env differs from $SOURCE — kept a copy at $BACKUP"
fi
cp "$SOURCE" .env

echo "Deploying SoulLedger ($ENV)..."
docker compose "${FILES[@]}" up -d
echo "Deployment complete ($ENV)"
