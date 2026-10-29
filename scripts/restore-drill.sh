#!/bin/bash
# Restore drill: prove the newest db backup restores, then throw it away.
#
# Usage (in the production stack, docs/DEPLOYMENT.md「恢复演练」):
#   $DC run --rm --no-deps --entrypoint bash backup /scripts/restore-drill.sh /backups
#   bash scripts/restore-drill.sh <backup dir | soulledger_YYYYMMDD_HHMMSS.sql.gz>
#
# Steps, each fatal:
#   1. pick the newest soulledger_<timestamp>.sql.gz (a file argument is used as is)
#   2. createdb a scratch database soulledger_drill_<pid> on the same server
#   3. restore into it with restore-db.sh's flags (single transaction, ON_ERROR_STOP)
#   4. compare with the live database (PGDATABASE):
#      - every table the live db has exists in the drill db
#      - every django_migrations row the live db has is in the drill db — the
#        `migrate --check` question asked of the schema the code is running on.
#        A deploy that migrated after the backup fails this on purpose: that
#        backup restores an older schema and needs `migrate` afterwards.
#      - prints per-table row counts of both, for the RPO eyeball (docs)
#   5. dropdb the scratch database — on success and on failure (trap).
# Prints how long the restore took: the measured half of the RTO.
#
# Connection: libpq PG* variables (fallback DB_*), as backup-db.sh / restore-db.sh.
# The live database is only read. DRILL_KEEP=1 skips the drop (to run Django's own
# `migrate --check` against it by hand; drop it yourself afterwards).
# Failure calls ops_alert (OPS_ALERT_WEBHOOK_URL; prints when unset).
set -euo pipefail
export LC_ALL=C   # sort / comm / join below must agree on one collation

# shellcheck disable=SC1091
. "$(dirname "$0")/ops-alert.sh"

export PGHOST="${PGHOST:-${DB_HOST:-localhost}}"
export PGPORT="${PGPORT:-${DB_PORT:-5432}}"
export PGUSER="${PGUSER:-${DB_USER:-soulledger}}"
LIVE_DB="${PGDATABASE:-${DB_NAME:-soulledger}}"
DRILL_DB="soulledger_drill_$$"
TARGET="${1:-./backups}"
WORK=$(mktemp -d)
CREATED=""

finish() {
    rc=$?
    if [ -n "$CREATED" ] && [ "${DRILL_KEEP:-}" != 1 ]; then
        dropdb --if-exists "$DRILL_DB" || { echo "ERROR: could not drop $DRILL_DB; drop it by hand" >&2; rc=1; }
        echo "Dropped scratch database $DRILL_DB"
    elif [ -n "$CREATED" ]; then
        echo "DRILL_KEEP=1: scratch database $DRILL_DB kept; dropdb it when done"
    fi
    rm -rf "$WORK"
    if [ "$rc" -ne 0 ]; then
        ops_alert "restore-drill.sh FAILED (exit $rc) on ${BACKUP:-$TARGET}"
    fi
    exit "$rc"
}
trap finish EXIT

if [ -d "$TARGET" ]; then
    # soulledger_2*: the db dumps only (media / synapse files start with a letter).
    BACKUP=$(ls -1 "$TARGET"/soulledger_2*.sql.gz 2>/dev/null | sort | tail -n 1 || true)
    if [ -z "$BACKUP" ]; then
        echo "ERROR: no soulledger_<timestamp>.sql.gz in $TARGET" >&2
        exit 1
    fi
else
    BACKUP="$TARGET"
fi
if ! gzip -t "$BACKUP"; then
    echo "ERROR: $BACKUP is missing or not a valid gzip archive" >&2
    exit 1
fi

echo "Restore drill: $BACKUP -> $DRILL_DB on $PGHOST:$PGPORT (live: $LIVE_DB, read only)"
createdb "$DRILL_DB"
CREATED=1

START=$(date +%s)
gunzip -c "$BACKUP" | psql -d "$DRILL_DB" -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null
echo "Restored in $(( $(date +%s) - START ))s"

TABLES_SQL="select tablename from pg_tables where schemaname = 'public' order by 1"
MIGRATIONS_SQL="select app || '.' || name from django_migrations order by 1"
COUNTS_SQL="select format('select %L, count(*) from public.%I', tablename, tablename) from pg_tables where schemaname = 'public' order by 1 \\gexec"

for db in "$LIVE_DB" "$DRILL_DB"; do
    psql -d "$db" -X -Atc "$TABLES_SQL" > "$WORK/$db.tables"
    psql -d "$db" -X -Atc "$MIGRATIONS_SQL" > "$WORK/$db.migrations"
    echo "$COUNTS_SQL" | psql -d "$db" -X -At -F ' ' > "$WORK/$db.counts"
    for f in tables migrations counts; do sort -o "$WORK/$db.$f" "$WORK/$db.$f"; done
done

FAIL=0
MISSING_TABLES=$(comm -23 "$WORK/$LIVE_DB.tables" "$WORK/$DRILL_DB.tables")
if [ -n "$MISSING_TABLES" ]; then
    echo "ERROR: tables in $LIVE_DB missing from the restored backup:" >&2
    echo "$MISSING_TABLES" | sed 's/^/  /' >&2
    FAIL=1
fi
MISSING_MIGRATIONS=$(comm -23 "$WORK/$LIVE_DB.migrations" "$WORK/$DRILL_DB.migrations")
if [ -n "$MISSING_MIGRATIONS" ]; then
    echo "ERROR: migrations applied to $LIVE_DB but not in the restored backup (it needs migrate):" >&2
    echo "$MISSING_MIGRATIONS" | sed 's/^/  /' >&2
    FAIL=1
fi

echo "Row counts (table live restored):"
join -a 1 -e '-' -o 0,1.2,2.2 "$WORK/$LIVE_DB.counts" "$WORK/$DRILL_DB.counts" | sed 's/^/  /'
echo "Total rows: live $(awk '{s+=$2} END {print s+0}' "$WORK/$LIVE_DB.counts")," \
     "restored $(awk '{s+=$2} END {print s+0}' "$WORK/$DRILL_DB.counts")," \
     "tables $(wc -l < "$WORK/$DRILL_DB.tables" | tr -d ' ')," \
     "migrations $(wc -l < "$WORK/$DRILL_DB.migrations" | tr -d ' ')"

if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
echo "Restore drill passed."
