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

: "${1:?usage: scripts/demo-remote.sh <script under /app> [args...]}"
# Every argument goes through, each %q-quoted once for the remote shell, so one with a space stays one.
SCRIPT="$1"
ARGS="/app/$(printf '%q' "$1")"; shift
[ $# -gt 0 ] && ARGS="$ARGS$(printf ' %q' "$@")"
BASE_URL="${GATES_REMOTE_DB_URL%/*}"
NAME="sl-demo-$$"
trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $NAME" >/dev/null 2>&1' EXIT
trap 'exit 130' INT TERM
# /tmp in memory: Chromium keeps its profile, and so its HTTP cache, there, and with /tmp on the container's own disk
# (the docker image on the shared cache pool, written to by every other gate at once) the browser stalled for 5-19 s at
# a time: no frames, so no requestAnimationFrame, so Playwright's "stable" check and the entrance cover's closing never
# finished. Trace 2026-11-08: frames stopped for 19 328 ms, exactly as long as three web fonts took, while a probe in
# the same container curling that font every 0.2 s never waited. Two runs on disk: 10 and 15 failed; on tmpfs: none.
# flock e2e.lock: the same lock as `run-gates.sh --e2e`, so two browser suites never share the machine (2026-11-10:
# gates + E2E + demo E2E at once = 28 cores asked of 20; one E2E and six demo tests went red, all green apart).
# The gates' own run.lock is separate, so the gates may still run beside one browser suite (user 2026-11-11).
# shellcheck disable=SC2029
# A TIME LIMIT, ENFORCED THERE (2026-11-12, user decision): 25 minutes for the demo E2E and the recording, DEMO_TIMEOUT
# overrides (GNU timeout's syntax: 1500, 25m). `timeout` is the container's own command, so the run ends at the limit
# even when this machine's ssh has dropped; the lock is held by a subshell that removes the container (docker rm -f)
# before letting go, so a dropped ssh no longer frees the lock under a container still running. Same scheme as
# scripts/run-gates.sh (TIME LIMITS ON THE REMOTE MACHINE). The two servers (demo-serve-inner.sh,
# demo-app-backend-inner.sh) are meant to stay up, so they get no limit unless DEMO_TIMEOUT is set.
case "$SCRIPT" in
    *serve-inner.sh|*backend-inner.sh) LIMIT="${DEMO_TIMEOUT:-}" ;;
    *) LIMIT="${DEMO_TIMEOUT:-25m}" ;;
esac
TIMED=""
if [ -n "$LIMIT" ]; then
    [[ "$LIMIT" =~ ^[0-9]+(\.[0-9]+)?[smhd]?$ ]] || { echo "demo-remote: DEMO_TIMEOUT=$LIMIT is not a time limit (e.g. 25m, 1500)"; exit 2; }
    TIMED="timeout -k 60 $LIMIT"
fi
ssh -o BatchMode=yes "$GATES_REMOTE" "( flock 9 || exit 1; docker run --rm --init --name $NAME --network ${GATES_REMOTE_NET:-sl-gates} \
    --tmpfs /tmp:rw,exec,size=8g ${DEMO_PUBLISH:-} --cpus ${DEMO_CPUS:-8} --memory ${DEMO_MEMORY:-16g} --shm-size 2g -v $RWORK:/app -v $RDIR/tmp/demo:/sl-tmp -w /app \
    -e SL_PG_BASE='$BASE_URL' -e SL_DEMO_DB_URL='$BASE_URL/sl_demo_record' -e PW_WORKERS=${PW_WORKERS:-4} -e DEMO_PARALLEL=${DEMO_PARALLEL:-5} -e CI= \
    $IMG $TIMED bash $ARGS; rc=\$?; docker rm -f $NAME >/dev/null 2>&1; exit \$rc ) 9>$RDIR/e2e.lock"
RC=$?
trap - EXIT
case "$RC" in
    124) echo "demo-remote: TIMED OUT on $GATES_REMOTE after $LIMIT (DEMO_TIMEOUT overrides). The run was stopped there" \
              "(its container removed with docker rm -f) and the lock released; nothing of it is still running." ;;
    137) echo "demo-remote: killed on $GATES_REMOTE (exit 137): the time limit's KILL, 60 s after ${LIMIT:-its limit}, or the" \
              "container's memory limit. The container is removed and the lock released." ;;
esac
exit "$RC"
