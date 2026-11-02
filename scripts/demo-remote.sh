#!/usr/bin/env bash
# Run a command for the Vercel demo in a container on GATES_REMOTE (never on this machine), in a synced
# copy of this tree at /app. Used by scripts/demo-record.sh and for the demo's own E2E; see docs/DEPLOYMENT-demo.md.
#
#   scripts/demo-remote.sh scripts/demo-record-inner.sh     # bash that file, in the container, at /app
#
# The container joins the docker network that holds the gates' throwaway PostgreSQL. $SL_DEMO_DB_URL names a
# database of its own on that server (scripts/demo-record.sh creates and drops it); nothing here reads a
# backend/.env or reaches the shared box. node_modules, the venv and frontend/.next survive between runs.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
# shellcheck disable=SC1091
. "$(git rev-parse --path-format=absolute --git-common-dir)/../.prepush.env"
: "${GATES_REMOTE:?GATES_REMOTE is not set (.prepush.env): the demo is never recorded on this machine}"
RDIR="${GATES_REMOTE_DIR:-/srv/appdata/sl-gates}"
RWORK="$RDIR/work/demo-$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
IMG="${DEMO_IMAGE:-sl-gates-e2e:1}"

ssh -o BatchMode=yes "$GATES_REMOTE" "mkdir -p $RWORK $RDIR/tmp/demo" || exit 1
# First run: borrow the gates' installed dependencies rather than installing them again.
ssh -o BatchMode=yes "$GATES_REMOTE" "cd $RWORK && if [ ! -d node_modules ]; then S=\$(ls -d $RDIR/work/SoulLedger-*-e2e | head -1); cp -a \$S/node_modules . ; mkdir -p backend; cp -a \$S/backend/.venv backend/ ; for w in frontend packages/core mobile mobile-officer; do if [ -d \$S/\$w/node_modules ]; then mkdir -p \$w; cp -a \$S/\$w/node_modules \$w/; fi; done; fi" || exit 1
# --delete does nothing under --files-from, and a stale spec would keep running.
ssh -o BatchMode=yes "$GATES_REMOTE" "rm -rf $RWORK/frontend/e2e/demo" || exit 1
{ git ls-files -z; git ls-files -z -o --exclude-standard; } \
  | python3 -c 'import os,sys; sys.stdout.write("".join(p+"\0" for p in sys.stdin.read().split("\0") if p and os.path.exists(p)))' \
  | rsync -a --no-owner --no-group --delete --filter='P **/node_modules/' --filter='P backend/.venv/' --filter='P frontend/.next/' --filter='P .sl-*' \
      --from0 --files-from=- -r "$ROOT/" "$GATES_REMOTE:$RWORK/" || exit 1

BASE_URL="${GATES_REMOTE_DB_URL%/*}"
NAME="sl-demo-$$"
trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $NAME" >/dev/null 2>&1' EXIT
trap 'exit 130' INT TERM
# shellcheck disable=SC2029
ssh -o BatchMode=yes "$GATES_REMOTE" "docker run --rm --init --name $NAME --network ${GATES_REMOTE_NET:-sl-gates} \
    ${DEMO_PUBLISH:-} --cpus ${DEMO_CPUS:-8} --memory ${DEMO_MEMORY:-16g} --shm-size 2g -v $RWORK:/app -v $RDIR/tmp/demo:/sl-tmp -w /app \
    -e SL_PG_BASE='$BASE_URL' -e SL_DEMO_DB_URL='$BASE_URL/sl_demo_record' -e PW_WORKERS=${PW_WORKERS:-4} -e CI= \
    $IMG bash /app/$1"
