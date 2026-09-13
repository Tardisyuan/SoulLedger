#!/bin/sh
# SoulLedger Database Backup Script (PostgreSQL)
#
# Usage:
#   ./scripts/backup-db.sh                    # Backup to ./backups/
#   ./scripts/backup-db.sh /path/to/backups   # Backup to specified directory
#
# Connection: the standard libpq variables (PGHOST, PGPORT, PGDATABASE,
# PGUSER, PGPASSWORD) — what the production compose `backup` service passes.
# DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD still work as a fallback for a
# manual run with the root .env. This used to read ONLY the DB_* names and
# default to localhost + a dev password, so inside the backup container it
# dumped from localhost, failed, and left a 20-byte `.sql.gz` behind that
# looked like a backup (IS-15, measured 2026-09-14).
#
# Exits non-zero on any failure, and a failed dump leaves no file matching
# soulledger_*.sql.gz: the compose healthcheck counts those files.

set -eu

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Load .env if present (manual runs from the repo root)
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

export PGHOST="${PGHOST:-${DB_HOST:-localhost}}"
export PGPORT="${PGPORT:-${DB_PORT:-5432}}"
export PGDATABASE="${PGDATABASE:-${DB_NAME:-soulledger}}"
export PGUSER="${PGUSER:-${DB_USER:-soulledger}}"
if [ -z "${PGPASSWORD:-}" ] && [ -n "${DB_PASSWORD:-}" ]; then
    export PGPASSWORD="$DB_PASSWORD"
fi

BACKUP_FILE="${BACKUP_DIR}/soulledger_${TIMESTAMP}.sql.gz"
PARTIAL="${BACKUP_FILE}.partial"

mkdir -p "$BACKUP_DIR"

echo "Backing up SoulLedger database..."
echo "  Host: ${PGHOST}:${PGPORT}"
echo "  Database: ${PGDATABASE}"
echo "  Output: ${BACKUP_FILE}"

# `-Z` gzips plain-format output itself: no `pg_dump | gzip` pipe, whose exit
# status would be gzip's in a shell without pipefail. restore-db.sh reads it
# with `gunzip -c`, as before.
if ! pg_dump --no-owner --no-privileges -Z 6 -f "$PARTIAL"; then
    rm -f "$PARTIAL"
    echo "ERROR: pg_dump failed; no backup written" >&2
    exit 1
fi
if ! gzip -t "$PARTIAL" || [ ! -s "$PARTIAL" ]; then
    rm -f "$PARTIAL"
    echo "ERROR: backup file is empty or corrupt" >&2
    exit 1
fi
mv "$PARTIAL" "$BACKUP_FILE"
echo "Backup complete: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

# Clean up old backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "soulledger_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Done."
