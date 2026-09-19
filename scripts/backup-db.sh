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
#
# MEDIA_DIR (optional): if set, also tars that directory to
# soulledger_media_<timestamp>.tar.gz alongside the db dump, same partial-
# then-rename and non-zero-exit-on-failure behavior. The production compose
# `backup` service mounts the media_files volume read-only at /media and sets
# MEDIA_DIR=/media, since uploaded avatars are user data the db dump doesn't
# cover.

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

if [ -n "${MEDIA_DIR:-}" ]; then
    MEDIA_FILE="${BACKUP_DIR}/soulledger_media_${TIMESTAMP}.tar.gz"
    MEDIA_PARTIAL="${MEDIA_FILE}.partial"

    echo "Backing up media (${MEDIA_DIR})..."
    if ! tar -czf "$MEDIA_PARTIAL" -C "$MEDIA_DIR" .; then
        rm -f "$MEDIA_PARTIAL"
        echo "ERROR: media backup failed; no media backup written" >&2
        exit 1
    fi
    if ! gzip -t "$MEDIA_PARTIAL" || [ ! -s "$MEDIA_PARTIAL" ]; then
        rm -f "$MEDIA_PARTIAL"
        echo "ERROR: media backup file is empty or corrupt" >&2
        exit 1
    fi
    mv "$MEDIA_PARTIAL" "$MEDIA_FILE"
    echo "Media backup complete: ${MEDIA_FILE} ($(du -h "$MEDIA_FILE" | cut -f1))"
fi

# 灵魂聊天(Synapse)。SYNAPSE_DATA_DIR 是只读挂进来的 synapse_data 卷。里面有
# homeserver.yaml 才算聊天已初始化(scripts/synapse-init.sh);没初始化就两样都跳过并
# 说一声 —— 聊天是可选的,不能因此让整个备份失败。初始化了就两样都必须成功:
#   soulledger_synapse_<ts>.dump       synapse 库,pg_dump 自定义格式(pg_restore 读)
#   soulledger_synapse_data_<ts>.tar.gz  卷:签名密钥(丢了等于换一台 homeserver)与聊天媒体
# 同样的 partial-再改名与失败非零退出。库名是 SYNAPSE_DATABASE(默认 synapse),连接沿用
# 上面的 PG*(soulledger 是超级用户,读得了 synapse 角色的库)。
if [ -n "${SYNAPSE_DATA_DIR:-}" ]; then
    if [ ! -f "${SYNAPSE_DATA_DIR}/homeserver.yaml" ]; then
        echo "Synapse not initialized (no ${SYNAPSE_DATA_DIR}/homeserver.yaml); skipping chat backup"
    else
        SYNAPSE_FILE="${BACKUP_DIR}/soulledger_synapse_${TIMESTAMP}.dump"
        echo "Backing up Synapse database (${SYNAPSE_DATABASE:-synapse})..."
        if ! pg_dump -Fc -d "${SYNAPSE_DATABASE:-synapse}" -f "${SYNAPSE_FILE}.partial" \
            || ! pg_restore --list "${SYNAPSE_FILE}.partial" >/dev/null; then
            rm -f "${SYNAPSE_FILE}.partial"
            echo "ERROR: Synapse database backup failed; no Synapse backup written" >&2
            exit 1
        fi
        mv "${SYNAPSE_FILE}.partial" "$SYNAPSE_FILE"
        echo "Synapse database backup complete: ${SYNAPSE_FILE} ($(du -h "$SYNAPSE_FILE" | cut -f1))"

        SYNAPSE_DATA_FILE="${BACKUP_DIR}/soulledger_synapse_data_${TIMESTAMP}.tar.gz"
        echo "Backing up Synapse data (${SYNAPSE_DATA_DIR})..."
        if ! tar -czf "${SYNAPSE_DATA_FILE}.partial" -C "$SYNAPSE_DATA_DIR" . \
            || ! gzip -t "${SYNAPSE_DATA_FILE}.partial"; then
            rm -f "${SYNAPSE_DATA_FILE}.partial"
            echo "ERROR: Synapse data backup failed; no Synapse data backup written" >&2
            exit 1
        fi
        mv "${SYNAPSE_DATA_FILE}.partial" "$SYNAPSE_DATA_FILE"
        echo "Synapse data backup complete: ${SYNAPSE_DATA_FILE} ($(du -h "$SYNAPSE_DATA_FILE" | cut -f1))"
    fi
fi

# Clean up old backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "soulledger_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "soulledger_media_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "soulledger_synapse_*.dump" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "soulledger_synapse_data_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Done."
