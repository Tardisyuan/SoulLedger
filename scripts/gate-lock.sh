# Shared "one heavy gate at a time" lock for this clone (all worktrees).
#
# Why: several sessions run jest / playwright / pytest at once on this machine,
# and each then runs 2-3x slower (2026-09-29: an idle 19-minute SQLite suite
# reached only 77% after 38 minutes at load 50). Queuing costs the same total
# CPU and gets the first result much sooner.
#
# Usage: `. scripts/gate-lock.sh; gate_lock "<label>"`. The lock is released
# when the shell exits. A lock whose pid is gone is taken over. GATE_LOCK=0
# skips it. It lives in the git common dir, so every worktree shares it.
gate_lock() {
    [ "${GATE_LOCK:-1}" = "0" ] && return 0
    GATE_LOCK_DIR="$(git rev-parse --path-format=absolute --git-common-dir)/soulledger-gate.lock"
    local waited=0 pid
    until mkdir "$GATE_LOCK_DIR" 2>/dev/null; do
        pid=$(cat "$GATE_LOCK_DIR/pid" 2>/dev/null)
        if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
            rm -rf "$GATE_LOCK_DIR"; continue
        fi
        if [ $((waited % 60)) -eq 0 ]; then
            echo "    … waiting for the gate lock: $(cat "$GATE_LOCK_DIR/label" 2>/dev/null) (pid ${pid:-?}), ${waited}s so far"
        fi
        sleep 5; waited=$((waited + 5))
    done
    echo $$ > "$GATE_LOCK_DIR/pid"
    echo "$1" > "$GATE_LOCK_DIR/label"
    trap gate_unlock EXIT
}
gate_unlock() {
    [ -n "${GATE_LOCK_DIR:-}" ] && [ "$(cat "$GATE_LOCK_DIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$GATE_LOCK_DIR"
    return 0
}
