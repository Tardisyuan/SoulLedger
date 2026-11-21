# scripts/gates-remote.sh — the remote executor of scripts/run-gates.sh: which machine runs a delegated gate,
# --tests or --e2e run, and how it gets there. Sourced by run-gates.sh (after .prepush.env is read), never run
# on its own: it uses run-gates.sh's $P, $ROOT, $GATES_SIDES and $E2E, and sets the variables the rest of it
# reads (RDIR, RIMG, RID, RWORK, SLOT_*, WIN_*, PRUNE_*, DEPS_JS / DEPS_PY, REMOTE_DEPS).
#   - routing: unRAID slot 1 → the idle Windows PC → unRAID slot 2 or its queue (win_route, remote_slots)
#   - the PC: game detection, nice 19 and fewer CPUs while a game runs (win_game, win_probe, win_watch)
#   - ssh + rsync (remote_sync), flock (remote_flock), time limits (remote_limit, remote_verdict),
#     synced trees nobody uses (remote_prune), dependency hashes (deps_hash_js, REMOTE_DEPS)
#   - the containers: remote_gate_run (delegated gates and --tests), remote_e2e_run (--e2e)
# Split out of run-gates.sh on 2026-11-21 (docs/audit/rebuild-2026-11-20.md §5, step 6): the same code in the
# same order. A change here forces a full run and the gate tests, as a change to run-gates.sh does (FULL_RULES
# there, GATE_SCRIPTS in select-backend-tests.py). install-hooks.sh copies it beside the hook's run-gates.sh.

# ── THE REMOTE MACHINE (GATES_REMOTE): shared by the delegated gates and --e2e ─────────────────
RDIR="${GATES_REMOTE_DIR:-/srv/appdata/sl-gates}"
RIMG="${GATES_REMOTE_IMAGE:-sl-gates-all:1}"
RID="$(basename "$ROOT")-$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
RWORK="$RDIR/work/$RID"
# remote_sync — this tree to $GATES_REMOTE:$RWORK. Owned by the remote user, not this machine's uid:
# git there refuses a repository another user owns once the tests turn the system config off
# (GIT_CONFIG_NOSYSTEM), and four gate tests went red. node_modules, the venv, caches and the Next
# build survive the --delete.
remote_sync() {
    # In a linked worktree `.git` is a FILE ("gitdir: /Users/…/.git/worktrees/<name>"), a path that does not
    # exist on the remote: every git command there died with "not a repository" before any test ran
    # (2026-11-07, a subagent's push from .claude/worktrees/…). So a worktree sends a real .git instead: the
    # common dir (objects, refs, config; not the other worktrees) plus this worktree's own HEAD and index.
    local dotgit='.git\0' keepgit=()
    # Room first (2026-11-19): a full work dir (the PC's 14 GB tmpfs) failed the rsync below, or `npm ci` after it.
    # Only the space rule here (days 0): the least recently used unmounted trees go until it fits, never this one.
    ssh -o BatchMode=yes "$GATES_REMOTE" "$(declare -f remote_prune); mkdir -p $RDIR; ( flock 7; remote_prune $RDIR $RWORK 0 ${PRUNE_DRY:-0} ${PRUNE_MIN_KB:-3145728} ) 7>$RDIR/prune.lock" \
        || { echo "$P: $GATES_REMOTE has no room for this tree under $RDIR, and none to make (see above). Not syncing."; return 1; }
    [ -f "$ROOT/.git" ] && { dotgit=''; keepgit=(--filter='P .git/'); }
    { git ls-files -z; git ls-files -z -o --exclude-standard -- backend frontend packages mobile mobile-officer scripts; printf "$dotgit"; } \
        | rsync -a --no-owner --no-group --delete --filter='P **/node_modules/' --filter='P backend/.venv/' --filter='P **/.pytest_cache/' \
            --filter='P frontend/.next/' --filter='P .sl-*' ${keepgit[@]+"${keepgit[@]}"} --exclude='.git/soulledger-*' --from0 --files-from=- -r "$ROOT/" "$GATES_REMOTE:$RWORK/" \
        || return 1
    if [ -f "$ROOT/.git" ]; then
        local common gitdir
        common="$(git rev-parse --path-format=absolute --git-common-dir)"
        gitdir="$(git rev-parse --path-format=absolute --git-dir)"
        ssh "$GATES_REMOTE" "rm -f '$RWORK/.git' 2>/dev/null; mkdir -p '$RWORK/.git'" || return 1
        rsync -a --no-owner --no-group --delete --exclude='/worktrees/' --exclude='/soulledger-*' \
            "$common/" "$GATES_REMOTE:$RWORK/.git/" || return 1
        rsync -a --no-owner --no-group "$gitdir/HEAD" "$gitdir/index" "$GATES_REMOTE:$RWORK/.git/" || return 1
    fi
    # --delete never fires under --files-from: a file deleted here is simply absent from the list, so the
    # remote copy stayed and kept running (2026-10-29: a test deleted by a merge failed the gates there).
    # The synced .git no longer tracks it, so it shows up remotely as untracked; remove every such file
    # that is not one of this machine's own untracked files (those were just sent on purpose).
    local keep; keep=$(git ls-files -o --exclude-standard -- backend frontend packages mobile mobile-officer scripts)
    ssh "$GATES_REMOTE" "cd '$RWORK' && git ls-files -o --exclude-standard -- backend frontend packages mobile mobile-officer scripts" \
        | grep -vxF -f <(printf '%s\n' "$keep") \
        | ssh "$GATES_REMOTE" "cd '$RWORK' && xargs -r -d '\n' rm -f --"
}
# ── TIME LIMITS ON THE REMOTE MACHINE (2026-11-12, user decision) ────────────────────────────────
# Each delegated run has a total limit: selective gates 30 min, --full 90 min, E2E 20 min (and the demo
# 25 min, scripts/demo-remote.sh). GATES_REMOTE_TIMEOUT / GATES_REMOTE_FULL_TIMEOUT / GATES_REMOTE_E2E_TIMEOUT
# override, in GNU timeout's syntax (1800, 30m, 1.5h). The limit is enforced THERE, not here:
#   - `timeout` is the container's own command (under --init), so the run ends at the limit whether or not
#     this machine's ssh is still connected. It TERMs the run's whole process group, then KILLs after 60 s;
#     the container exits 124 (137 after the KILL).
#   - the lock is held by a subshell on that machine — `( flock 9; docker run …; docker rm -f <name> ) 9>lock`
#     — not by `flock <lock> docker run`. When this machine's ssh drops, the docker client there dies on its
#     next write (SIGPIPE) while the container runs on; before, flock then exited too and released the lock
#     with the old container still holding 12 cores. Now the subshell goes on to `docker rm -f`, so the lock
#     is released only once the container is gone. (No SIGHUP reaches it: ssh without a tty sends none.)
# The time spent waiting for the lock does not count: `timeout` starts inside the container.
#
# remote_flock <fd> <lock name> <container name prefix>… — the remote shell's words for "take this lock; when
# it is taken, say who has it, then wait" (2026-11-13, test review 3.5). The wait used to be silent — a plain
# `flock 9` — while this machine's gate-lock.sh reports every minute; a demo server left up held e2e.lock for
# hours and `--e2e` simply sat there. Who has it is read from the containers' names (sl-gates-, sl-e2e-,
# sl-demo-, sl-android-). scripts/demo-remote.sh and scripts/mobile-remote.sh carry copies, kept identical
# by TestRemoteLocksSayWhenTheyWait.
remote_flock() {
    local fd="$1" lock="$2" filters="" n; shift 2
    for n in "$@"; do filters="$filters --filter name=$n"; done
    printf '%s' "flock -n $fd || { echo \"$P: waiting for $lock on that machine, held by: \$(docker ps --format '{{.Names}} ({{.Status}})'$filters | paste -sd, -)\"; flock $fd; } || exit 1"
}
# remote_slots <container name prefix> — the gates' lock, with GATES_REMOTE_SLOTS (default 2, 2026-11-16 user
# decision) runs at once on that machine: slot 1 is fd 9 on run.lock, slot 2 fd 8 on run.2.lock (the caller opens
# both). Free slot first, without waiting; both taken: say who holds them, then try both every 10 s. A copy of
# this script from before the second slot takes run.lock only, so old and new share the machine correctly.
# GATES_REMOTE_SLOTS=1 is the single lock as it was (remote_flock 9 run.lock).
# The slot taken is left in $S (1 or 2; unset with one slot = 1) and goes to the container as SL_GATE_SLOT, which
# names the kept PG templates (config/testdb.py): a slot prunes only its own.
# A waiter whose ssh is gone gives up: ssh without a tty sends no SIGHUP, so on 2026-11-16 three runs whose agents
# had stopped them still sat in `flock 9` on that machine (parent: init) and would have started the moment the
# lock freed — one on the same tree as its agent's new run. Each retry checks the remote shell is not orphaned.
# Why two: four agents' gates queued behind one lock for an hour (2026-11-16) while the box had 20 cores. Each
# slot's container is capped lower (10 CPUs / 20 GB, 5 + 5 workers) so two fit beside Metro and the test PG.
remote_slots() {
    if [ "${WIN_BOTH:-0}" = 1 ]; then printf '%s; %s' "$(remote_flock 9 run.lock "$@")" "$(remote_flock 8 run.2.lock "$@")"; return; fi
    if [ "${GATES_REMOTE_SLOTS:-2}" = 1 ]; then remote_flock 9 run.lock "$@"; return; fi
    local filters="" n
    for n in "$@"; do filters="$filters --filter name=$n"; done
    printf '%s' "{ flock -n 9 && S=1; } || { flock -n 8 && S=2; } || { echo \"$P: both gate slots are taken on that machine, held by: \$(docker ps --format '{{.Names}} ({{.Status}})'$filters | paste -sd, -)\"; while :; do [ \"\$(ps -o ppid= -p \$\$ | tr -d ' ')\" != 1 ] || exit 1; sleep 10; { { flock -n 9 && S=1; } || { flock -n 8 && S=2; }; } && break; done; } || exit 1"
}
case "${GATES_REMOTE_SLOTS:-2}" in 1) SLOT_CPUS=12 SLOT_MEM=24g SLOT_WORKERS=6 ;; 2) SLOT_CPUS=10 SLOT_MEM=20g SLOT_WORKERS=5 ;;
    *) echo "gates: GATES_REMOTE_SLOTS=${GATES_REMOTE_SLOTS} — 1 or 2"; exit 2 ;; esac
remote_limit() {  # <value> <variable name>: refuse anything `timeout` would not read as a duration
    [[ "$1" =~ ^[0-9]+(\.[0-9]+)?[smhd]?$ ]] || { echo "$P: $2=$1 is not a time limit (e.g. 30m, 1800)"; exit 2; }
}
# remote_verdict <exit status> <limit> <variable> — say so when the remote run ended on the limit.
remote_verdict() {
    case "$1" in
        124) echo "$P: TIMED OUT on $GATES_REMOTE after $2 ($3 overrides). The run was stopped there (its container" \
                  "removed with docker rm -f) and the lock released; nothing of it is still running." ;;
        137) echo "$P: killed on $GATES_REMOTE (exit 137): either the time limit's KILL, 60 s after it ran out ($2," \
                  "$3), or the container's memory limit. The container is removed and the lock released." ;;
        75) echo "$P: REFUSED by $GATES_REMOTE: its work dir is too full and no unmounted tree could be deleted to make room" \
                  "(see the prune line above; GATES_REMOTE_MIN_FREE_MB). Nothing ran." ;;
    esac
}

# ── THE WINDOWS PC: A THIRD HOST WHEN UNRAID IS FULL AND THE PC IS IDLE (2026-11-17, user decision) ──
# GATES_REMOTE_WIN (.prepush.env) names an ssh host: sshd inside WSL on the PC, with docker, the same images and
# its own sl-pg-test. A gate run goes there when unRAID's slot 1 is held right now (the order: win_route) and the
# PC is idle: it answers, has the image, runs no other job of ours, and no game from GATES_REMOTE_WIN_GAMES runs
# (--e2e: when unRAID's e2e.lock is held). Otherwise nothing changes: the run goes to GATES_REMOTE exactly as
# before and takes a slot or waits there. A gate or an E2E run takes the whole PC: both its locks, run.lock and
# run.2.lock. `--tests` runs take one lock each, so two run at once (2026-11-20, user decision), each at
# GATES_REMOTE_WIN_TESTS_CPUS / _MEMORY (8 / 12g): a gate there is 16 CPUs and 24g, and WSL has 32 GB of which the
# trees' tmpfs holds up to 14, so two gates would not fit; two small runs do.
# The user's two conditions: (1) a game that starts during a run drops the run to nice 19 and
# GATES_REMOTE_WIN_GAME_CPUS CPUs — never stops it — and restores it when the game exits (win_watch, beside
# the container); a file `game-running` in GATES_REMOTE_WIN_DIR counts as a game, to prove that path.
# (2) the SSD: GATES_REMOTE_WIN_DIR is a tmpfs there (trees, node_modules, venv, logs), sl-pg-test keeps its
# data on tmpfs, and the container's /root and /tmp are tmpfs too (npm / pip caches, Chromium's profile).
WIN_DIR="${GATES_REMOTE_WIN_DIR:-/srv/sl-gates}"
WIN_GAMES="${GATES_REMOTE_WIN_GAMES:-YuanShen.exe GenshinImpact.exe}"
ELOCK=e2e.lock RUN_EXTRA="" WIN_WATCH=0 WIN_BOTH=0
# win_exe <program> <args…> — a Windows program from a shell sshd started, which has no WSL_INTEROP.
win_exe() {
    local s; for s in ${WSL_INTEROP:-} /run/WSL/*_interop; do
        [ -S "$s" ] && WSL_INTEROP="$s" timeout 20 "$@" 2>/dev/null && return 0
    done; return 1
}
# win_game <dir> <game.exe>… — prints the first listed game running on Windows (or the flag file); nothing if none.
win_game() {
    local d="$1" g tl; shift
    [ -e "$d/game-running" ] && { echo "game-running flag"; return 0; }
    tl=$(win_exe "${WIN_TASKLIST:-/mnt/c/Windows/System32/tasklist.exe}" /FO CSV /NH) || { echo "cannot ask Windows"; return 0; }
    for g in "$@"; do grep -qi "^\"$g\"" <<<"$tl" && { echo "$g"; return 0; }; done; return 0
}
# win_probe <whole|one> <dir> <image> <game.exe>… — on the PC: "idle" (no game, and both locks free for a whole-PC
# job, or one of them for a --tests run), or why not.
win_probe() {
    local want="$1" d="$2" img="$3" g; shift 3
    docker image inspect "$img" >/dev/null 2>&1 || { echo "no $img image"; return; }
    mkdir -p "$d" || { echo "no $d"; return; }
    if [ "$want" = one ]; then
        { ( flock -n 9 ) 9>"$d/run.lock" || ( flock -n 9 ) 9>"$d/run.2.lock"; } || { echo "already running two jobs of ours"; return; }
    else
        { ( flock -n 9 ) 9>"$d/run.lock" && ( flock -n 9 ) 9>"$d/run.2.lock"; } || { echo "already running a job of ours"; return; }
    fi
    g=$(win_game "$d" "$@"); [ -z "$g" ] || { echo "game: $g"; return; }
    echo idle
}
# win_watch <container> <dir> <cpus> <cpus while a game runs> <game.exe>… — on the PC, beside the run, until the
# container is gone. Processes forked later inherit nice 19 from their parents; each pass renices again anyway.
win_watch() {
    local c="$1" d="$2" hi="$3" lo="$4" low=0 seen=0 g; shift 4
    while :; do
        if docker inspect "$c" >/dev/null 2>&1; then seen=1; elif [ $seen = 1 ]; then return; fi
        g=$(win_game "$d" "$@")
        if [ -n "$g" ] && [ $seen = 1 ]; then
            docker top "$c" -eo pid | tail -n +2 | xargs -r renice -n 19 -p >/dev/null 2>&1
            [ $low = 1 ] || { docker update --cpus "$lo" "$c" >/dev/null && low=1 \
                && echo "gates: $g on the PC — the run there drops to nice 19 and $lo CPUs until it exits"; }
        elif [ $low = 1 ] && [ $seen = 1 ]; then
            docker top "$c" -eo pid | tail -n +2 | xargs -r renice -n 0 -p >/dev/null 2>&1
            docker update --cpus "$hi" "$c" >/dev/null && low=0 && echo "gates: no game on the PC — the run there is back to $hi CPUs"
        fi
        sleep "${WIN_WATCH_EVERY:-15}"
    done
}
# win_bg <container> <cpus> — the remote shell's words that start win_watch beside the run (empty off the PC).
win_bg() {
    [ "$WIN_WATCH" = 1 ] || return 0
    printf '%s\n( win_watch %s %s %s %s %s ) & W=$!; ' "$(declare -f win_exe win_game win_watch)" \
        "$1" "$WIN_DIR" "$2" "${GATES_REMOTE_WIN_GAME_CPUS:-4}" "$WIN_GAMES"
}
win_bg_end() { [ "$WIN_WATCH" = 1 ] && printf '%s' 'kill $W 2>/dev/null; '; return 0; }
# win_route <gate|tests|e2e> <image> — point GATES_REMOTE (and its dir, database, sizes) at the PC when the rule holds.
# THE ORDER A GATE RUN TAKES (2026-11-17, user decision): unRAID slot 1 (run.lock) free → unRAID; else the PC if
# idle → the PC; else unRAID, where remote_slots takes slot 2 or queues as before. A run the PC turned down (a game,
# a job of ours there) goes to unRAID and stays there, even if the game ends. --e2e: the PC only when unRAID's
# e2e.lock is held. Each run prints its choice: `slot: …`.
win_route() {
    [ -n "${GATES_REMOTE_WIN:-}" ] && [ -n "${GATES_REMOTE:-}" ] || return 1
    local lock=e2e.lock what="e2e.lock" state why url where
    [ "$1" != e2e ] && lock=run.lock what="slot 1"
    local want=whole; [ "$1" = tests ] && want=one
    state=$(ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE" "flock -n $RDIR/$lock true && echo free || echo busy" 2>/dev/null)
    if [ "$state" != busy ] && [ "${GATES_REMOTE_WIN_FORCE:-}" != 1 ]; then  # FORCE: try the PC whatever unRAID has free
        echo "$P: slot: $GATES_REMOTE ($GATES_REMOTE $what ${state:-unknown})"; return 1
    fi
    why=$(ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE_WIN" \
        "$(declare -f win_exe win_game win_probe); win_probe $want $WIN_DIR $2 $WIN_GAMES" 2>/dev/null)
    if [ "$why" != idle ]; then
        [ "$1" != e2e ] && where="$GATES_REMOTE slot 2, or its queue" || where="$GATES_REMOTE, its e2e.lock queue"
        echo "$P: slot: $where ($GATES_REMOTE $what $state, $GATES_REMOTE_WIN not used: ${why:-unreachable})"; return 1
    fi
    if [ "$1" != e2e ]; then
        url="${GATES_REMOTE_WIN_DB_URL:-$(ssh -o BatchMode=yes "$GATES_REMOTE_WIN" cat /etc/sl-gates/pg.url 2>/dev/null)}"
        [ -n "$url" ] || { echo "$P: not using $GATES_REMOTE_WIN: no GATES_REMOTE_WIN_DB_URL and no /etc/sl-gates/pg.url there"; return 1; }
        GATES_REMOTE_DB_URL="$url"
    fi
    echo "$P: slot: $GATES_REMOTE_WIN ($GATES_REMOTE $what $state${GATES_REMOTE_WIN_FORCE:+, GATES_REMOTE_WIN_FORCE=1}, win idle)"
    GATES_REMOTE="$GATES_REMOTE_WIN" RDIR="$WIN_DIR" RWORK="$WIN_DIR/work/$RID" GATES_REMOTE_SLOTS=1 ELOCK=run.lock WIN_WATCH=1
    SLOT_CPUS="${GATES_REMOTE_WIN_CPUS:-16}" SLOT_MEM="${GATES_REMOTE_WIN_MEMORY:-24g}" SLOT_WORKERS="${GATES_REMOTE_WIN_WORKERS:-6}" WIN_BOTH=1
    if [ "$1" = tests ]; then
        GATES_REMOTE_SLOTS=2 WIN_BOTH=0
        SLOT_CPUS="${GATES_REMOTE_WIN_TESTS_CPUS:-8}" SLOT_MEM="${GATES_REMOTE_WIN_TESTS_MEMORY:-12g}" SLOT_WORKERS="${GATES_REMOTE_WIN_TESTS_WORKERS:-4}"
    fi
    GATES_REMOTE_CPUS="$SLOT_CPUS" GATES_REMOTE_MEMORY="$SLOT_MEM" GATES_REMOTE_E2E_CPUS="$SLOT_CPUS" GATES_REMOTE_E2E_MEMORY="$SLOT_MEM"
    GATES_REMOTE_PYTEST_WORKERS="$SLOT_WORKERS" GATES_REMOTE_JS_WORKERS="$SLOT_WORKERS"
    RUN_EXTRA=" --tmpfs /root:rw,exec,size=4g --tmpfs /tmp:rw,exec,size=4g"
}

# ── SYNCED TREES NOBODY USES ARE DELETED THERE (2026-11-13, test review 3.5) ─────────────────────
# Each checkout leaves up to four trees on the remote machine — work/<id> (the gates), work/<id>-e2e,
# work/demo-<hash> and android/work/<id> — each with its own node_modules (and venv), and nothing ever
# removed them: a worktree that pushed once left its trees there for good. A delegated gate run now deletes
# the trees under $RDIR/work and $RDIR/android/work that no run has used for GATES_REMOTE_PRUNE_DAYS days
# (default 14; 0 turns it off; GATES_REMOTE_PRUNE_DRY=1 only says what it would delete).
#   - "Used" is the tree's .sl-last-use, touched by every run that uses the tree (here, --e2e,
#     scripts/demo-remote.sh, scripts/mobile-remote.sh) BEFORE it syncs. Not the directory's own mtime: rsync
#     sets that from this machine's. A tree with no mark yet (older than this rule) is marked now, not
#     deleted, so it goes after the full period.
#   - Never this run's own tree, and never a tree some container mounts, running or stopped (a Metro left up
#     for weeks takes no lock and syncs nothing). If docker cannot be asked, nothing is deleted.
#   - It runs on that machine inside the subshell that holds a gate slot, before the container starts, under its
#     own prune.lock, so only one prune runs at a time even with two slots. It cannot fail the run.
# remote_prune's text is sent as it stands (declare -f): it runs in the REMOTE host's shell, so it uses only
# its arguments. ponytail: between reading a mark and `rm -rf`, another checkout's first run in two weeks
# could touch that mark and start syncing — a window of milliseconds once per idle tree; that run would go
# red on a half-deleted tree and pass on retry. A per-tree lock taken by every sync would close it.
remote_prune() {  # <RDIR> <this run's tree> <days> <dry: 1 = only report> [<free KB the host must have; default 3 GB>]
    local rdir="$1" keep="$2" days="$3" dry="$4" want="${5:-3145728}" ids used="" t real mark kept=0 have own marks m
    case "$rdir" in /?*) ;; *) echo "    (prune: $rdir is not an absolute path — nothing deleted)"; return 0 ;; esac
    ids=$(docker ps -aq) || { echo "    (prune: docker ps failed, so what is mounted is unknown — nothing deleted)"; ids=-; }
    if [ "$ids" != - ] && [ -n "$ids" ]; then
        # shellcheck disable=SC2086
        used=$(docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' $ids) \
            || { echo "    (prune: docker inspect failed, so what is mounted is unknown — nothing deleted)"; ids=-; }
    fi
    if [ "$ids" != - ] && [ "$days" -gt 0 ] 2>/dev/null; then
        for t in "$rdir"/work/* "$rdir"/android/work/*; do
            [ -d "$t" ] && [ ! -L "$t" ] || continue
            [ "$t" = "$keep" ] && continue
            real=$(cd "$t" && pwd -P) || continue
            if printf '%s\n' "$used" | grep -qxF -e "$t" -e "$real"; then
                echo "    (prune: kept $t — a container mounts it)"; continue
            fi
            mark="$t/.sl-last-use"
            if [ ! -e "$mark" ]; then
                touch "$mark"; echo "    (prune: $t had no last-use mark — marked now; deleted after $days days without a run)"; continue
            fi
            if [ -z "$(find "$mark" -mmin +$((days * 1440)))" ]; then kept=$((kept + 1)); continue; fi
            if [ "$dry" = 1 ]; then
                echo "    (prune: would delete $t — no run for $days days; GATES_REMOTE_PRUNE_DRY=1, nothing deleted)"
            else
                rm -rf -- "$t" && echo "    (prune: deleted $t — no run for $days days)"
            fi
        done
        echo "    (prune: $kept other synced trees used within $days days kept — GATES_REMOTE_PRUNE_DAYS)"
    fi
    # SPACE (2026-11-19): the Windows PC's work dir is a 14 GB tmpfs that about six trees fill, and a full disk
    # fails mid-`npm ci` or kills pytest workers. Needed: $want KB, or this tree's size + 1 GB if that is more.
    # Short of it, the least recently used trees no container mounts go first (the days rule above stays for
    # unRAID's big disk), never this run's own, until it fits; if it cannot, the run is refused (return 1)
    # before it starts. Under GATES_REMOTE_PRUNE_DRY=1 it only says what it would delete.
    own=$(du -sk "$keep" 2>/dev/null | awk '{print $1}'); own=$(( ${own:-0} + 1048576 )); [ "$own" -gt "$want" ] && want="$own"
    have=$(df -Pk "$rdir" 2>/dev/null | awk 'NR==2 {print $4}'); [ -n "$have" ] || return 0
    [ "$have" -ge "$want" ] && return 0
    if [ "$ids" = - ]; then
        echo "    (prune: REFUSED — only $((have / 1024)) MB free under $rdir, $((want / 1024)) MB needed, and what is mounted is unknown)"; return 1
    fi
    marks=$(ls -1tr -- "$rdir"/work/*/.sl-last-use "$rdir"/android/work/*/.sl-last-use 2>/dev/null)
    for t in "$rdir"/work/* "$rdir"/android/work/*; do  # unmarked trees count as the oldest
        if [ -d "$t" ] && [ ! -e "$t/.sl-last-use" ]; then marks="$t/.sl-last-use
$marks"; fi
    done
    while IFS= read -r m; do
        [ -n "$m" ] || continue
        t="${m%/.sl-last-use}"
        { [ -d "$t" ] && [ ! -L "$t" ] && [ "$t" != "$keep" ]; } || continue
        real=$(cd "$t" && pwd -P) || continue
        if printf '%s\n' "$used" | grep -qxF -e "$t" -e "$real"; then continue; fi
        if [ "$dry" = 1 ]; then
            echo "    (prune: would delete $t — only $((have / 1024)) MB free, $((want / 1024)) MB needed; GATES_REMOTE_PRUNE_DRY=1, nothing deleted)"; continue
        fi
        rm -rf -- "$t" && echo "    (prune: deleted $t — only $((have / 1024)) MB free under $rdir, $((want / 1024)) MB needed)"
        have=$(df -Pk "$rdir" 2>/dev/null | awk 'NR==2 {print $4}')
        if [ -n "$have" ] && [ "$have" -ge "$want" ]; then return 0; fi
    done <<EOF_MARKS
$marks
EOF_MARKS
    [ "$dry" = 1 ] && return 0
    echo "    (prune: REFUSED — $((have / 1024)) MB free under $rdir, $((want / 1024)) MB needed, and no unmounted tree but this run's own is left to delete; free space there, or lower GATES_REMOTE_MIN_FREE_MB)"
    return 1
}
PRUNE_DAYS="${GATES_REMOTE_PRUNE_DAYS:-14}"
[[ "$PRUNE_DAYS" =~ ^[0-9]+$ ]] || { echo "$P: GATES_REMOTE_PRUNE_DAYS=$PRUNE_DAYS is not a number of days (0 turns the pruning off)"; exit 2; }
PRUNE_DRY=0; [ "${GATES_REMOTE_PRUNE_DRY:-}" = 1 ] && PRUNE_DRY=1
PRUNE_MIN_KB=$(( ${GATES_REMOTE_MIN_FREE_MB:-3072} * 1024 ))  # free space the work dir must have (remote_prune)

# Installed in the synced tree by whichever container runs first, and only when its inputs change — two
# hashes, decided apart (2026-10-30): a version bump in one package.json used to reinstall node_modules AND
# rebuild the venv from nothing. JS: the dependency fields of every package.json (not "version", "scripts"
# …) and the lockfile. Python: requirements.lock and requirements-dev.txt; the venv is kept and synced to
# them (pip install, then anything not in them uninstalled), not deleted. Both name the BASE image (RIMG),
# so the E2E image built on it does not force a reinstall. deps_hash_js is a function for its test.
deps_hash_js() {
    git ls-files -z -- package-lock.json '*package.json' | xargs -0 python3 -I -c '
import json, sys
fields = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "workspaces")
for path in sys.argv[1:]:
    data = json.load(open(path, encoding="utf-8"))
    if path.endswith("package-lock.json"):
        print(path, json.dumps(data, sort_keys=True))
    else:
        print(path, json.dumps({k: data.get(k) for k in fields}, sort_keys=True))
' || echo "unreadable $(date +%s%N)"
    echo "$RIMG"
}
DEPS_JS=$(deps_hash_js | shasum | cut -c1-16)
DEPS_PY=$( { git ls-files -z -- backend/requirements.lock backend/requirements-dev.txt | xargs -0 cat; echo "$RIMG"; } | shasum | cut -c1-16)
# Runs inside the container (no single quotes: it is spliced into a single-quoted bash -c).
REMOTE_DEPS='
          if [ -n "$SL_DEPS_JS" ] && [ "$(cat .sl-deps-js 2>/dev/null)" != "$SL_DEPS_JS" ]; then  # empty: --tests, no JS
            echo "    (installing node_modules — the JS dependencies changed)"
            { npx -y npm@11 ci --no-audit --no-fund --loglevel=error && { npm rebuild @parcel/watcher unrs-resolver @sentry/cli >/dev/null 2>&1 || true; } \
              && git checkout -- package-lock.json; } >/tmp/deps-js.log 2>&1 \
              || { tail -20 /tmp/deps-js.log; echo "gates: could not install the JS dependencies"; exit 1; }
            echo "$SL_DEPS_JS" > .sl-deps-js
          fi
          if [ "$(cat .sl-deps-py 2>/dev/null)" != "$SL_DEPS_PY" ]; then
            echo "    (syncing backend/.venv — the Python requirements changed)"
            { { [ -x backend/.venv/bin/python ] || python3 -m venv backend/.venv; } \
              && backend/.venv/bin/pip install -q --no-deps -r backend/requirements.lock -r backend/requirements-dev.txt \
              && backend/.venv/bin/python scripts/venv-extras.py backend/requirements.lock backend/requirements-dev.txt \
                 | xargs -r backend/.venv/bin/pip uninstall -q -y; } >/tmp/deps-py.log 2>&1 \
              || { tail -20 /tmp/deps-py.log; echo "gates: could not sync backend/.venv"; exit 1; }
            echo "$SL_DEPS_PY" > .sl-deps-py
          fi'

# remote_gate_run <container name> <time limit> <commands> — run <commands> in /app of the synced tree, in a gate
# slot on $GATES_REMOTE (remote_slots), under the limit, after the dependencies (REMOTE_DEPS). The delegated gates
# and --tests share it, so a --tests run queues behind a gate run and never runs beside one in its slot.
remote_gate_run() {
    ssh -o BatchMode=yes "$GATES_REMOTE" "( $(remote_slots sl-gates-); $(declare -f remote_prune); ( flock 7; remote_prune $RDIR $RWORK $PRUNE_DAYS $PRUNE_DRY $PRUNE_MIN_KB ) 7>$RDIR/prune.lock || exit 75; $(win_bg $1 ${GATES_REMOTE_CPUS:-$SLOT_CPUS})docker run --rm --init --name $1$RUN_EXTRA \
        --network ${GATES_REMOTE_NET:-sl-gates} --cpus ${GATES_REMOTE_CPUS:-$SLOT_CPUS} --memory ${GATES_REMOTE_MEMORY:-$SLOT_MEM} \
        -v $RWORK:/app -w /app -e GATES_IN_REMOTE=1 -e SL_GATE_SLOT=\${S:-1} -e GATES_QOS=none -e GATE_LOCK=0 -e GATES_FULL=${GATES_FULL:-} -e GATES_SIDES=$GATES_SIDES \
        -e JEST_WORKERS=${GATES_REMOTE_JS_WORKERS:-$SLOT_WORKERS} -e VITEST_WORKERS=${GATES_REMOTE_JS_WORKERS:-$SLOT_WORKERS} -e PYTEST_WORKERS=${GATES_REMOTE_PYTEST_WORKERS:-$SLOT_WORKERS} \
        -e DATABASE_URL='$GATES_REMOTE_DB_URL' -e GATES_PG_URL='$GATES_REMOTE_DB_URL' -e SL_DEPS_JS=$DEPS_JS -e SL_DEPS_PY=$DEPS_PY \
        -v $RDIR/tmp/$RID:/sl-tmp -e TMPDIR=/sl-tmp $RIMG timeout -k 60 $2 bash -c '
          find /sl-tmp -mindepth 1 -mmin +1440 -delete 2>/dev/null
          $REMOTE_DEPS
          $3'; rc=\$?; $(win_bg_end)docker rm -f $1 >/dev/null 2>&1; exit \$rc ) 8>$RDIR/run.2.lock 9>$RDIR/run.lock"
}

# remote_e2e_run <container name> <time limit> <image> — the Playwright run (--e2e) for the projects in $E2E, in
# the synced tree $RWORK on $GATES_REMOTE, under e2e.lock ($ELOCK: run.lock and run.2.lock on the PC, which
# takes the whole machine), after the dependencies (REMOTE_DEPS). Its exit status is the run's.
remote_e2e_run() {
    local ENAME="$1" ELIMIT="$2" EIMG="$3"
    # /tmp in memory, as in scripts/demo-remote.sh: Chromium's profile and cache on the shared btrfs image stalled
    # frames for 5–19 s under load (2026-11-08 trace evidence there).
    # The lock and the time limit: TIME LIMITS ON THE REMOTE MACHINE, above.
    ssh -o BatchMode=yes "$GATES_REMOTE" "( $(remote_flock 9 $ELOCK sl-e2e- sl-demo-); $([ "${WIN_BOTH:-0}" = 1 ] && remote_flock 8 run.2.lock sl-gates- sl-e2e-; [ "${WIN_BOTH:-0}" = 1 ] && printf '; ')$(win_bg $ENAME ${GATES_REMOTE_E2E_CPUS:-8})docker run --rm --init --name $ENAME$RUN_EXTRA \
        --tmpfs /tmp:rw,exec,size=8g --cpus ${GATES_REMOTE_E2E_CPUS:-8} --memory ${GATES_REMOTE_E2E_MEMORY:-16g} --shm-size 2g \
        -v $RWORK:/app -v $RDIR/tmp/$RID:/sl-tmp -w /app -e SL_DEPS_JS=$DEPS_JS -e SL_DEPS_PY=$DEPS_PY -e PW_WORKERS=${GATES_REMOTE_PW_WORKERS:-4} \
        -e PROJECTS='$E2E' $EIMG timeout -k 60 $ELIMIT bash -c '$REMOTE_DEPS
          cd frontend && npm run build > /sl-tmp/e2e-build.log 2>&1 || { tail -30 /sl-tmp/e2e-build.log; echo \"e2e: next build failed\"; exit 1; }
          PF=\"\"; for p in \$(echo \$PROJECTS | tr , \" \"); do PF=\"\$PF --project=\$p\"; done
          T=\$(date +%s); rm -f /sl-tmp/e2e.json
          PLAYWRIGHT_JSON_OUTPUT_NAME=/sl-tmp/e2e.json npx playwright test \$PF --reporter=line,json --retries=1 > /sl-tmp/e2e.log 2>&1
          rc=\$?
          echo \"  → \$PROJECTS in one run (\$(( \$(date +%s) - T ))s)\"
          python3 /app/scripts/e2e-report.py /sl-tmp/e2e.json \$(echo \$PROJECTS | tr , \" \") \
            || { tail -30 /sl-tmp/e2e.log; [ \$rc -eq 0 ] && rc=1; }
          exit \$rc'; rc=\$?; $(win_bg_end)docker rm -f $ENAME >/dev/null 2>&1; exit \$rc ) 8>$RDIR/run.2.lock 9>$RDIR/$ELOCK"
}
