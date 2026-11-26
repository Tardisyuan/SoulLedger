# scripts/remote-common.sh — what run-gates.sh (with gates-remote.sh), demo-remote.sh and mobile-remote.sh share.
# Sourced, never run. Definitions only: nothing here runs on source. It uses the caller's $P (the message prefix),
# $ROOT (remote_rsync) and, for remote_verdict, $GATES_REMOTE unless a host is passed. install-hooks.sh copies it beside the hook's
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

# sync_files <untracked pathspec>… — what a remote copy of this checkout gets, NUL-separated, for remote_rsync:
# every tracked file, and the untracked (not ignored) ones under the pathspecs — all of them when none is given.
# Run at the checkout's top level. What a ledger calls a clean checkout follows from this: run-gates.sh's
# tree_is_clean looks for untracked files only where remote_sync sends them; demo-remote.sh sends every untracked
# file, so it asks for `git status --porcelain` to be empty. The difference is deliberate.
sync_files() {
    # A tracked file deleted here but not yet committed is still in `git ls-files`; rsync would stop on it (exit 23).
    git ls-files -z | perl -0 -ne 'chop; print "$_\0" if -e $_ || -l $_'
    git ls-files -z -o --exclude-standard -- "$@"
}

# remote_rsync <host> <dir> <rsync option>… — the files on stdin (sync_files) to <host>:<dir>, owned by the remote
# user (git there refuses a repository another user owns once the tests turn the system config off). --delete
# spares node_modules, .sl-* and what the caller's filters protect — and DOES NOTHING for a file this checkout no
# longer has: under --files-from a deleted file is simply absent from the list, so the remote copy stays. Each
# caller prunes those itself, its own way: gates-remote.sh's remote_sync by the synced .git's untracked files,
# demo-remote.sh by the list (its tree has no .git), mobile-remote.sh not at all. Uses the caller's $ROOT.
remote_rsync() {
    local host="$1" dir="$2"; shift 2
    rsync -a --no-owner --no-group --delete --filter='P **/node_modules/' --filter='P .sl-*' "$@" \
        --from0 --files-from=- -r "$ROOT/" "$host:$dir/"
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
