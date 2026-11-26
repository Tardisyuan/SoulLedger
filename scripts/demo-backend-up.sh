#!/usr/bin/env bash
# Inside the demo container: a fresh database, migrated and seeded, then Django on :8000 in the background.
# Sourced by scripts/demo-record-inner.sh. Its database lives on the gates' throwaway PostgreSQL and is dropped
# at the end of a recording.
export SECRET_KEY=demo-recording-key-not-for-production-32-bytes DEBUG=true
export DATABASE_URL="$SL_DEMO_DB_URL" REDIS_URL=redis://127.0.0.1:6399/0
export CELERY_BROKER_URL=redis://127.0.0.1:6399/1 CELERY_RESULT_BACKEND=redis://127.0.0.1:6399/2
# Recording only: an ADMIN without two-step verification would otherwise be refused everything (scripts/demo_settings.py).
export DJANGO_SETTINGS_MODULE=demo_settings PYTHONPATH=/app/scripts
export DEMO_LIVES=/sl-tmp/demo-lives.json
# The soul accounts the recorder signs in as, one per underworld (demo-seed.py `seed_soul_logins`).
export DEMO_SOUL_LOGINS=/sl-tmp/demo-soul-logins.json
export ALLOWED_HOSTS=localhost,127.0.0.1 CORS_ALLOWED_ORIGINS=http://localhost:3333
PY=/app/backend/.venv/bin/python

# The venv is copied once from an E2E tree (demo-remote.sh) and then kept: a package the lock gained later was missing
# (sqlglot, 2026-11-27: the recording died on import). Bring it to the lock whenever the lock differs from the last sync.
LOCK_STAMP=/app/backend/.venv/.synced-lock
if ! cmp -s /app/backend/requirements.lock "$LOCK_STAMP"; then
    /app/backend/.venv/bin/pip install -q --no-deps -r /app/backend/requirements.lock >/sl-tmp/pip.log 2>&1 \
        || { tail -20 /sl-tmp/pip.log; exit 1; }
    cp /app/backend/requirements.lock "$LOCK_STAMP"
fi

demo_pg() { # demo_pg "<sql>" — against the server's postgres database
    "$PY" - "$1" <<'PYEOF'
import os, sys, psycopg2
k = psycopg2.connect(os.environ["SL_PG_BASE"] + "/postgres")
k.autocommit = True
k.cursor().execute(sys.argv[1])
PYEOF
}

redis-server --port 6399 --daemonize yes --save '' --appendonly no >/dev/null
demo_pg 'DROP DATABASE IF EXISTS sl_demo_record WITH (FORCE)' || exit 1
demo_pg 'CREATE DATABASE sl_demo_record' || exit 1
cd /app/backend || exit 1
"$PY" manage.py migrate --noinput >/sl-tmp/migrate.log 2>&1 || { tail -30 /sl-tmp/migrate.log; exit 1; }
for c in seed_tenants "seed_mythology --civilization all" sync_permissions seed_field_permissions init_organizations seed_workflow_templates; do
    # shellcheck disable=SC2086
    "$PY" manage.py $c >/sl-tmp/seed-step.log 2>&1 || { echo "demo: $c failed"; tail -20 /sl-tmp/seed-step.log; exit 1; }
done
"$PY" /app/scripts/demo-seed.py || exit 1
