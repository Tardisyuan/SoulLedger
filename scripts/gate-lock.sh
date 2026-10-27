# Shared "one heavy gate at a time" lock for this clone (all worktrees).
#
# Why: several sessions run jest / playwright / pytest at once on this machine,
# and each then runs 2-3x slower (2026-09-29: an idle 19-minute SQLite suite
# reached only 77% after 38 minutes at load 50). Queuing costs the same total
# CPU and gets the first result much sooner.
#
# Every heavy gate takes it: SQLite pytest, jest, playwright, builds, tsc — and,
# since 2026-10-19, the real-PostgreSQL run too. It used to be exempt on the
# theory that it waits on 115's network; 2026-09-30 measured otherwise (0.57 ms
# round trips, the Pi at load 0.09, and the same suite at 17 min on a quiet
# machine against 35 min beside other gates): the test client itself is the
# CPU cost, and with `-n 4` it is four of them.
#
# Usage: `. scripts/gate-lock.sh; gate_lock "<label>"`. The lock is released
# when the shell exits. A lock whose pid is gone is taken over. GATE_LOCK=0
# skips it. It lives in the git common dir, so every worktree shares it.
#
# The lock directory appears complete or not at all: pid and label are written
# into a private directory that is then renamed into place, so no waiter can
# see a lock without a pid (one that died between mkdir and the pid write used
# to be waited on forever). A dead holder's lock is renamed away before it is
# removed, so of two waiters that both judged it dead only one wins the rename
# and the other cannot delete a lock someone has just taken.
gate_lock() {
    [ "${GATE_LOCK:-1}" = "0" ] && return 0
    GATE_LOCK_DIR="$(git rev-parse --path-format=absolute --git-common-dir)/soulledger-gate.lock"
    local waited=0 pid tmp
    tmp="$GATE_LOCK_DIR.new.$$"
    rm -rf "$tmp"; mkdir "$tmp" || return 1
    echo $$ > "$tmp/pid"
    echo "$1" > "$tmp/label"
    # `mv dir existing-dir` would move it INSIDE the existing lock, so test first;
    # the rename itself is atomic, and a lost race leaves $tmp nested in the
    # winner's lock, which the cleanup below removes.
    until [ ! -e "$GATE_LOCK_DIR" ] && mv "$tmp" "$GATE_LOCK_DIR" 2>/dev/null && [ "$(cat "$GATE_LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; do
        rm -rf "$GATE_LOCK_DIR/$(basename "$tmp")" 2>/dev/null
        [ -d "$tmp" ] || { mkdir "$tmp" && echo $$ > "$tmp/pid" && echo "$1" > "$tmp/label"; }
        pid=$(cat "$GATE_LOCK_DIR/pid" 2>/dev/null)
        # Dead holder, or a pid-less lock older than a minute (left by a copy of
        # this file from before the rename, which wrote the pid after mkdir).
        if { [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; } \
            || { [ -z "$pid" ] && [ -n "$(find "$GATE_LOCK_DIR" -maxdepth 0 -mmin +1 2>/dev/null)" ]; }; then
            if mv "$GATE_LOCK_DIR" "$GATE_LOCK_DIR.stale.$$" 2>/dev/null; then
                # Another waiter may have replaced the dead lock between our read
                # and our rename; if what we moved is not the lock we judged, put it back.
                if [ "$(cat "$GATE_LOCK_DIR.stale.$$/pid" 2>/dev/null)" != "$pid" ] && [ ! -e "$GATE_LOCK_DIR" ]; then
                    mv "$GATE_LOCK_DIR.stale.$$" "$GATE_LOCK_DIR" 2>/dev/null
                fi
                rm -rf "$GATE_LOCK_DIR.stale.$$"
            fi
            continue
        fi
        if [ $((waited % 60)) -eq 0 ]; then
            echo "    … waiting for the gate lock: $(cat "$GATE_LOCK_DIR/label" 2>/dev/null) (pid ${pid:-?}), ${waited}s so far"
            # A live holder is never taken over automatically: it may be a full run that is just slow.
            # Past 45 minutes say so, and how to look at it — no gate here normally takes that long.
            if [ -n "$pid" ] && [ -n "$(find "$GATE_LOCK_DIR" -maxdepth 0 -mmin +45 2>/dev/null)" ]; then
                echo "    … the holder has had the lock over 45 minutes and may be hung: ps -o pid,etime,command -p $pid ; kill $pid frees the lock"
            fi
        fi
        sleep 5; waited=$((waited + 5))
    done
    trap gate_unlock EXIT
}
gate_unlock() {
    [ -n "${GATE_LOCK_DIR:-}" ] && [ "$(cat "$GATE_LOCK_DIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$GATE_LOCK_DIR"
    return 0
}
