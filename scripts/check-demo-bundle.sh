#!/usr/bin/env bash
# What a finished `next build` contains of the demo. `absent`: a normal build must have none of it, in the
# browser's chunks or on the server. `present`: a demo build must have it (otherwise `absent` proves nothing).
#   scripts/check-demo-bundle.sh absent|present [frontend/.next]
# `budget`: the recorded data's size budget (fe-perf.md item 7), on the source tree, no build needed. Every chunk the
# demo can fetch (a role's bucket, or a role's whole single-file recording until it is re-recorded) at most
# DEMO_CHUNK_KB gzip (150), every role's boot bucket at most DEMO_BOOT_KB (60).
#   scripts/check-demo-bundle.sh budget [frontend/demo/data]
# ponytail: the landing page's first-load JS (180 KB) and critical CSS (45 KB) budgets need the build manifest read; not done yet.
set -u
WANT="${1:?absent, present or budget}"
if [ "$WANT" = budget ]; then
    DATA="${2:-$(dirname "$0")/../frontend/demo/data}"
    CHUNK=$(( ${DEMO_CHUNK_KB:-150} * 1024 ))
    BOOT=$(( ${DEMO_BOOT_KB:-60} * 1024 ))
    bad=0
    check() {  # file limit
        local size
        size=$(gzip -9c "$1" | wc -c | tr -d ' ')
        if [ "$size" -gt "$2" ]; then
            echo "OVER  $(( size / 1024 )) KB gzip > $(( $2 / 1024 )) KB  $1"
            bad=1
        fi
    }
    for f in "$DATA"/*.*/*.json; do
        [ -e "$f" ] || continue
        case "$f" in */boot.json) check "$f" "$BOOT" ;; *) check "$f" "$CHUNK" ;; esac
    done
    # A role not yet re-recorded is still one chunk, and the sign-in waits for all of it.
    for f in "$DATA"/{admin,judge,judge_eu,judge_eg,judge_gr,moderator}.{zh,en}.json; do
        [ -e "$f" ] && check "$f" "$BOOT"
    done
    [ "$bad" -eq 0 ] && echo "demo data within budget ($DATA)"
    exit "$bad"
fi
DIR="${2:-$(dirname "$0")/../frontend/.next}"
hits=$(grep -rlE 'soulledger_demo_overlay|demo_moderator|demo-enter-' "$DIR/static" "$DIR/server" 2>/dev/null | wc -l | tr -d ' ')
echo "demo markers found in $hits file(s) of $DIR (want: $WANT)"
if [ "$WANT" = absent ]; then [ "$hits" -eq 0 ]; else [ "$hits" -gt 0 ]; fi
