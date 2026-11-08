#!/usr/bin/env bash
# Re-record the Vercel demo's data (docs/DEPLOYMENT-demo.md): seed a throwaway database on GATES_REMOTE, walk the real
# app as each demo role, and bring frontend/demo/data/*.json back to this tree. Runs nothing heavy on this machine.
#
# Skipped when nothing that can change a recording changed (2026-11-08): the hash of the inputs below is kept in
# frontend/demo/data/.recorded-from after each recording, and an equal hash prints so and exits 0 without touching the
# box. FORCE=1 records anyway. Frontend code is not an input on purpose: a screen change alone does not re-record.
#
# The walks (scripts/demo-record.mjs, "Order"): the administrator alone first, then the other five roles at once,
# each with a Django of its own; DEMO_PARALLEL caps how many (default 5, 0 = one after another as before), then souls.
set -u
cd "$(dirname "$0")/.." || exit 1

STAMP=frontend/demo/data/.recorded-from
# Working-tree content of every tracked or new file the recording depends on; test files under backend/ excluded.
inputs_hash() {
    git ls-files -z -co --exclude-standard -- \
        scripts/demo-seed.py scripts/demo-record.mjs scripts/demo-record-inner.sh scripts/demo-backend-up.sh \
        scripts/demo_settings.py scripts/demo-translations.json \
        backend/apps backend/config backend/requirements.lock \
        | tr '\0' '\n' \
        | grep -vE '(^|/)(tests/|test_[^/]*\.py$|tests\.py$|conftest\.py$)|__pycache__/|\.pyc$' \
        | tr '\n' '\0' | xargs -0 shasum 2>/dev/null | shasum | cut -c1-40
}
HASH="$(inputs_hash)"
if [ "${FORCE:-0}" != 1 ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$HASH" ]; then
    echo "demo: recording is current (inputs $HASH); FORCE=1 to record anyway"
    exit 0
fi

# shellcheck disable=SC1091
. "$(git rev-parse --path-format=absolute --git-common-dir)/../.prepush.env"
scripts/demo-remote.sh scripts/demo-record-inner.sh || exit $?
RWORK="${GATES_REMOTE_DIR:-/srv/appdata/sl-gates}/work/demo-$(pwd | tr -d '\n' | shasum | cut -c1-8)"
mkdir -p frontend/demo/data
rsync -a "$GATES_REMOTE:$RWORK/frontend/demo/data/" frontend/demo/data/ || exit 1
# The hash of the tree as it was synced, written after the files it describes have arrived.
echo "$HASH" >"$STAMP"
