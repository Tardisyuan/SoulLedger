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

# --auto (2026-11-12, user decision): `scripts/demo-remote.sh --auto scripts/demo-e2e-inner.sh` runs the demo E2E
# only when the change can reach it, like `run-gates.sh --e2e=auto`. The change list is the selective gates':
# the diff against DEMO_BASE (default: the merge-base with origin/main) plus untracked files. The demo build sees
# frontend/ (its pages, frontend/demo/ and the recordings in frontend/demo/data/, e2e/demo, the demo playwright
# config), packages/core/, the JS dependency tree, its own runner scripts, and — failing closed — any root-level
# file not on run-gates.sh's INERT_ROOT_RE (copied below). Without --auto it always runs.
if [ "${1:-}" = --auto ]; then
    shift
    case "${1:-}" in scripts/demo-e2e-inner.sh|./scripts/demo-e2e-inner.sh) ;;
        *) echo "demo-remote: --auto is for scripts/demo-e2e-inner.sh only"; exit 2 ;; esac
    BASE="${DEMO_BASE:-$(git merge-base HEAD origin/main 2>/dev/null)}" \
        && git rev-parse --verify -q "$BASE^{commit}" >/dev/null \
        || { echo "demo-remote: --auto needs a base: no merge-base with origin/main, and DEMO_BASE is not set"; exit 2; }
    CHANGED="$( { git diff --name-only --no-renames "$BASE"; git ls-files --others --exclude-standard; } | sort -u)"
    # Not what no browser loads (run-gates.sh's E2E_BLIND_COMMON_RE, copied; 2026-11-13): unit tests, the
    # jest / vitest / eslint configuration, documentation. The demo specs and recordings stay triggers here.
    HIT="$(echo "$CHANGED" | grep -vE '(\.md$|^frontend/src/__tests__/|^frontend/.*\.test\.tsx?$|^packages/core/(.*/)?__tests__/|^packages/core/.*\.test\.tsx?$|^frontend/(jest|eslint)\.[^/]+$|^packages/core/(vitest|eslint)\.[^/]+$)' | grep -E '^(frontend/|packages/core/|package\.json$|package-lock\.json$|\.nvmrc$|scripts/(demo-remote\.sh|demo-e2e-inner\.sh|demo-e2e-summary\.py|check-demo-bundle\.sh)$)' | head -1)"
    [ -z "$HIT" ] && HIT="$(echo "$CHANGED" | grep -v '/' | grep -vE '(\.md$|^(docker-compose[A-Za-z0-9._-]*\.ya?ml|\.dockerignore|\.gitignore|\.claudeignore|\.env\.example)$)' | grep -v '^$' | head -1)"
    if [ -z "$HIT" ]; then
        echo "demo-remote: --auto: nothing since $(git rev-parse --short "$BASE") reaches the demo (no frontend/, packages/core/, JS dependency, demo runner or unknown root-level file changed) — not running the demo E2E"
        exit 0
    fi
    echo "demo-remote: --auto: $HIT changed — running the demo E2E"
fi

# THE DEMO E2E'S PASS IS RECORDED (2026-11-12, user decision), as the gates' and E2E's are: a green
# `scripts/demo-remote.sh scripts/demo-e2e-inner.sh` (no extra arguments: a filtered run proves less) on a
# clean checkout appends HEAD's tree to <git common dir>/soulledger-gates-passed-demo, and the same tree is
# not run again. Clean here is `git status --porcelain` empty: this sync sends every untracked file.
# FORCE=1 runs anyway. GATES_STAMP_FILE is the test seam, as in run-gates.sh.
DEMO_STAMP="${GATES_STAMP_FILE:-$(git rev-parse --path-format=absolute --git-common-dir)/soulledger-gates-passed}-demo"
DEMO_TREE=""
case "${1:-}" in
    scripts/demo-e2e-inner.sh|./scripts/demo-e2e-inner.sh)
        if [ $# -eq 1 ] && [ -z "$(git status --porcelain)" ]; then DEMO_TREE="$(git rev-parse HEAD^{tree})"; fi ;;
esac
if [ -n "$DEMO_TREE" ] && [ "${FORCE:-}" != 1 ] && [ -f "$DEMO_STAMP" ] && grep -q "^$DEMO_TREE	" "$DEMO_STAMP"; then
    echo "demo-remote: tree ${DEMO_TREE:0:10} already passed the demo E2E ($(grep -m1 "^$DEMO_TREE	" "$DEMO_STAMP" | cut -f2)) — not running it again (FORCE=1 runs it)"
    exit 0
fi

# .sl-last-use: this tree is in use — run-gates.sh deletes synced trees no run has used for two weeks (remote_prune).
ssh -o BatchMode=yes "$GATES_REMOTE" "mkdir -p $RWORK $RDIR/tmp/demo && touch $RWORK/.sl-last-use" || exit 1
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
# flock e2e.lock (the demo E2E and the recording): the same lock as `run-gates.sh --e2e`, so two browser suites never share the machine (2026-11-10:
# gates + E2E + demo E2E at once = 28 cores asked of 20; one E2E and six demo tests went red, all green apart).
# The gates' own run.lock is separate, so the gates may still run beside one browser suite (user 2026-11-11).
# shellcheck disable=SC2029
# A TIME LIMIT, ENFORCED THERE (2026-11-12, user decision): 25 minutes for the demo E2E and the recording, DEMO_TIMEOUT
# overrides (GNU timeout's syntax: 1500, 25m). `timeout` is the container's own command, so the run ends at the limit
# even when this machine's ssh has dropped; the lock is held by a subshell that removes the container (docker rm -f)
# before letting go, so a dropped ssh no longer frees the lock under a container still running. Same scheme as
# scripts/run-gates.sh (TIME LIMITS ON THE REMOTE MACHINE). The two servers (demo-serve-inner.sh,
# demo-app-backend-inner.sh) are meant to stay up, so they get no limit unless DEMO_TIMEOUT is set.
#
# THE TWO SERVERS DO NOT HOLD e2e.lock (2026-11-13, test review 3.5). They stay up for hours with no limit, and
# while one did, every `run-gates.sh --e2e` and demo E2E waited on that lock without a word. What a server
# shares with the other runs, and so what must still keep them apart:
#   - with `run-gates.sh --e2e`: nothing — that suite has its own tree (work/<id>-e2e), publishes no port and
#     uses no database; a server idles, so the cores are not contested either. It no longer waits.
#   - with the demo E2E and the recording: this tree's frontend/.next (demo-serve-inner.sh and demo-e2e-inner.sh
#     both `next build` into it) and the database sl_demo_record (demo-app-backend-inner.sh and the recording
#     both create it). Those must not overlap, so every demo run takes demo-serve.lock, and the servers take
#     only that. A demo E2E started while a server is up still waits — and now says for what.
# Order is always demo-serve.lock, then e2e.lock, so the two cannot deadlock.
# ponytail: demo-serve.lock is one lock for every checkout and both servers; .next is per tree, so a lock per
# tree would let two checkouts' servers coexist — add it when more than one checkout serves the demo.
P=demo-remote
# remote_flock — a copy of scripts/run-gates.sh's, kept identical by its test: take the lock; when it is
# taken, say who has it, then wait (the wait used to be silent; this machine's gate-lock.sh reports every minute).
remote_flock() {
    local fd="$1" lock="$2" filters="" n; shift 2
    for n in "$@"; do filters="$filters --filter name=$n"; done
    printf '%s' "flock -n $fd || { echo \"$P: waiting for $lock on that machine, held by: \$(docker ps --format '{{.Names}} ({{.Status}})'$filters | paste -sd, -)\"; flock $fd; } || exit 1"
}
case "$SCRIPT" in
    *serve-inner.sh|*backend-inner.sh)
        LIMIT="${DEMO_TIMEOUT:-}"
        LOCKS="$(remote_flock 8 demo-serve.lock sl-demo-)"; LOCK_FILES="8>$RDIR/demo-serve.lock" ;;
    *)  LIMIT="${DEMO_TIMEOUT:-25m}"
        LOCKS="$(remote_flock 8 demo-serve.lock sl-demo-); $(remote_flock 9 e2e.lock sl-e2e- sl-demo-)"
        LOCK_FILES="8>$RDIR/demo-serve.lock 9>$RDIR/e2e.lock" ;;
esac
TIMED=""
if [ -n "$LIMIT" ]; then
    [[ "$LIMIT" =~ ^[0-9]+(\.[0-9]+)?[smhd]?$ ]] || { echo "demo-remote: DEMO_TIMEOUT=$LIMIT is not a time limit (e.g. 25m, 1500)"; exit 2; }
    TIMED="timeout -k 60 $LIMIT"
fi
ssh -o BatchMode=yes "$GATES_REMOTE" "( $LOCKS; docker run --rm --init --name $NAME --network ${GATES_REMOTE_NET:-sl-gates} \
    --tmpfs /tmp:rw,exec,size=8g ${DEMO_PUBLISH:-} --cpus ${DEMO_CPUS:-8} --memory ${DEMO_MEMORY:-16g} --shm-size 2g -v $RWORK:/app -v $RDIR/tmp/demo:/sl-tmp -w /app \
    -e SL_PG_BASE='$BASE_URL' -e SL_DEMO_DB_URL='$BASE_URL/sl_demo_record' -e PW_WORKERS=${PW_WORKERS:-4} -e DEMO_PARALLEL=${DEMO_PARALLEL:-5} -e CI= \
    $IMG $TIMED bash $ARGS; rc=\$?; docker rm -f $NAME >/dev/null 2>&1; exit \$rc ) $LOCK_FILES"
RC=$?
trap - EXIT
case "$RC" in
    124) echo "demo-remote: TIMED OUT on $GATES_REMOTE after $LIMIT (DEMO_TIMEOUT overrides). The run was stopped there" \
              "(its container removed with docker rm -f) and the lock released; nothing of it is still running." ;;
    137) echo "demo-remote: killed on $GATES_REMOTE (exit 137): the time limit's KILL, 60 s after ${LIMIT:-its limit}, or the" \
              "container's memory limit. The container is removed and the lock released." ;;
esac
if [ "$RC" -eq 0 ] && [ -n "$DEMO_TREE" ]; then
    if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD^{tree})" != "$DEMO_TREE" ]; then
        echo "demo-remote: not recording this demo E2E pass — the checkout changed while it ran"
    else
        printf '%s\t%s, %s\n' "$DEMO_TREE" "$(date '+%Y-%m-%d %H:%M')" "$(git rev-parse --short HEAD)" >>"$DEMO_STAMP"
        tail -n 50 "$DEMO_STAMP" >"$DEMO_STAMP.tmp" && mv "$DEMO_STAMP.tmp" "$DEMO_STAMP"
        echo "demo-remote: recorded a demo E2E pass for tree ${DEMO_TREE:0:10} — the same tree will not run again"
    fi
fi
exit "$RC"
