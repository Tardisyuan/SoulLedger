#!/usr/bin/env bash
# Inside the demo container (scripts/demo-remote.sh): real backend + normal frontend build → frontend/demo/data/*.json.
set -u
# shellcheck disable=SC1091
source /app/scripts/demo-backend-up.sh || exit 1
trap 'demo_pg "DROP DATABASE IF EXISTS sl_demo_record WITH (FORCE)"' EXIT

cd /app/backend || exit 1
"$PY" manage.py spectacular --format openapi-json --file /sl-tmp/schema.json >/dev/null 2>&1 || exit 1
export DEMO_SCHEMA=/sl-tmp/schema.json
"$PY" manage.py runserver 127.0.0.1:8000 --noreload >/sl-tmp/django.log 2>&1 &
for _ in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:8000/health/ && break; sleep 1; done

cd /app/frontend || exit 1
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 NEXT_PUBLIC_DEMO_MODE= npx next build >/sl-tmp/record-build.log 2>&1 \
  || { tail -30 /sl-tmp/record-build.log; exit 1; }
PORT=3333 npx next start >/sl-tmp/next.log 2>&1 &
for _ in $(seq 60); do curl -sf -o /dev/null http://localhost:3333/login && break; sleep 1; done

node /app/scripts/demo-record.mjs || { tail -5 /sl-tmp/django.log; exit 1; }
du -sh /app/frontend/demo/data/* | sed 's#/app/##'
