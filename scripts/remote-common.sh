# scripts/remote-common.sh — what run-gates.sh (with gates-remote.sh), demo-remote.sh and mobile-remote.sh share.
# Sourced, never run. Definitions only: nothing here runs on source. It uses the caller's $P (the message prefix)
# and, for remote_verdict, $GATES_REMOTE unless a host is passed. install-hooks.sh copies it beside the hook's
# run-gates.sh; a change here forces a full run and the gate tests, as a change to run-gates.sh does (GATE_SCRIPTS
# in scripts/gates_classify.py).
# Until 2026-11-26 demo-remote.sh and mobile-remote.sh carried copies of remote_flock and of the regexes (now in
# scripts/gates_classify.py), kept equal by tests that only compared the copies.

# prepush_env — the path of this machine's settings file (.prepush.env, gitignored), or nothing. The checkout's own
# copy wins; a worktree has none (a gitignored file is not checked out there), so the main checkout's is the fallback:
# it describes the same machine. The caller sources it at top level (a `declare` in it must not turn local).
prepush_env() {
    local root main
    root="$(git rev-parse --show-toplevel 2>/dev/null)"
    main="$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)"
    if [ -n "$root" ] && [ -f "$root/.prepush.env" ]; then echo "$root/.prepush.env"
    elif [ -n "$main" ] && [ -f "$main/.prepush.env" ]; then echo "$main/.prepush.env"; fi
}

# ledger_append <file> <field>… — one tab-separated line onto a pass ledger, which keeps its last 50 lines.
ledger_append() {
    local file="$1"; shift
    (IFS=$'\t'; printf '%s\n' "$*") >>"$file"
    tail -n 50 "$file" >"$file.tmp" && mv "$file.tmp" "$file"
}

# remote_flock <fd> <lock name> <container name prefix>… — the remote shell's words for "take this lock; when
# it is taken, say who has it, then wait" (2026-11-13, test review 3.5). The wait used to be silent — a plain
# `flock 9` — while this machine's gate-lock.sh reports every minute; a demo server left up held e2e.lock for
# hours and `--e2e` simply sat there. Who has it is read from the containers' names (sl-gates-, sl-e2e-,
# sl-demo-, sl-android-).
remote_flock() {
    local fd="$1" lock="$2" filters="" n; shift 2
    for n in "$@"; do filters="$filters --filter name=$n"; done
    printf '%s' "flock -n $fd || { echo \"$P: waiting for $lock on that machine, held by: \$(docker ps --format '{{.Names}} ({{.Status}})'$filters | paste -sd, -)\"; flock $fd; } || exit 1"
}

remote_limit() {  # <value> <variable name>: refuse anything `timeout` would not read as a duration
    [[ "$1" =~ ^[0-9]+(\.[0-9]+)?[smhd]?$ ]] || { echo "$P: $2=$1 is not a time limit (e.g. 30m, 1800)"; exit 2; }
}
# remote_verdict <exit status> <limit> <variable> [host] — say so when the remote run ended on the limit.
# The scheme behind 124 / 137: TIME LIMITS ON THE REMOTE MACHINE, scripts/gates-remote.sh.
remote_verdict() {
    local host="${4:-${GATES_REMOTE:-}}"
    case "$1" in
        124) echo "$P: TIMED OUT on $host after $2 ($3 overrides). The run was stopped there (its container" \
                  "removed with docker rm -f) and the lock released; nothing of it is still running." ;;
        137) echo "$P: killed on $host (exit 137): either the time limit's KILL, 60 s after it ran out (${2:-no limit}," \
                  "$3), or the container's memory limit. The container is removed and the lock released." ;;
        75) echo "$P: REFUSED by $host: its work dir is too full and no unmounted tree could be deleted to make room" \
                  "(see the prune line above; GATES_REMOTE_MIN_FREE_MB). Nothing ran." ;;
    esac
}
