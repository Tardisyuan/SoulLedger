#!/bin/bash
# SoulLedger Database Restore Script
# Usage: bash scripts/restore-db.sh <backup_file>
#
# Connection: libpq variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD),
# with DB_HOST/DB_PORT/DB_NAME/DB_USER as a fallback — the same names
# backup-db.sh reads.
#
# All or nothing, and says so. This had `set -e` without pipefail and psql
# without ON_ERROR_STOP, so a failing statement or a truncated .gz still ended
# in "Restore complete." with exit 0 (IS-20, measured 2026-09-14 in a
# throwaway postgres:16-alpine: a dump with a bad statement and a dump cut in
# half both printed it; the second had restored no table at all).
# --single-transaction rolls a failed restore back instead of leaving half.
set -euo pipefail

BACKUP_FILE="${1:-}"
export PGHOST="${PGHOST:-${DB_HOST:-localhost}}"
export PGPORT="${PGPORT:-${DB_PORT:-5432}}"
export PGDATABASE="${PGDATABASE:-${DB_NAME:-soulledger}}"
export PGUSER="${PGUSER:-${DB_USER:-soulledger}}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup_file>"
    echo "Available backups:"
    ls -lh backups/*.sql.gz 2>/dev/null || echo "No backups found in backups/"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE" >&2
    exit 1
fi

# A truncated or corrupt archive is refused before anything touches the database.
if ! gzip -t "$BACKUP_FILE"; then
    echo "Error: $BACKUP_FILE is not a valid gzip archive; nothing restored" >&2
    exit 1
fi

echo "WARNING: This will overwrite the database '$PGDATABASE' on $PGHOST:$PGPORT"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo "Restoring from $BACKUP_FILE..."
if ! gunzip -c "$BACKUP_FILE" | psql -v ON_ERROR_STOP=1 --single-transaction -q; then
    echo "Error: restore FAILED and was rolled back; '$PGDATABASE' is unchanged" >&2
    exit 1
fi

echo "Restore complete."
