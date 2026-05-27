#!/bin/bash
# SoulLedger Database Backup Script
# Usage: ./scripts/backup-db.sh [backup_dir]

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/soulledger_${TIMESTAMP}.sql.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-soulledger}"
DB_USER="${DB_USER:-soulledger}"
DB_PASSWORD="${DB_PASSWORD:-devpassword}"

echo "Backing up SoulLedger database..."
echo "  Host: ${DB_HOST}:${DB_PORT}"
echo "  Database: ${DB_NAME}"
echo "  Output: ${BACKUP_FILE}"

# Dump and compress
PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-privileges \
    | gzip > "$BACKUP_FILE"

# Verify backup
if [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "Backup complete: ${BACKUP_FILE} (${SIZE})"
else
    echo "ERROR: Backup file is empty!" >&2
    exit 1
fi

# Clean up old backups (keep last 30)
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/soulledger_*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 30 ]; then
    echo "Cleaning old backups (keeping last 30)..."
    ls -1t "${BACKUP_DIR}"/soulledger_*.sql.gz | tail -n +31 | xargs rm -f
fi

echo "Done."
