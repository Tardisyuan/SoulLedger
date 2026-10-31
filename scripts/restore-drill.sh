#!/bin/bash
# Restore drill: prove the newest backups restore, then throw the copies away.
#
# Usage (in the production stack, docs/DEPLOYMENT.md「恢复演练」):
#   $DC run --rm --no-deps --entrypoint bash backup /scripts/restore-drill.sh /backups
#   bash scripts/restore-drill.sh <backup dir | soulledger_YYYYMMDD_HHMMSS.sql.gz[.age]>
# On another host (scratch PostgreSQL, off-site copies): DRILL_STANDALONE=1, see the docs.
#
# Everything is restored into scratch places, never over production: databases
# named *_drill_<pid> on the PG* server, files under a mktemp directory.
#
# Steps, each fatal:
#   1. pick the newest soulledger_<timestamp>.sql.gz (a file argument is used as is).
#      BACKUP_AGE_IDENTITY=<age private key file>: pick the newest *.age instead and
#      decrypt it first — the proof that the off-site (encrypted) copies are usable.
#   2. createdb a scratch database soulledger_drill_<pid> on the same server
#   3. restore into it with restore-db.sh's flags (single transaction, ON_ERROR_STOP)
#   4. compare with the live database (PGDATABASE) — skipped with DRILL_STANDALONE=1:
#      - every table the live db has exists in the drill db
#      - every django_migrations row the live db has is in the drill db — the
#        `migrate --check` question asked of the schema the code is running on.
#        A deploy that migrated after the backup fails this on purpose: that
#        backup restores an older schema and needs `migrate` afterwards.
#      - prints per-table row counts of both, for the RPO eyeball (docs)
#   5. media (directory mode): the newest soulledger_media_*.tar.gz must exist and
#      extract into the scratch dir; prints its file count (and MEDIA_DIR's, if set).
#   6. chat, when a Synapse dump exists or SYNAPSE_DATA_DIR holds a homeserver.yaml:
#      the newest soulledger_synapse_<ts>.dump restores (pg_restore, C collation as
#      Synapse requires) into synapse_drill_<pid> and has users/events/rooms; the
#      newest soulledger_synapse_data_*.tar.gz extracts and holds homeserver.yaml and
#      an ed25519 *.signing.key — identical to the live one in SYNAPSE_DATA_DIR, if
#      mounted (a changed signing key is a different homeserver to every client).
#   7. drop both scratch databases and the scratch dir — on success and on failure (trap).
# Prints how long the db restore took: the measured half of the RTO.
#
# Connection: libpq PG* variables (fallback DB_*), as backup-db.sh / restore-db.sh.
# The live database is only read. DRILL_KEEP=1 skips the drop (to run Django's own
# `migrate --check` against it by hand; drop it yourself afterwards).
# Failure calls ops_alert (OPS_ALERT_WEBHOOK_URL; a loud block when unset).
set -euo pipefail
export LC_ALL=C   # sort / comm / join below must agree on one collation

# shellcheck disable=SC1091
. "$(dirname "$0")/ops-alert.sh"

export PGHOST="${PGHOST:-${DB_HOST:-localhost}}"
export PGPORT="${PGPORT:-${DB_PORT:-5432}}"
export PGUSER="${PGUSER:-${DB_USER:-soulledger}}"
LIVE_DB="${PGDATABASE:-${DB_NAME:-soulledger}}"
DRILL_DB="soulledger_drill_$$"
SYNAPSE_DRILL_DB="synapse_drill_$$"
TARGET="${1:-./backups}"
WORK=$(mktemp -d)
CREATED=""
SCREATED=""
STANDALONE="${DRILL_STANDALONE:-}"

finish() {
    rc=$?
    for db in ${CREATED:+$DRILL_DB} ${SCREATED:+$SYNAPSE_DRILL_DB}; do
        if [ "${DRILL_KEEP:-}" != 1 ]; then
            dropdb --if-exists "$db" || { echo "ERROR: could not drop $db; drop it by hand" >&2; rc=1; }
            echo "Dropped scratch database $db"
        else
            echo "DRILL_KEEP=1: scratch database $db kept; dropdb it when done"
        fi
    done
    rm -rf "$WORK"
    if [ "$rc" -ne 0 ]; then
        ops_alert "restore-drill.sh FAILED (exit $rc) on ${BACKUP:-$TARGET}" || true
    fi
    exit "$rc"
}
trap finish EXIT

# <file>: the file itself, or — for *.age — its decryption into $WORK.
plain() {
    case "$1" in
        *.age)
            if [ -z "${BACKUP_AGE_IDENTITY:-}" ]; then
                echo "ERROR: $1 is encrypted; set BACKUP_AGE_IDENTITY to the age private key file" >&2
                return 1
            fi
            out="$WORK/$(basename "$1" .age)"
            if ! age -d -i "$BACKUP_AGE_IDENTITY" -o "$out" "$1"; then
                echo "ERROR: cannot decrypt $1 with BACKUP_AGE_IDENTITY" >&2
                return 1
            fi
            echo "Decrypted $1" >&2
            printf '%s' "$out";;
        *) printf '%s' "$1";;
    esac
}

SUFFIX=""
[ -n "${BACKUP_AGE_IDENTITY:-}" ] && SUFFIX=".age"
# <glob>: the newest match in the backup dir (with .age when decrypting), or nothing.
newest() { ls -1 "$TARGET"/$1$SUFFIX 2>/dev/null | sort | tail -n 1 || true; }

if [ -d "$TARGET" ]; then
    # soulledger_2*: the db dumps only (media / synapse files start with a letter).
    BACKUP=$(newest 'soulledger_2*.sql.gz')
    if [ -z "$BACKUP" ]; then
        echo "ERROR: no soulledger_<timestamp>.sql.gz$SUFFIX in $TARGET" >&2
        exit 1
    fi
else
    BACKUP="$TARGET"
fi
DUMP=$(plain "$BACKUP")
if ! gzip -t "$DUMP"; then
    echo "ERROR: $BACKUP is missing or not a valid gzip archive" >&2
    exit 1
fi

LIVE_NOTE="live: $LIVE_DB, read only"
[ -z "$STANDALONE" ] || LIVE_NOTE="DRILL_STANDALONE=1: no live comparison"
echo "Restore drill: $BACKUP -> $DRILL_DB on $PGHOST:$PGPORT ($LIVE_NOTE)"
createdb "$DRILL_DB"
CREATED=1

START=$(date +%s)
gunzip -c "$DUMP" | psql -d "$DRILL_DB" -v ON_ERROR_STOP=1 --single-transaction -q >/dev/null
echo "Restored in $(( $(date +%s) - START ))s"

TABLES_SQL="select tablename from pg_tables where schemaname = 'public' order by 1"
MIGRATIONS_SQL="select app || '.' || name from django_migrations order by 1"
COUNTS_SQL="select format('select %L, count(*) from public.%I', tablename, tablename) from pg_tables where schemaname = 'public' order by 1 \\gexec"

DBS="$DRILL_DB"
[ -n "$STANDALONE" ] || DBS="$LIVE_DB $DRILL_DB"
for db in $DBS; do
    psql -d "$db" -X -Atc "$TABLES_SQL" > "$WORK/$db.tables"
    psql -d "$db" -X -Atc "$MIGRATIONS_SQL" > "$WORK/$db.migrations"
    echo "$COUNTS_SQL" | psql -d "$db" -X -At -F ' ' > "$WORK/$db.counts"
    for f in tables migrations counts; do sort -o "$WORK/$db.$f" "$WORK/$db.$f"; done
done

FAIL=0
if [ -z "$STANDALONE" ]; then
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
else
    if [ ! -s "$WORK/$DRILL_DB.migrations" ]; then
        echo "ERROR: the restored backup has no django_migrations rows" >&2
        FAIL=1
    fi
    echo "Row counts (table restored):"
    sed 's/^/  /' "$WORK/$DRILL_DB.counts"
    echo "Total rows: restored $(awk '{s+=$2} END {print s+0}' "$WORK/$DRILL_DB.counts")," \
         "tables $(wc -l < "$WORK/$DRILL_DB.tables" | tr -d ' ')," \
         "migrations $(wc -l < "$WORK/$DRILL_DB.migrations" | tr -d ' ')"
fi

# --- files and chat: only when given a backup directory --------------------
if [ -d "$TARGET" ]; then
    MEDIA=$(newest 'soulledger_media_*.tar.gz')
    if [ -z "$MEDIA" ]; then
        echo "ERROR: no soulledger_media_*.tar.gz$SUFFIX in $TARGET" >&2
        FAIL=1
    else
        mkdir "$WORK/media"
        tar -xzf "$(plain "$MEDIA")" -C "$WORK/media"
        echo "Media: $MEDIA extracted, $(find "$WORK/media" -type f | wc -l | tr -d ' ') files" \
             "${MEDIA_DIR:+(live $MEDIA_DIR: $(find "$MEDIA_DIR" -type f | wc -l | tr -d ' ') files)}"
    fi

    SDUMP=$(newest 'soulledger_synapse_2*.dump')
    SDATA=$(newest 'soulledger_synapse_data_*.tar.gz')
    if [ -n "$SDUMP" ] || [ -f "${SYNAPSE_DATA_DIR:-/nonexistent}/homeserver.yaml" ]; then
        if [ -z "$SDUMP" ] || [ -z "$SDATA" ]; then
            echo "ERROR: chat is in use but its backup is incomplete (dump: ${SDUMP:-none}, data: ${SDATA:-none})" >&2
            exit 1
        fi
        createdb -T template0 -E UTF8 --lc-collate=C --lc-ctype=C "$SYNAPSE_DRILL_DB"
        SCREATED=1
        pg_restore --no-owner --no-privileges --single-transaction --exit-on-error \
            -d "$SYNAPSE_DRILL_DB" "$(plain "$SDUMP")"
        echo "Synapse db: $SDUMP -> $SYNAPSE_DRILL_DB:" \
             "$(psql -d "$SYNAPSE_DRILL_DB" -X -Atc "select (select count(*) from users) || ' users, ' || (select count(*) from events) || ' events, ' || (select count(*) from rooms) || ' rooms'")"

        mkdir "$WORK/synapse"
        tar -xzf "$(plain "$SDATA")" -C "$WORK/synapse"
        KEY=$(ls -1 "$WORK"/synapse/*.signing.key 2>/dev/null | head -n 1 || true)
        if [ ! -f "$WORK/synapse/homeserver.yaml" ] || [ -z "$KEY" ] || ! grep -q '^ed25519 ' "$KEY"; then
            echo "ERROR: $SDATA lacks homeserver.yaml or an ed25519 *.signing.key" >&2
            FAIL=1
        else
            LIVE_KEY="${SYNAPSE_DATA_DIR:-/nonexistent}/$(basename "$KEY")"
            if [ -f "$LIVE_KEY" ] && ! cmp -s "$KEY" "$LIVE_KEY"; then
                echo "ERROR: the backed-up signing key differs from the live $LIVE_KEY" >&2
                FAIL=1
            else
                MATCH=""
                [ -f "$LIVE_KEY" ] && MATCH=", identical to the live one"
                echo "Synapse data: $SDATA extracted; homeserver.yaml and $(basename "$KEY") present$MATCH"
            fi
        fi
    else
        echo "Chat: no Synapse backup and no initialized SYNAPSE_DATA_DIR; skipped"
    fi
fi

if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
echo "Restore drill passed."
