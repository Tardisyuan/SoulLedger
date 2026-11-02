#!/usr/bin/env bash
# Re-record the Vercel demo's data (docs/DEPLOYMENT-demo.md): seed a throwaway database on GATES_REMOTE, walk the real
# app as each demo role, and bring frontend/demo/data/*.json back to this tree. Runs nothing heavy on this machine.
set -u
cd "$(dirname "$0")/.." || exit 1
# shellcheck disable=SC1091
. "$(git rev-parse --path-format=absolute --git-common-dir)/../.prepush.env"
scripts/demo-remote.sh scripts/demo-record-inner.sh || exit $?
RWORK="${GATES_REMOTE_DIR:-/srv/appdata/sl-gates}/work/demo-$(pwd | tr -d '\n' | shasum | cut -c1-8)"
mkdir -p frontend/demo/data
rsync -a "$GATES_REMOTE:$RWORK/frontend/demo/data/" frontend/demo/data/
