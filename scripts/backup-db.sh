#!/bin/bash
# SoulLedger Database Backup Script (PostgreSQL)
#
# Usage:
#   ./scripts/backup-db.sh                    # Backup to ./backups/
#   ./scripts/backup-db.sh /path/to/backups   # Backup to specified directory
#
# Cron example (daily at 2am):
#   0 2 * * * cd /path/to/SoulLedger && ./scripts/backup-db.sh

set -euo pipefail

# Configuration (override via environment variables)
BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-soulledger}"
DB_USER="${DB_USER:-soulledger}"
DB_PASSWORD="${DB_PASSWORD:-devpassword}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

BACKUP_FILE="${BACKUP_DIR}/soulledger_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Load .env if present
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

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

# Clean up old backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "soulledger_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

echo "Done."
