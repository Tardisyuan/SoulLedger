#!/bin/bash
# scripts/run-gates.sh — the gates `.git/hooks/pre-push` runs, runnable by hand.
#
#   scripts/run-gates.sh [--full] [--base <ref>]              the gates for what changed
#   scripts/run-gates.sh --real-pg [--full]                    backend pytest on real PostgreSQL
#   scripts/run-gates.sh --e2e[=auto|all|<project>,...]        Playwright, on GATES_REMOTE only
#   scripts/run-gates.sh [--real-pg] [--workers N] [--timeout 20m] --tests <pytest args…>
#                                                              chosen pytest on GATES_REMOTE, not a gate (TESTS ON
#                                                              THE GATE HOSTS, below)
#
# TWO SIDES, EACH WITH ITS OWN LEDGER (2026-11-15, user decision). backend = ruff, makemigrations, pytest;
# JS = tsc and eslint of core / web / mobile / officer, then core vitest and the web, mobile and officer jest.
#   - A side that goes green is recorded - the tree and the files it covered - even when the other side
#     failed: <git common dir>/soulledger-gates-passed-backend and ...-js (a --full pass covers `*`).
#   - Each side picks its own base. With no --base: the latest of HEAD's last 300 commits whose tree that
#     side passed (a full pass, or selective passes covering that commit's changes against the merge-base
#     with origin/main), else the merge-base. The first lines say which base each side took and why.
#   - A push (the hook passes --prepush, and the pushed files in PREPUSH_CHANGED) is let through when both
#     sides' ledgers vouch for the pushed tree and its files; when only one side's do, only the other side
#     runs (2026-11-21). A green --real-pg run is recorded for the backend side too (record_side).
#     The whole-tree ledgers before 2026-11-15 (soulledger-gates-passed, ...-selective) are no longer read
#     (2026-11-21, user decision): none of their trees was among HEAD's last 300 commits.
#
# WHAT RUNS. Each side decides from its own changed files (the diff from its base, plus untracked files).
#   - backend: pytest by app (scripts/select-backend-tests.py) plus the tests listed in
#     backend/tests/reads-outside-backend.txt that read what changed; the whole suite when the selector says
#     so (settings, a conftest, dependencies, apps/core ...). The migration round trips
#     only when a migration or their harness changed.
#   - JS: the web jest by `--findRelatedTests` plus frontend/jest.always-run.txt (the tests that read files,
#     which the import graph cannot see); the two apps' jest the same way; tsc / eslint / vitest for each
#     area that changed. A rule in FULL_RULES (scripts/gates_classify.py) sends the web jest to a full run and says which.
#   Readers of the other side's files follow the changes in the side's own change set.
# FULL: `--full` or GATES_FULL=1 - everything, with the coverage floors. A push to main is NOT full
# (2026-10-24). Nothing forces selective (GATES_FULL=0 does not).
# ONE SIDE: GATES_SIDES=js or GATES_SIDES=backend (default both, 2026-11-15) runs that side only; the other
# prints that it was skipped and records nothing. Ignored on a push (a push runs the sides its ledgers do
# not vouch for); GATES_SIDES=js with
# --real-pg is refused. E.g. GATES_SIDES=js while a `--real-pg --full` covers the backend.
# --real-pg --full also runs the sharded group (--ds=config.settings_sharded -m sharded: four civilization
# shards, sharding stage 2; it replaced the multi-database guard and its test-only settings in stage 2), at
# the same time as the suite and under xdist: GATES_SHARDED_WORKERS of PYTEST_WORKERS (default a sixth: 2 of 11-12; its tests take ~2 min, the suite is the long pole).
#
# FAIL LATE (2026-11-15). Static checks run before a side's tests, but a red tsc / eslint / ruff /
# makemigrations no longer stops the side: its remaining steps run, every red step is listed at the end,
# and the run exits non-zero. One side failing never stops the other.
#
# WHERE. With GATES_REMOTE (.prepush.env) the whole run happens on that machine, the two sides side by
# side, under a time limit: 30 minutes, 90 when --full or when the backend resolves to its whole suite
# (GATES_REMOTE_TIMEOUT / GATES_REMOTE_FULL_TIMEOUT). This machine syncs, waits, and records the ledgers.
# Without GATES_REMOTE everything runs here, one step after another.
#
# WHY THIS EXISTS. CI runs daily, on v* tags and by hand (2026-10-30; it was
# `workflow_dispatch` only before), never on a push. The contract tests that
# accumulated here — the colour pins, the cross-end PAGE_SIZE pin, the seed
# inventory guard, the suite-shape floor — all exist to catch failures that are
# silent by nature. A silent failure caught by a check that nobody runs is still
# a silent failure.
#
# FAIL CLOSED, ALWAYS. If a check cannot run — tool missing, dependencies not
# installed — this refuses the push rather than skipping. A hook that skips what
# it cannot run reports a clean pass over nothing examined, which is precisely
# the defect class the tests above were written for; reproducing it in the thing
# that runs them would be the joke writing itself. The same goes for selection:
# when this script cannot tell what a change affects, it runs everything.
#
# TO BYPASS A PUSH: `SKIP_PREPUSH=1 git push` (handled in the hook).

set -u

# YIELD TO THE PERSON AT THE KEYBOARD (macOS). Re-run under the `utility` QoS
# clamp and nice 10: the gates still use every core while the machine is idle,
# and step aside when something in the foreground wants one. Before this a jest
# run alone took all eight cores and the desktop stuttered (2026-10-19).
# Not `background` (-b): that pins to the efficiency cores and throttles I/O, and
# timing-sensitive tests then fail for the wrong reason. GATES_QOS=none opts out;
# no taskpolicy (Linux, CI) runs as before. Children inherit both settings.
if [ -z "${GATES_QOS_APPLIED:-}" ] && [ "${GATES_QOS:-utility}" != none ] && command -v taskpolicy >/dev/null 2>&1; then
    export GATES_QOS_APPLIED=1
    exec taskpolicy -c "${GATES_QOS:-utility}" nice -n 10 bash "${BASH_SOURCE[0]}" "$@"
fi
# TWO WORKERS PER TEST RUNNER (2026-10-27, user decision). The QoS clamp above yields CPU but not memory:
# 4 pytest workers + 4 jsdom jest workers (up to 1 GB each) pushed this 16 GB Mac into swap and froze the
# desktop through four full runs in one evening. PYTEST_WORKERS / JEST_WORKERS / VITEST_WORKERS override.
export JEST_WORKERS="${JEST_WORKERS:-2}"
PYTEST_WORKERS="${PYTEST_WORKERS:-2}"
VITEST_WORKERS="${VITEST_WORKERS:-2}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREPUSH=0; MODE=auto; BASE=""; REAL_PG=0; E2E=""; TESTS=0; TESTS_FROM=""; TEST_ARGS=(); TESTS_LIMIT=20m; TESTS_WORKERS=""
# Everything after --tests is pytest's, except --real-pg (pytest has none: easy to put last), --workers N and
# --timeout T (2026-11-20: `--tests --workers 1 f.py` handed --workers to pytest, which stopped with a usage error,
# exit 4, before any test). Those three are read by the same lines before and after --tests.
IN_TESTS=0
while [ $# -gt 0 ]; do
    case "$1" in
        --real-pg)  REAL_PG=1 ;;
        --workers)  TESTS_WORKERS="${2:?--workers needs a number}"; shift
                    [[ "$TESTS_WORKERS" =~ ^[0-9]+$ ]] || { echo "run-gates: --workers takes a number (0 = serial)"; exit 2; } ;;
        --timeout)  TESTS_LIMIT="${2:?--timeout needs a time limit}"; shift ;;
        *) if [ "$IN_TESTS" = 1 ]; then TEST_ARGS+=("$1"); else case "$1" in
        --tests)    TESTS=1; IN_TESTS=1 ;;
        --tests-from) TESTS=1; TESTS_FROM="${2:?--tests-from needs a file}"; shift ;;  # the container's side
        --prepush)  PREPUSH=1 ;;
        --full)     MODE=full ;;
        --e2e)      E2E=chromium ;;
        --e2e=*)    E2E="${1#--e2e=}"; [ "$E2E" = all ] && E2E="chromium,firefox,mobile-chrome" ;;
        --base)     BASE="${2:?--base needs a ref}"; shift ;;
        -h|--help)  awk 'NR == 1 { next } !/^#/ { exit } { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; exit 0 ;;
        *)          echo "run-gates: unknown argument $1 (see --help)"; exit 2 ;;
        esac; fi ;;
    esac
    shift
done
P="gates"; [ "$PREPUSH" = 1 ] && P="pre-push"
# GATES_SIDES (2026-11-15, user decision): js | backend | both (default). The other side does not run, says
# so, and records nothing — e.g. GATES_SIDES=js while a `--real-pg --full` covers the backend. Not on a
# push: the hook runs the sides the ledgers do not vouch for (A PUSH OF A TREE ... below sets it), never by
# request (a delegated run, GATES_IN_REMOTE=1, takes what the caller passed it).
GATES_SIDES="${GATES_SIDES:-both}"
case "$GATES_SIDES" in
    both|js|backend) ;;
    *) echo "run-gates: GATES_SIDES must be js, backend or both, got '$GATES_SIDES'"; exit 2 ;;
esac
if [ "$GATES_SIDES" != both ] && [ "$PREPUSH" = 1 ] && [ "${GATES_IN_REMOTE:-0}" != 1 ]; then
    echo "$P: GATES_SIDES=$GATES_SIDES ignored on a push — the sides the ledgers do not vouch for run"; GATES_SIDES=both
fi
if [ "$GATES_SIDES" = js ] && [ "$REAL_PG" = 1 ]; then
    echo "run-gates: --real-pg runs only the backend; GATES_SIDES=js leaves it nothing to run"; exit 2
fi
side_on() { [ "$GATES_SIDES" = both ] || [ "$GATES_SIDES" = "$1" ]; }

ROOT="$(git rev-parse --show-toplevel)"
# The tree this run tests, read now: record_side at the end must not vouch for a HEAD that moved while the
# tests ran (2026-11-14: a run that tested 4323bdd5f recorded a6ca4d74e, six files it never saw).
START_TREE="$(git rev-parse HEAD^{tree} 2>/dev/null)"
cd "$ROOT" || exit 1

# Git runs hooks with GIT_DIR (and friends) in the environment. Every gate
# below inherits it, and a test that shells out to git from a subdirectory
# then treats that subdirectory as the repository root: `git ls-files -- app`
# run from frontend/ returned nothing, so designGuardContract reported every
# baseline file as untracked and refused the push (2026-09-25, twice) — while
# ledgerPaletteContract's `git grep` for leftover civilization tokens also
# found nothing and passed, green for the wrong reason. From here on git
# finds the repository from the working directory, as it does outside a hook.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY

# Optional per-machine settings, e.g. a DATABASE_URL for a developer whose
# default database is not usable for tests. Gitignored: it describes one
# machine, not the project.
#
# A WORKTREE HAS NO COPY OF IT. `$ROOT` is the worktree's own top level, and a
# gitignored file is not checked out there — so from any .claude/worktrees/*
# checkout this found nothing, PYTHON_BIN fell back to a bare `python` (anaconda
# base on this machine, no Django), and makemigrations below failed on
# `ModuleNotFoundError`. The push was refused as "a model changed without a
# migration" for a commit that touched no model (2026-09-11, twice). The main
# checkout's copy describes the same machine, so it is the fallback; a
# worktree's own copy still wins.
# The lookup is prepush_env in scripts/remote-common.sh, which demo-remote.sh and mobile-remote.sh use too, with
# the rest this script shares with them (the remote lock / limit words, the ledger line, two regexes). Fail closed,
# as for gates-remote.sh below.
[ -f "$HERE/remote-common.sh" ] || { echo "$P: no remote-common.sh beside $HERE/run-gates.sh — run scripts/install-hooks.sh. Refusing."; exit 1; }
. "$HERE/remote-common.sh"
# THE DECISION RULES ARE PYTHON (2026-11-26, user decision): scripts/gates_classify.py says what a change list
# runs (the sides, the readers, the forced-full reasons, --e2e=auto, the ledgers' verdicts). Stdlib only, beside
# this script (install-hooks.sh copies it). Fail closed, as for remote-common.sh.
[ -f "$HERE/gates_classify.py" ] || { echo "$P: no gates_classify.py beside $HERE/run-gates.sh — run scripts/install-hooks.sh. Refusing."; exit 1; }
gates_py() { python3 -I "$HERE/gates_classify.py" "$@"; }
MAIN_ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." 2>/dev/null && pwd)"
PREPUSH_ENV="$(prepush_env)"
if [ -n "$PREPUSH_ENV" ]; then
    echo "$P: per-machine settings from $PREPUSH_ENV"
    . "$PREPUSH_ENV"
fi

# ── THE REMOTE MACHINE (GATES_REMOTE): scripts/gates-remote.sh ─────────────────────────────────────
# Routing (unRAID slot 1 → the idle Windows PC → slot 2 / queue), games, ssh + rsync + flock + time limits,
# synced-tree pruning, the dependency hashes and the containers the delegated gates, --tests and --e2e run in.
# Fail closed, as for a missing tool: without it there is no telling where the run should go.
[ -f "$HERE/gates-remote.sh" ] || { echo "$P: no gates-remote.sh beside $HERE/run-gates.sh — run scripts/install-hooks.sh. Refusing."; exit 1; }
. "$HERE/gates-remote.sh"

# ── --e2e: PLAYWRIGHT ON THE REMOTE MACHINE (2026-10-28, user decision) ─────────────────────────
#
# `--e2e` runs chromium, `--e2e=all` the three projects, `--e2e=chromium,mobile-chrome` a list — the
# project rule in CLAUDE.md (everyday chromium; layout adds mobile-chrome; chromium + mobile-chrome before
# main — firefox is left to the daily CI since 2026-11-12, user decision; `--e2e=all` still runs all three).
# It builds (`next build`) and runs `playwright test` in the image GATES_REMOTE_E2E_IMAGE (the gate
# image plus Playwright 1.63's chromium and firefox), 4 workers, one retry: a test green on the retry
# is reported as flaky, by name, not hidden. Measured 2026-10-28 on the unRAID box: build 31 s,
# chromium 236 passed in 70 s, firefox 236 in 88 s, mobile-chrome 228 + 1 flaky in 115 s — against
# 3.6 / 7.9 / 4.5 minutes here on 10-27. Never on this machine: no GATES_REMOTE, no E2E.
# One `playwright test` for all the projects (2026-10-30): one `next start`, and the workers move on to
# the next project's tests instead of idling at each project's tail. Per-project passed / failed / flaky,
# and the failed and flaky tests by name, come from the json reporter (scripts/e2e-report.py).
#
# A PASS IS RECORDED (2026-11-12, user decision), as the gates' are: a green E2E run on a clean checkout
# (tree_is_clean) appends HEAD's tree and the projects it ran to $STAMP-e2e; an E2E run asking for
# projects that tree already passed — in one run or several — prints "already passed" and exits 0.
# A dirty checkout neither skips nor records (what runs there is not HEAD's tree). FORCE=1 runs anyway.
# tree_is_clean — tracked files equal HEAD, and no untracked file where the sync sends it (remote_sync's
# directories) or a gate reads it. Sets CLEAN_WHY when not. Shared with record_side below.
tree_is_clean() {
    CLEAN_WHY=""
    if ! git -C "$ROOT" diff --quiet HEAD --; then CLEAN_WHY="tracked files differ from HEAD"; return 1; fi
    local stray
    stray="$(git -C "$ROOT" ls-files --others --exclude-standard -- backend frontend packages mobile mobile-officer scripts | head -3)"
    [ -z "$stray" ] || { CLEAN_WHY="untracked files a gate may have read: $(echo "$stray" | tr '\n' ' ')"; return 1; }
}
# The pass ledgers. GATES_STAMP_FILE is the test seam.
#   $STAMP-backend, $STAMP-js   (2026-11-15) one per side, written by record_side at the end:
#                               <tree> TAB <date, commit> TAB <covered files, |-separated, or * for --full>
#   $STAMP itself (no suffix) and $STAMP-selective were the whole-tree ledgers before 2026-11-15. Neither is
#                               written or read any more (2026-11-21, user decision); $STAMP is only the prefix.
#   $STAMP-e2e                  the browser suites' (--e2e), unchanged.
STAMP="${GATES_STAMP_FILE:-$(git rev-parse --path-format=absolute --git-common-dir)/soulledger-gates-passed}"
E2E_STAMP="$STAMP-e2e"

# side_proves <backend|js> <tree> <files, one per line | "-"> — do the ledgers vouch for this side on <tree>
# for these changed files? A full pass always does (`*` in the side's ledger); selective passes do when
# the files they covered, all the tree's lines in the side's ledger united, include every one of <files>. "-" asks for a full pass only. Sets PROVEN_KIND (full / selective).
side_proves() {
    PROVEN_KIND=""
    [ -f "$STAMP-$1" ] || return 1
    PROVEN_KIND="$(printf '%s' "$3" | gates_py proves "$STAMP-$1" "$2")"
    [ -n "$PROVEN_KIND" ]
}

# WHAT CHANGED. The hook passes the pushed range's files in PREPUSH_CHANGED (one
# path per line, `git diff --no-renames`, so a rename shows its old path as
# deleted). PREPUSH_CHANGED is also the test seam, with PREPUSH_CLASSIFY_ONLY=1,
# which prints the decisions and exits before running any gate — both exist for
# `backend/tests/test_prepush_runs_the_gates_a_change_can_break.py`. A delegated run is handed each side's
# list as well (PREPUSH_CHANGED_BACKEND / PREPUSH_CHANGED_JS, DELEGATED RUNS below).
# THE BASE IS THE LAST TREE THAT PASSED (2026-11-14, user decision) — PER SIDE (2026-11-15, user decision).
# With no --base, each side compares against the most recent of the last 300 commits reachable from HEAD whose
# tree that side's ledgers vouch for, not the merge-base with origin/main. A long branch's diff against main
# hits a force-full rule (gate scripts, config, a deleted file, a migration) forever, so a one-file follow-up
# ran the whole suite (~45 minutes on unRAID, mostly migration round trips); now it runs what changed since the
# last green tree. And per side because one run often greens one side only: r31/r34/r35 (2026-11-15) re-ran
# 20–40 minutes of a green backend because the JS side of the same run was red. Which records count:
#   - a FULL pass: always — it tested the whole tree;
#   - SELECTIVE passes: only when the files they covered (all records for that tree, united) include every
#     file that commit changes against the merge-base. A selective pass vouches for the files it covered and
#     nothing else; without the check, a run with an explicit --base that skipped a stretch of the branch
#     would become a base and that stretch would never be gated. A side whose base came from here records
#     diff(merge-base, HEAD) as covered (COVERED_*, below), so the chain passes its own check.
#     The trade-off left is the selective gating's own, already accepted (CLAUDE.md, Build & Test): a test
#     is trusted to be unaffected by files outside what selected it.
# Not for --full / GATES_FULL=1, --real-pg (a SQLite pass says nothing about PostgreSQL) or --e2e (gate
# passes say nothing about browsers; E2E has its own ledger). A push (PREPUSH_CHANGED) is unchanged: the
# hook compares with the remote ref being pushed over. No record found: the merge-base, as before.
# One line per side says which base it took and why. The walk is gates_classify.py's side_base (2026-11-27);
# should that fail, the merge-base, which runs more, never less.
side_base() {  # <backend|js> → SIDE_BASE (empty: none) and SIDE_WHY
    local out
    SIDE_BASE=""; SIDE_WHY="; gates_classify.py side-base failed"
    out="$(gates_py side-base "$STAMP-$1" "$MB")" && eval "$out"
}
changed_since_base() {
    if [ -n "${PREPUSH_CHANGED+x}" ]; then
        CHANGED="$PREPUSH_CHANGED"
        CHANGED_BE="${PREPUSH_CHANGED_BACKEND-$CHANGED}"; CHANGED_JS="${PREPUSH_CHANGED_JS-$CHANGED}"
        COVERED_BE="$CHANGED_BE"; COVERED_JS="$CHANGED_JS"
        RANGE="${PREPUSH_RANGE:-(PREPUSH_CHANGED)}"
        return 0
    fi
    local side ledger=0 from_be=0 from_js=0
    if [ -n "$BASE" ]; then
        git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "$P: --base $BASE is not a commit"; exit 2; }
        BASE_BE="$BASE"; BASE_JS="$BASE"; MB=""   # an explicit base: nothing to extend the coverage with
    else
        MB="$(git merge-base HEAD origin/main 2>/dev/null || true)"
        [ -z "$E2E" ] && [ "$REAL_PG" = 0 ] && [ "$MODE" != full ] && [ "${GATES_FULL:-}" != 1 ] && ledger=1
        for side in backend js; do
            SIDE_BASE=""; SIDE_WHY=""
            [ "$ledger" = 1 ] && side_base "$side"
            if [ -n "$SIDE_BASE" ]; then
                echo "$P: $side base: $(git rev-parse --short "$SIDE_BASE") ($SIDE_WHY) — $(git rev-list --count "$SIDE_BASE..HEAD") commits since"
                [ "$side" = backend ] && from_be=1 || from_js=1
            else
                [ -n "$MB" ] || { echo "$P: no merge-base with origin/main; pass --base <ref>"; exit 2; }
                SIDE_BASE="$MB"
                echo "$P: $side base: $(git rev-parse --short "$MB") (merge-base with origin/main${SIDE_WHY})"
            fi
            [ "$side" = backend ] && BASE_BE="$SIDE_BASE" || BASE_JS="$SIDE_BASE"
        done
    fi
    CHANGED_BE="$( { git diff --name-only --no-renames "$BASE_BE"; git ls-files --others --exclude-standard; } | sort -u)"
    CHANGED_JS="$CHANGED_BE"
    [ "$BASE_JS" = "$BASE_BE" ] \
        || CHANGED_JS="$( { git diff --name-only --no-renames "$BASE_JS"; git ls-files --others --exclude-standard; } | sort -u)"
    CHANGED="$(printf '%s\n%s\n' "$CHANGED_BE" "$CHANGED_JS" | grep -v '^$' | sort -u)"
    if [ "$BASE_JS" = "$BASE_BE" ]; then RANGE="$(git rev-parse --short "$BASE_BE")..(working tree)"
    else RANGE="backend $(git rev-parse --short "$BASE_BE").., JS $(git rev-parse --short "$BASE_JS")..(working tree)"; fi
    # What a side's pass vouches for (record_side): its base vouched for diff(MB, base), this run tests
    # diff(base, HEAD), and diff(MB, HEAD) lies within the two.
    COVERED_BE="$CHANGED_BE"; COVERED_JS="$CHANGED_JS"
    local branch=""
    [ -n "$MB" ] && branch="$(git diff --name-only --no-renames "$MB" HEAD)"
    [ "$from_be" = 1 ] && [ -n "$MB" ] && COVERED_BE="$(printf '%s\n%s\n' "$CHANGED_BE" "$branch" | grep -v '^$' | sort -u)"
    [ "$from_js" = 1 ] && [ -n "$MB" ] && COVERED_JS="$(printf '%s\n%s\n' "$CHANGED_JS" "$branch" | grep -v '^$' | sort -u)"
    return 0
}
# --e2e=auto (2026-11-12, user decision): browsers only when the change can reach them. The change list is
# the selective gates' (changed_since_base: the diff against --base, default the merge-base with
# origin/main, plus untracked files). E2E serves the frontend build with mocked API fixtures (no backend):
# what it can see — frontend/, packages/core/, the JS dependency tree, its own runner and, failing closed, any
# root-level file not on INERT_ROOT_RE — less what no browser loads (unit tests, the jest / vitest / eslint
# configuration, documentation, the demo's specs and recordings) is E2E_AUTO_RE / E2E_BLIND_RE in
# scripts/gates_classify.py. `next build` type-checks the test files too, but `tsc --noEmit` in the ordinary
# gates fails on them first. Nothing of that changed → print why and exit 0. Something did →
# chromium + mobile-chrome, the set CLAUDE.md asks for before main. An explicit list always runs.
if [ "$E2E" = auto ]; then
    changed_since_base
    HIT="$(echo "$CHANGED" | gates_py e2e-auto)" || { echo "$P: gates_classify.py e2e-auto failed — refusing to guess"; exit 1; }
    if [ -z "$HIT" ]; then
        echo "$P: --e2e=auto: nothing in $RANGE reaches the browser suites (no frontend/ or packages/core/ file a browser loads, JS dependency, E2E runner or unknown root-level file changed) — not running E2E"
        exit 0
    fi
    echo "$P: --e2e=auto: $HIT changed — chromium + mobile-chrome"
    E2E="chromium,mobile-chrome"
fi
if [ -n "$E2E" ]; then
    [ -n "${GATES_REMOTE:-}" ] || { echo "$P: --e2e runs on the machine GATES_REMOTE names (.prepush.env), never on this one"; exit 2; }
    E2E="$(echo "$E2E" | tr , '\n' | grep -v '^$' | sort -u | paste -sd, -)"
    E2E_TREE=""
    if tree_is_clean; then
        E2E_TREE="$(git rev-parse HEAD^{tree})"
        if [ "${FORCE:-}" != 1 ] && [ -f "$E2E_STAMP" ]; then
            # Every requested project among those this tree passed, across all its lines.
            MISSING="$(gates_py e2e-missing "$E2E_STAMP" "$E2E_TREE" "$E2E")" || MISSING="(gates_classify.py failed)"
            if [ -z "$MISSING" ]; then
                echo "$P: tree ${E2E_TREE:0:10} already passed E2E for ${E2E//,/ } ($(grep -m1 "^$E2E_TREE	" "$E2E_STAMP" | cut -f3)) — not running it again (FORCE=1 runs it)"
                exit 0
            fi
        fi
    fi
    EIMG="${GATES_REMOTE_E2E_IMAGE:-sl-gates-e2e:1}"
    win_route e2e "$EIMG" || :  # THE WINDOWS PC, scripts/gates-remote.sh
    # Its own synced tree and its own lock (2026-10-29): E2E builds .next and runs browsers in a tree of its
    # own, so it no longer waits for — or rsyncs under — a gate run on the same box. 8 CPUs here + 12 for a
    # gate run = the box's 20; the two used to queue on run.lock one after the other.
    RWORK="$RDIR/work/$RID-e2e"
    # The tree is marked as in use before the sync (SYNCED TREES NOBODY USES, scripts/gates-remote.sh).
    ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE" "docker image inspect $EIMG >/dev/null 2>&1 && { mkdir -p $RWORK && touch $RWORK/.sl-last-use; :; }" 2>/dev/null \
        || { echo "$P: $GATES_REMOTE is unreachable, or has no $EIMG image — E2E does not run on this machine"; exit 1; }
    echo "$P: E2E on $GATES_REMOTE ($RWORK): ${E2E//,/ }"
    remote_sync || { echo "$P: could not rsync this tree to $GATES_REMOTE:$RWORK"; exit 1; }
    ssh -o BatchMode=yes "$GATES_REMOTE" "mkdir -p $RDIR/tmp/$RID" || exit 1
    ENAME="sl-e2e-$RID-$$"
    ELIMIT="${GATES_REMOTE_E2E_TIMEOUT:-20m}"; remote_limit "$ELIMIT" GATES_REMOTE_E2E_TIMEOUT
    trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $ENAME" >/dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM
    remote_e2e_run "$ENAME" "$ELIMIT" "$EIMG"
    ERC=$?
    trap - EXIT
    remote_verdict "$ERC" "$ELIMIT" GATES_REMOTE_E2E_TIMEOUT
    if [ "$ERC" -eq 0 ]; then
        echo "$P: E2E ok on $GATES_REMOTE"
        if [ -z "$E2E_TREE" ]; then
            echo "$P: not recording this E2E pass — $CLEAN_WHY"
        elif ! tree_is_clean || [ "$(git rev-parse HEAD^{tree})" != "$E2E_TREE" ]; then
            echo "$P: not recording this E2E pass — the checkout changed while it ran"
        else
            ledger_append "$E2E_STAMP" "$E2E_TREE" "$E2E" "$(date '+%Y-%m-%d %H:%M'), $(git rev-parse --short HEAD)"
            echo "$P: recorded an E2E pass for tree ${E2E_TREE:0:10} (${E2E//,/ }) — the same tree and projects will not run again"
        fi
        exit 0
    fi
    echo "$P: E2E failed on $GATES_REMOTE (exit $ERC). Log: $GATES_REMOTE:$RDIR/tmp/$RID/e2e.log"
    exit 1
fi

# No backend/.env → no SECRET_KEY → config/settings.py refuses to load, and
# every backend gate fails for a reason that has nothing to do with the change.
# That is every worktree (the file is gitignored) and every fresh clone. Use the
# same two values CI does (.github/workflows/ci.yml, which has no .env either),
# and say so. NOT the main checkout's backend/.env: that one points DATABASE_URL
# and REDIS_URL at the shared box.
# ≥32 bytes, or PyJWT's InsecureKeyLengthWarning — an error in pytest.ini.
CI_SECRET_KEY="ci-test-key-not-for-production-32-bytes-min"
# ENCRYPTION_KEY is not set here: the suite sets its own test key when none is (root conftest.py,
# `_encryption_key_when_none_is_set`), so CI, unRAID and a worktree run with the same one.
if [ -z "${SECRET_KEY:-}" ] && [ ! -f "$ROOT/backend/.env" ]; then
    echo "$P: no backend/.env here — using CI's SECRET_KEY/DEBUG for the backend gates"
    export SECRET_KEY="$CI_SECRET_KEY"
    export DEBUG="true"
fi

# ── TESTS ON THE GATE HOSTS: --tests (2026-11-19, user decision) ─────────────────────────────────
# `scripts/run-gates.sh [--real-pg] [--workers N] [--timeout 20m] --tests <pytest args…>` runs those pytest
# arguments in backend/ on GATES_REMOTE — or the Windows PC, by win_route's rule — instead of on this Mac:
# subagents' targeted runs took 3–10 minutes each here at 2 workers. It is not a gate: it selects nothing,
# records no ledger, and is never a push's evidence.
#   - Same sync (remote_sync, uncommitted and untracked files included), same slot and lock, same container,
#     same dependencies as a gate run (remote_gate_run), so it waits for a gate run and a gate run waits for it.
#   - The arguments go over as a NUL-separated file (.sl-tests-<pid>), never through a shell: `-k "a and b"`
#     arrives as one argument.
#   - SQLite by default; --real-pg uses the host's sl-pg-test (GATES_PG_URL, as a delegated --real-pg run) with
#     --create-db. Anything else — `--ds=config.settings_sharded -m sharded` — is pytest's and passes through.
#   - The throwaway redis-server inside, the test SECRET_KEY, DEBUG=true. Workers: --workers (0 = serial),
#     else the host's slot size. Limit 20 minutes (--timeout, GATES_TESTS_TIMEOUT).
#   - Progress every 30 s (pytest_progress), then the FAILED / ERROR lines and pytest's summary line; the exit
#     status is pytest's (124 / 137 when the limit stopped it).
# No GATES_REMOTE (.prepush.env): refused — run pytest here yourself if that is what you mean.
pytest_progress() {  # <label> <log> <name of the variable holding the failures already shown>
    local pct bad new now=""
    pct=$(grep -oE '\[ *[0-9]+%\]' "$2" | tail -1 | tr -d '[] ')
    bad=$(grep -E '\[ *[0-9]+%\]' "$2" | grep -E ' (FAILED|ERROR)( |$)' | grep -oE '[^ []+::[^ ]+' | awk '!seen[$0]++')
    [ -s "$2.status" ] && now=$("$PY" -I "$ROOT/backend/config/gate_progress.py" "$2.status" 2>/dev/null)
    echo "    … $1 ${pct:-0%} · $((EL / 60))m$((EL % 60))s · failed so far: $(printf '%s' "$bad" | grep -c . || true)${now:+ · $now}"
    new=$(printf '%s\n' "$bad" | grep -vxF -e "${!3}" | grep . || true)
    [ -n "$new" ] && printf '%s\n' "$new" | sed 's/^/        FAILED /'
    printf -v "$3" '%s' "$bad"
}
tests_here() {  # in the container: the arguments from $TESTS_FROM, pytest's exit status
    local args=() a log st x=() pg=() shown="" every="${GATES_PROGRESS_EVERY:-30}"
    while IFS= read -r -d '' a; do args+=("$a"); done <"$ROOT/$TESTS_FROM"
    rm -f "$ROOT/$TESTS_FROM"
    cd "$ROOT/backend" || exit 2
    PY="$ROOT/backend/.venv/bin/python"
    RPORT=$("$PY" -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1])") \
        && redis-server --port "$RPORT" --daemonize yes --save '' --appendonly no >/dev/null 2>&1 \
        || { echo "$P: could not start a throwaway redis-server"; exit 2; }
    trap 'redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1' EXIT
    export REDIS_URL="redis://127.0.0.1:$RPORT/0" CELERY_BROKER_URL="redis://127.0.0.1:$RPORT/1" CELERY_RESULT_BACKEND="redis://127.0.0.1:$RPORT/2"
    if [ "$REAL_PG" = 1 ]; then
        case "${GATES_PG_URL:-}" in
            postgres://*|postgresql://*) export DATABASE_URL="$GATES_PG_URL"; pg=(--create-db) ;;
            *) echo "$P: --real-pg: no PostgreSQL handed to this container (GATES_PG_URL)"; exit 2 ;;
        esac
    else
        export DATABASE_URL="sqlite:///:memory:"
    fi
    [ "${PYTEST_WORKERS:-0}" = 0 ] || x=(-n "$PYTEST_WORKERS" --dist worksteal)
    echo "  → pytest (${DATABASE_URL%%:*}, ${x[*]:-serial}):$(printf ' %q' "${args[@]}")"
    log=$(mktemp "${TMPDIR:-/tmp}/tests-pytest.XXXXXX")
    SECRET_KEY="$CI_SECRET_KEY" DEBUG=true SOULLEDGER_GATE_STATUS="$log.status" "$PY" -m pytest -v --no-header --no-cov -rfE \
        -o faulthandler_timeout="${PYTEST_TEST_TIMEOUT:-600}" -o faulthandler_exit_on_timeout=true \
        ${x[@]+"${x[@]}"} ${pg[@]+"${pg[@]}"} "${args[@]}" >"$log" 2>&1 &
    local pid=$! T0; T0=$(date +%s); local next="$every"
    while kill -0 "$pid" 2>/dev/null; do
        sleep 1; EL=$(( $(date +%s) - T0 ))
        [ "$EL" -ge "$next" ] && { next=$(( next + every )); pytest_progress pytest "$log" shown; }
    done
    wait "$pid"; st=$?
    grep -E '^(FAILED|ERROR) ' "$log" | sed 's/^/    /'
    tail -1 "$log"
    rm -f "$log.status" "$log.status.tmp"
    if [ "$st" = 0 ]; then rm -f "$log"; else echo "    full log: $log"; fi
    echo "$P: pytest exit $st ($(( $(date +%s) - T0 ))s)"
    exit "$st"
}
if [ "$TESTS" = 1 ] && [ "${GATES_IN_REMOTE:-0}" = 1 ]; then
    P=tests; tests_here
elif [ "$TESTS" = 1 ]; then
    P=tests
    [ -n "${GATES_REMOTE:-}" ] || { echo "$P: no GATES_REMOTE in .prepush.env — --tests runs on the gate hosts only. Not running here."; exit 2; }
    [ "${#TEST_ARGS[@]}" -gt 0 ] || { echo "$P: --tests needs pytest arguments (test paths, -k …); the whole suite is a gate run"; exit 2; }
    TESTS_LIMIT="${GATES_TESTS_TIMEOUT:-$TESTS_LIMIT}"; remote_limit "$TESTS_LIMIT" "--timeout / GATES_TESTS_TIMEOUT"
    win_route tests "$RIMG" || :
    [ "$REAL_PG" = 0 ] || [ -n "${GATES_REMOTE_DB_URL:-}" ] || { echo "$P: --real-pg: no GATES_REMOTE_DB_URL (.prepush.env)"; exit 2; }
    ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE" "docker image inspect $RIMG >/dev/null 2>&1 && { mkdir -p $RWORK $RDIR/tmp/$RID && touch $RWORK/.sl-last-use; :; }" 2>/dev/null \
        || { echo "$P: $GATES_REMOTE is unreachable, or has no $RIMG image. Not running here."; exit 2; }
    T_SYNC=$(date +%s)
    remote_sync || { echo "$P: could not rsync this tree to $GATES_REMOTE:$RWORK"; exit 2; }
    printf '%s\0' "${TEST_ARGS[@]}" | ssh -o BatchMode=yes "$GATES_REMOTE" "cat > $RWORK/.sl-tests-$$" \
        || { echo "$P: could not hand the arguments to $GATES_REMOTE"; exit 2; }
    echo "$P: on $GATES_REMOTE ($RWORK, synced in $(( $(date +%s) - T_SYNC ))s), limit $TESTS_LIMIT — not a gate, nothing recorded"
    RNAME="sl-gates-$RID-$$"
    trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $RNAME" >/dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM
    TFLAGS=""; [ "$REAL_PG" = 1 ] && TFLAGS="--real-pg "
    # A few named test files get few workers (2026-11-19, user decision): every xdist worker sets up its own
    # databases (five under --ds=config.settings_sharded) before its first test, and a handful of files keeps a
    # slot's 5-6 workers mostly idle. 1–2 files → 1 worker, 3–5 → one each, more (or a directory, or only -k)
    # → the slot's size. Never 0: without xdist there is no shared PostgreSQL template and every alias
    # migrates serially in the one process. --workers wins.
    if [ -z "$TESTS_WORKERS" ]; then
        NFILES=0; prev=""  # a test path, not an option's value (-k x.py, --deselect a.py::t, --ignore a.py)
        for a in "${TEST_ARGS[@]}"; do
            [[ "$a" != -* && "$a" =~ \.py(::.*)?$ && ! "$prev" =~ ^(-k|-m|-p|-o|-c|--deselect|--ignore|--ignore-glob|--rootdir)$ ]] && NFILES=$((NFILES + 1))
            prev="$a"
        done
        SLOTW="${GATES_REMOTE_PYTEST_WORKERS:-$SLOT_WORKERS}"
        if [ "$NFILES" -ge 1 ] && [ "$NFILES" -le 2 ]; then TESTS_WORKERS=1
        elif [ "$NFILES" -ge 3 ] && [ "$NFILES" -le 5 ] && [[ "$SLOTW" =~ ^[0-9]+$ ]] && [ "$NFILES" -lt "$SLOTW" ]; then TESTS_WORKERS=$NFILES
        fi
        [ -n "$TESTS_WORKERS" ] && echo "$P: $NFILES test file(s) named: $TESTS_WORKERS pytest worker(s) (--workers N overrides)"
    fi
    [ -n "$TESTS_WORKERS" ] && GATES_REMOTE_PYTEST_WORKERS="$TESTS_WORKERS"  # after win_route, which sizes the PC's
    DEPS_JS=""  # pytest only: no node_modules install on a fresh tree (REMOTE_DEPS); a gate run there installs it
    remote_gate_run "$RNAME" "$TESTS_LIMIT" "exec bash scripts/run-gates.sh $TFLAGS--tests-from .sl-tests-$$"
    RSTATUS=$?
    trap - EXIT
    remote_verdict "$RSTATUS" "$TESTS_LIMIT" "--timeout"
    [ "$RSTATUS" = 0 ] || echo "$P: a log named /sl-tmp/… is $GATES_REMOTE:$RDIR/tmp/$RID/… (kept a day)"
    echo "$P: exit $RSTATUS ($(( $(date +%s) - T_SYNC ))s with the sync and any wait for a slot)"
    exit "$RSTATUS"
fi

# WHAT CHANGED: changed_since_base, defined above the E2E block (which uses it for --e2e=auto).
changed_since_base
# A PUSH OF A TREE BOTH SIDES ALREADY PASSED IS NOT RUN AGAIN.
#   - 2026-10-19: a tree that passed `--full` (any push of it); 2026-10-27: a tree that passed selectively,
#     when every file the push changes is among the files that pass covered — a session ran the gates and
#     then pushed, and the hook ran the same tests a second time. A larger change set never selects less:
#     each rule only adds tests or forces a full run.
#   - 2026-11-15 (user decision): per side. The push passes when the backend's ledgers and the JS side's
#     each vouch for the pushed tree (side_proves) — whether the two were green in one run or in two.
# --full / GATES_FULL=1 at push time accept only a full pass. Any change at all — one byte in any tracked
# file — is a different tree and runs as before. The real-PostgreSQL run and E2E were never part of this.
PUSHED_SHA=""
case "${PREPUSH_RANGE:-}" in *..*) PUSHED_SHA="${PREPUSH_RANGE##*..}" ;; esac
PUSHED_TREE=""
[ -n "$PUSHED_SHA" ] && PUSHED_TREE="$(git rev-parse -q --verify "$PUSHED_SHA^{tree}" 2>/dev/null || true)"
# 2026-11-21: one side proven is that side skipped, the other run (GATES_SIDES) — the same rule per side, not
# all or nothing: a JS pass and a real-PG backend pass of one tree used to rerun both sides.
if [ "$PREPUSH" = 1 ] && [ -n "$PUSHED_TREE" ]; then
    WANT="$CHANGED"; { [ "$MODE" = full ] || [ "${GATES_FULL:-}" = 1 ]; } && WANT=-
    BE_KIND=""; JS_KIND=""
    side_proves backend "$PUSHED_TREE" "$WANT" && BE_KIND="$PROVEN_KIND"
    side_proves js "$PUSHED_TREE" "$WANT" && JS_KIND="$PROVEN_KIND"
    if [ -n "$BE_KIND" ] && [ -n "$JS_KIND" ]; then
        if [ "$BE_KIND" = full ] && [ "$JS_KIND" = full ]; then
            echo "$P: tree ${PUSHED_TREE:0:10} already passed \`scripts/run-gates.sh --full\` — not running it again"
        else
            echo "$P: tree ${PUSHED_TREE:0:10} already passed \`scripts/run-gates.sh\` for these changes (backend $BE_KIND, JS $JS_KIND) — not running it again"
        fi
        exit 0
    elif [ -n "$BE_KIND" ] || [ -n "$JS_KIND" ]; then
        if [ -n "$BE_KIND" ]; then GATES_SIDES=js; else GATES_SIDES=backend; fi
        echo "$P: tree ${PUSHED_TREE:0:10}: the $([ -n "$BE_KIND" ] && echo backend || echo JS) side's ledgers vouch for these changes ($BE_KIND$JS_KIND) — running the $GATES_SIDES side only"
    fi
fi

# record_side <backend|js> <that side's exit status>: after a run outside a push, on a clean checkout, a
# green side is recorded in its own ledger whatever the other side did. --full covers `*` (any push of the
# tree); a selective run, the files the side covered (COVERED_BE / COVERED_JS).
# A green --real-pg run records its backend side in its own ledger, `$STAMP-realpg` (2026-11-20, user: before a
# whole real-PG run, a hook asks whether it is needed — an untracked local script reads this ledger), and
# since 2026-11-21 in `$STAMP-backend` as well, so it vouches for a push: it runs the backend side's ruff and
# makemigrations (static_backend) and the same pytest selection (plus the PostgreSQL-only tests, which a
# delegated SQLite-side run adds as well), on PostgreSQL. `-realpg` lines written before that day ran no ruff
# and no makemigrations, which is why they are not read as backend passes.
record_side() {
    [ "$PREPUSH" = 0 ] && [ "$2" = 0 ] || return 0
    if [ "$REAL_PG" = 1 ]; then [ "$1" = backend ] && [ "$TESTS" = 0 ] || return 0; fi
    side_on "$1" || return 0  # GATES_SIDES left it out: nothing ran, nothing to vouch for
    cd "$ROOT" || return 0
    tree_is_clean || { echo "$P: not recording the $1 pass — $CLEAN_WHY"; return 0; }
    local tree files=("$STAMP-$1") file cov kind=selective
    [ "$REAL_PG" = 1 ] && files+=("$STAMP-realpg")
    tree="$(git rev-parse HEAD^{tree})"
    [ "$tree" = "$START_TREE" ] || { echo "$P: not recording the $1 pass — HEAD moved during the run (tested ${START_TREE:0:10}, now ${tree:0:10})"; return 0; }
    if [ "$FULL_RUN" = 1 ]; then
        cov='*'; kind=full
    elif [ "$1" = backend ]; then
        cov="$(echo "$COVERED_BE" | grep -v '^$' | paste -sd'|' -)"
    else
        cov="$(echo "$COVERED_JS" | grep -v '^$' | paste -sd'|' -)"
    fi
    for file in "${files[@]}"; do
        ledger_append "$file" "$tree" "$(date '+%Y-%m-%d %H:%M'), $(git rev-parse --short HEAD)" "$cov"
    done
    echo "$P: recorded a $kind pass ($1) for tree ${tree:0:10}"
}
# Consumed: nothing below (pytest included) should inherit the hand-off.
unset PREPUSH_CHANGED PREPUSH_CHANGED_BACKEND PREPUSH_CHANGED_JS PREPUSH_RANGE
[ -z "$CHANGED" ] && { echo "$P: no file changes in $RANGE"; exit 0; }

# readers_for <list file> — of a readers list (backend/tests/reads-outside-backend.txt, frontend/jest.always-run.txt),
# the first field of each line whose other fields name `*` or a top-level entry in $TOPS (gates_classify.py).
readers_for() {
    printf '%s' "$TOPS" | gates_py readers "$1"
}
# classify <changed files> — every decision below, from one change list: scripts/gates_classify.py's classify
# (2026-11-26), whose answers become this script's variables. Called once per side when the two sides' lists
# differ (EACH SIDE DECIDES FROM ITS OWN CHANGES, after it). The rules, each with its reason, are there:
#   - which areas a change touches (TOUCHES_FRONTEND / _BACKEND / _CORE / _MOBILE / _OFFICER) and the gates
#     they run (RUN_*): packages/ runs every JS area; the gate machinery (GATE_SCRIPTS) runs the backend;
#   - root-level files: the JS tree, the pytest config, and — fail closed — any file not on INERT_ROOT_RE,
#     which runs every gate (the 2026-09-11 lockfile push that ran nothing);
#   - the tests that read another area's files (BACKEND_READERS, JEST_READERS, MOBILE_READERS);
#   - the migration round trips (RUN_MIGRATION) and the two suite-about-the-suite tests (RUN_META, RUN_SCOPE,
#     META_SKIP) only when what they test changed;
#   - why the web jest (FULL_F) and the apps' jest (APP_FULL_F) run in full instead of --findRelatedTests.
# The variables are computed ONCE: every `if` below reads them, and so does the classify-only output.
classify() {
local out flags=""
[ "$MODE" = full ] && flags="$flags --full"
[ "${GATES_FULL:-}" = 1 ] && flags="$flags --gates-full"
# shellcheck disable=SC2086
out="$(printf '%s' "$1" | gates_py classify "$ROOT" $flags)" \
    || { echo "$P: scripts/gates_classify.py failed — cannot tell what this change runs. Refusing."; exit 1; }
eval "$out"
if [ -n "$UNKNOWN_ROOT" ] && [ -z "${CLASSIFY_QUIET:-}" ]; then
    echo "$P: root-level file(s) this hook does not recognise — running every gate:"
    echo "$UNKNOWN_ROOT" | sed 's/^/    /'
    echo "$P: if one of these cannot affect a gate, add it to INERT_ROOT_RE in scripts/gates_classify.py."
fi
[ "$READERS_MISSING" = 1 ] \
    && echo "$P: no backend/tests/reads-outside-backend.txt in this checkout — cannot tell which backend tests read other areas, so the backend suite runs"
# An explicit full run, read here because PREPUSH_TO_MAIN is unset; a push to main is NOT a full run
# (2026-10-24, user decision): `--full` / GATES_FULL=1 are the way to ask for everything.
unset PREPUSH_TO_MAIN

# ── --real-pg: THE BACKEND SUITE ON REAL POSTGRESQL (2026-10-28, user decision) ─
#
# What SQLite cannot test — row locks, varchar(n), aborted transactions, pg_trgm,
# pgvector — runs on the shared box (backend/.env's DATABASE_URL), with a throwaway
# Redis as always. Day to day it runs the same by-app selection as the push, plus
# every PostgreSQL-only test (the set test_concurrency.py pins); the 26 migration
# round trips only when a migration changed. `--real-pg --full` runs everything,
# round trips included — before merging into main. The full run took ~45 minutes
# at -n 2 with the round trips (2026-10-28); 950 s at -n 4 without (2026-10-19).
# No jest, no tsc/eslint. ruff and makemigrations do run (2026-11-21, seconds): with them a green run is
# the backend side's run on PostgreSQL, and it is recorded for that side (record_side).
if [ "$REAL_PG" = 1 ]; then
    P="real-pg"
    RUN_CORE=0; RUN_FRONTEND=0; RUN_MOBILE=0; RUN_OFFICER=0; RUN_JEST_READERS=0; MOBILE_READERS=""
    RUN_BACKEND=1; BACKEND_READERS=""
    [ "$FULL_RUN" = 1 ] && RUN_MIGRATION=1
fi
}  # classify
# full <why>: one more reason for the web jest to run in full (FULL_F, which classify fills).
full() { FULL_F="$FULL_F$1"$'\n'; }

# EACH SIDE DECIDES FROM ITS OWN CHANGES (2026-11-15, user decision). The backend's decisions come from
# CHANGED_BE (the diff from the backend's base), the JS side's from CHANGED_JS. Each list holds every file
# that changed since that side's base, the other side's included, so a side's readers of the other side's
# files (reads-outside-backend.txt, jest.always-run.txt, the app readers) follow those changes as before.
# One list (a push, an explicit --base, both sides on one base): classify once.
BE_VARS="TOUCHES_BACKEND BACKEND_ROOT RUN_BACKEND BACKEND_READERS TOUCHES_MIGRATION RUN_MIGRATION RUN_META RUN_SCOPE META_SKIP TOPS"
classify "$CHANGED_BE"
if [ "$CHANGED_JS" != "$CHANGED_BE" ]; then
    for v in $BE_VARS; do eval "SAVED_$v=\"\$$v\""; done
    CLASSIFY_QUIET=1 classify "$CHANGED_JS"
    for v in $BE_VARS; do eval "$v=\"\$SAVED_$v\""; done
fi

echo "$P: $RANGE — frontend:$TOUCHES_FRONTEND backend:$TOUCHES_BACKEND core:$TOUCHES_CORE changed files (root: js $JS_ROOT, backend $BACKEND_ROOT)"

# backend_selection <python> — scripts/select-backend-tests.py over CHANGED_BE, into BE_SEL: the test files to
# run, or "FULL<tab>why". Its one call site for the three paths, each of which ends the run, so it runs once
# per run: PREPUSH_CLASSIFY_ONLY and the delegated run's time limit here (python3), pytest where it runs ($PY).
backend_selection() {
    BE_SEL=$(echo "$CHANGED_BE" | "$1" -I "$HERE/select-backend-tests.py")
}
if [ "${PREPUSH_CLASSIFY_ONLY:-0}" = "1" ]; then
    echo "classify: core=$RUN_CORE frontend=$RUN_FRONTEND backend=$RUN_BACKEND"
    # A separate line so the existing `classify:` contract (parsed by
    # backend/tests/test_prepush_runs_the_gates_a_change_can_break.py) is unchanged.
    echo "classify-mobile: mobile=$RUN_MOBILE"
    echo "classify-officer: officer=$RUN_OFFICER"
    echo "classify-app-jest: full=$([ -n "$APP_FULL_F" ] && echo 1 || echo 0)"
    printf '%s' "$APP_FULL_F" | sed 's/^/  app full because: /'
    echo "classify-migration: migration=$RUN_MIGRATION"
    echo "classify-meta: meta=$RUN_META"
    echo "classify-collection-scope: scope=$RUN_SCOPE"
    if [ "$RUN_BACKEND" = 1 ] && [ "$FULL_RUN" = 0 ] && [ -f "$HERE/select-backend-tests.py" ]; then
        backend_selection python3; SEL="$BE_SEL"
        case "$SEL" in FULL*) echo "classify-backend-select: whole suite (${SEL#FULL	})" ;;
                       *) echo "classify-backend-select: $(echo "$SEL" | grep -c . || true) test files" ;; esac
    fi
    echo "classify-jest: full=$([ -n "$FULL_F" ] && echo 1 || echo 0)"
    printf '%s' "$FULL_F" | sed 's/^/  full because: /'
    echo "classify-jest-readers: $(echo "$JEST_READERS" | grep -c . || true)"
    printf '%s\n' "$JEST_READERS" | grep . | sed 's/^/  jest reader: /'
    echo "classify-readers: jest=$RUN_JEST_READERS mobile=$([ -n "$MOBILE_READERS" ] && echo 1 || echo 0) backend=$(echo "$BACKEND_READERS" | grep -c . || true)"
    printf '%s' "$BACKEND_READERS" | sed 's/^/  backend reader: /'; echo
    echo "classify-mobile-readers: $(echo "$MOBILE_READERS" | grep -c . || true)"
    printf '%s\n' "$MOBILE_READERS" | grep . | sed 's/^/  mobile reader: /'
    exit 0
fi

# fail <why>: stop. Inside a side (IN_SIDE, set by the subshells at the end) it ends that side only: the
# reason goes to the side's notes ($NOTES) for the summary, and the other side runs on.
fail() {
    echo ""; echo "$P: $1"
    if [ -n "${IN_SIDE:-}" ]; then printf '%s\n' "$1" >>"$NOTES"; exit 1; fi
    if [ "$PREPUSH" = 1 ]; then echo "pre-push: push refused. SKIP_PREPUSH=1 git push  to override deliberately."
    else echo "$P: FAILED"; fi
    exit 1
}
# static_fail <why>: a red type check or linter (FAIL LATE, 2026-11-15, user decision). Said now, noted for
# the summary, and the side goes on: before, the first red tsc ended the side, the run was re-pushed for the
# next red one, and r31–r38 took eight rounds where two or three would have shown every failure.
static_fail() {
    echo "$P: $1"
    [ -n "${NOTES:-}" ] && printf '%s\n' "$1" >>"$NOTES"
    STATIC_RED=1
}

# ── DELEGATED RUNS: THE WHOLE RUN ON ANOTHER MACHINE (2026-10-28, user decision) ──
#
# `.prepush.env` (gitignored, one machine) names an ssh host with Docker: GATES_REMOTE. Then this
# machine only decides what runs (everything above), rsyncs the tree, and runs THIS SCRIPT there in a
# container — same rules, one copy of them — with the decision handed over in PREPUSH_CHANGED. Its
# output streams back, its exit status is this run's. The container image (GATES_REMOTE_IMAGE) has
# node (.nvmrc), Python 3.11, git, redis-server; node_modules and backend/.venv are installed there,
# in the synced tree, and reinstalled only when their own inputs change (REMOTE_DEPS). Its database is
# the throwaway PostgreSQL GATES_REMOTE_DB_URL names, so the run includes the PostgreSQL-only tests.
# Runs from all checkouts queue on one lock on that machine.
#
# NO FALLBACK. When GATES_REMOTE is set and the machine cannot be used, the run stops here: running
# on this machine is what froze it (user decision). Retry when it is up; to run here on purpose,
# comment GATES_REMOTE out of .prepush.env; `SKIP_PREPUSH=1 git push` skips the hook.
if [ -n "${GATES_REMOTE:-}" ] && [ "${GATES_IN_REMOTE:-0}" != 1 ]; then
    [ -n "${GATES_REMOTE_DB_URL:-}" ] || fail "GATES_REMOTE is set without GATES_REMOTE_DB_URL (.prepush.env). Not running the gates on this machine."
    win_route gate "$RIMG" || :  # THE WINDOWS PC, scripts/gates-remote.sh
    # ... and mark the tree as in use before anything is synced into it (SYNCED TREES NOBODY USES, scripts/gates-remote.sh).
    ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE" "docker image inspect $RIMG >/dev/null 2>&1 && { mkdir -p $RWORK && touch $RWORK/.sl-last-use; :; }" 2>/dev/null \
        || fail "$GATES_REMOTE is unreachable, or has no $RIMG image. Not running the gates on this machine (GATES_REMOTE is set) — try again when it is up, or SKIP_PREPUSH=1 git push."
    echo "$P: on $GATES_REMOTE ($RWORK) — this machine only syncs and waits"
    T_SYNC=$(date +%s)
    remote_sync || fail "could not rsync this tree to $GATES_REMOTE:$RWORK"
    # Each side's change list (its own base) and their union.
    { printf '%s\n' "$CHANGED_BE" | ssh -o BatchMode=yes "$GATES_REMOTE" "cat > $RWORK/.sl-changed-backend" \
        && printf '%s\n' "$CHANGED_JS" | ssh -o BatchMode=yes "$GATES_REMOTE" "cat > $RWORK/.sl-changed-js" \
        && printf '%s\n' "$CHANGED" | ssh -o BatchMode=yes "$GATES_REMOTE" "cat > $RWORK/.sl-changed"; } \
        || fail "could not hand the change list to $GATES_REMOTE"
    echo "    (synced in $(( $(date +%s) - T_SYNC ))s)"
    RFLAGS="--prepush"; [ "$MODE" = full ] && RFLAGS="$RFLAGS --full"; [ "$REAL_PG" = 1 ] && RFLAGS="$RFLAGS --real-pg"
    RNAME="sl-gates-$RID-$$"
    # THE LIMIT FOLLOWS THE REAL SIZE (2026-11-15, user decision): not only --full but any run whose backend
    # resolves to the whole suite (a forced-full rule in select-backend-tests.py: settings, a conftest,
    # dependencies, apps/core ...) gets the full run's 90 minutes: the whole suite under the selective
    # 30 minutes is a run cut off by its limit, not one that found anything.
    BE_WHOLE=""
    if [ "$FULL_RUN" = 1 ]; then
        BE_WHOLE="--full"
    elif [ "$RUN_BACKEND" = 1 ] && [ ! -f "$HERE/select-backend-tests.py" ]; then
        BE_WHOLE="no select-backend-tests.py next to this script"
    elif [ "$RUN_BACKEND" = 1 ]; then
        backend_selection python3 2>/dev/null && SEL="$BE_SEL" || SEL="FULL	select-backend-tests.py failed"
        case "$SEL" in FULL*) BE_WHOLE="${SEL#FULL	}" ;; esac
    fi
    if [ -n "$BE_WHOLE" ]; then RLIMIT="${GATES_REMOTE_FULL_TIMEOUT:-90m}"; RLIMIT_VAR=GATES_REMOTE_FULL_TIMEOUT
        echo "    (time limit $RLIMIT: the backend runs its whole suite — $BE_WHOLE)"
    else RLIMIT="${GATES_REMOTE_TIMEOUT:-30m}"; RLIMIT_VAR=GATES_REMOTE_TIMEOUT; fi
    remote_limit "$RLIMIT" "$RLIMIT_VAR"
    RLOG=$(mktemp "${TMPDIR:-/tmp}/gates-remote.XXXXXX")
    trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $RNAME" >/dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM
    # TMPDIR is OUTSIDE the tree (/sl-tmp): under /app, test_testdb_name's child pytest found the tree's
    # root conftest above its tmp_path and applied it twice (test_soulledger_wired_wired), every delegated run.
    ssh -o BatchMode=yes "$GATES_REMOTE" "mkdir -p $RDIR/tmp/$RID" || fail "could not create $RDIR/tmp/$RID on $GATES_REMOTE"
    # flock: GATES_REMOTE_SLOTS delegated runs at a time on that machine (remote_slots), from any checkout or
    # session. It is the only
    # lock there: GATE_LOCK=0 turns off gate-lock.sh inside the container, whose pid check cannot work
    # across containers — each numbers its processes from 1, so a lock an interrupted run left behind
    # named pid 7, the next container had a live pid 7, and that push waited 30 minutes (2026-10-28).
    # Workers: 5 for pytest + 5 for the JS runners = the slot's 10 CPUs (6 + 6 = 12 with one slot), because the two sides now
    # run at once (TWO SIDES AT ONCE, near the end). GATES_REMOTE_PYTEST_WORKERS / _JS_WORKERS override.
    # The lock and the time limit: TIME LIMITS ON THE REMOTE MACHINE, scripts/gates-remote.sh.
    remote_gate_run "$RNAME" "$RLIMIT" "export PREPUSH_CHANGED=\"\$(cat .sl-changed)\" PREPUSH_CHANGED_BACKEND=\"\$(cat .sl-changed-backend)\" PREPUSH_CHANGED_JS=\"\$(cat .sl-changed-js)\"
          exec bash scripts/run-gates.sh $RFLAGS" | tee "$RLOG"
    RSTATUS=${PIPESTATUS[0]}
    trap - EXIT
    remote_verdict "$RSTATUS" "$RLIMIT" "$RLIMIT_VAR"
    # Each side's verdict, from the line the run there ends with (TWO SIDES AT ONCE). No such line (it stopped
    # before the sides, or hit the time limit): both sides take the run's status.
    SIDES_LINE="$(grep -E '^gates-sides: backend=[0-9]+ js=[0-9]+$' "$RLOG" | tail -1)"
    rm -f "$RLOG"
    BE_RC="$RSTATUS"; JS_RC="$RSTATUS"
    if [ -n "$SIDES_LINE" ]; then BE_RC="${SIDES_LINE#*backend=}"; BE_RC="${BE_RC%% *}"; JS_RC="${SIDES_LINE##*js=}"; fi
    record_side backend "$BE_RC"
    record_side js "$JS_RC"
    # Logs it names as /sl-tmp/… are kept there: $RDIR/tmp/$RID/ on $GATES_REMOTE (a day).
    [ "$RSTATUS" -eq 0 ] || fail "the gates failed on $GATES_REMOTE (exit $RSTATUS) — see above; a log named /sl-tmp/… is $GATES_REMOTE:$RDIR/tmp/$RID/…"
    echo "$P: ok on $GATES_REMOTE ($(( $(date +%s) - T_SYNC ))s)"
    exit 0
fi

# One heavy gate at a time across every worktree and session (gate-lock.sh,
# next to this script — the hook's installed copy carries its own).
if [ -f "$HERE/gate-lock.sh" ]; then
    . "$HERE/gate-lock.sh"
    gate_lock "$P $(git rev-parse --abbrev-ref HEAD)"
fi
T_GATES=$(date +%s)   # after the lock: the time below is the gates', not the queue's

need() { command -v "$1" >/dev/null 2>&1 || fail "\`$1\` not found, so this check cannot run. Refusing rather than skipping — a check that did not run is not a check that passed."; }

# STATIC CHECKS FIRST (2026-10-27, user decision): every type check and linter, all areas, before
# any test runner. They take seconds each and fail on the commonest mistakes; run after the web and
# app jest, a ruff error surfaced only after several minutes of tests, at full CPU and memory.
#
# On this machine that is the order of the whole run: static_js, static_backend, then the tests. In the
# remote run (2026-11-13, test review 3.5) each side starts with its own static checks — static_js before
# the JS runners, static_backend before pytest — and the two sides overlap (TWO SIDES AT ONCE, near the end):
# up to eight tsc / eslint runs and ruff + makemigrations used to run one after another, about one core each
# of the container's twelve, before either side began. Within a side the order is unchanged.
# FAIL LATE (2026-11-15, user decision): a red check no longer ends its side. static_fail says it, notes it
# for the summary and goes on — the side's other checks and its tests still run — and the function returns
# non-zero, so the side, and the run, end red. A check that cannot run at all (`need`) still stops the side.
# Functions, so the order is the order of the calls at the end of this file — which is what the test reads
# (TestStaticChecksRunBeforeAnyTests runs them and compares what was invoked, per side).
static_js() {
STATIC_RED=0
if [ "$RUN_CORE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    # This tsconfig is the boundary. Running it here is the only automatic
    # execution it gets.
    echo "  → core tsc"
    npm run --workspace packages/core typecheck --silent \
        || static_fail "@soulledger/core typecheck failed. This compiles under lib:[\"ES2020\"] with no DOM — a \`document\`/\`window\`/\`localStorage\` reference here is a host capability that belongs behind a PlatformAdapter port, not a type error to widen the lib for."
    echo "  → core eslint"
    npm run --workspace packages/core lint --silent \
        || static_fail "@soulledger/core lint failed. Note this config refuses \`process.env\` and \`import.meta.env\`: Expo and Tauri define neither of the ones Next does, and the fallback fails silently."
fi
if [ "$RUN_FRONTEND" = 1 ]; then
    need npx
    cd "$ROOT/frontend" || fail "frontend/ missing"
    echo "  → tsc";   npx tsc --noEmit          || static_fail "tsc failed"
    echo "  → eslint"; npm run lint --silent    || static_fail "eslint failed"
    cd "$ROOT" || exit 1
fi
if [ "$RUN_MOBILE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → mobile tsc"
    npm run --workspace mobile typecheck --silent || static_fail "mobile typecheck failed"
    echo "  → mobile eslint"
    npm run --workspace mobile lint --silent || static_fail "mobile lint failed"
fi
if [ "$RUN_OFFICER" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → officer tsc"
    npm run --workspace mobile-officer typecheck --silent || static_fail "officer typecheck failed"
    echo "  → officer eslint"
    npm run --workspace mobile-officer lint --silent || static_fail "officer lint failed"
fi
[ "$STATIC_RED" = 0 ]
}  # static_js

# The interpreter and ruff are chosen here, in the run's own shell, before either side starts: both
# static_backend and run_backend_tests use $PY.
if [ "$RUN_BACKEND" = 1 ] || [ -n "$BACKEND_READERS" ]; then
    cd "$ROOT/backend" || fail "backend/ missing"
    # THE INTERPRETER IS THE PROJECT VENV, `backend/.venv` — Python 3.11 with
    # exactly `requirements.lock`, the set the image and CI install.
    #
    # It used to be PYTHON_BIN from .prepush.env, else a bare `python` on PATH.
    # On the machine this hook was written for, PYTHON_BIN named the shared
    # conda `vision` environment: Python 3.12 and the dependency versions from
    # before `84876ad` upgraded the lock, so a green push measured a different
    # set of packages from the one that ships. The bare-`python` fallback was
    # the 2026-09-11 refusal described above (anaconda base, no Django). There
    # is no PATH fallback any more: no venv is a refusal that says how to make one.
    #
    # A worktree has no `.venv` (gitignored), so the main checkout's is used,
    # exactly as for .prepush.env; a worktree's own still wins. PYTHON_BIN /
    # RUFF_BIN still override, and the run says when they do — a .prepush.env
    # that still names another environment would otherwise win silently.
    VENV_BIN=""
    for r in "$ROOT" "$MAIN_ROOT"; do
        if [ -n "$r" ] && [ -x "$r/backend/.venv/bin/python" ]; then VENV_BIN="$r/backend/.venv/bin"; break; fi
    done
    MAKE_VENV="cd backend && uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python --no-deps -r requirements.lock -r requirements-dev.txt"
    if [ -n "${PYTHON_BIN:-}" ]; then
        PY="$PYTHON_BIN"; echo "    python: $PY (PYTHON_BIN override; backend/.venv not used)"
    elif [ -n "$VENV_BIN" ]; then
        PY="$VENV_BIN/python"; echo "    python: $PY (backend/.venv)"
    else
        fail "no backend/.venv (looked under $ROOT${MAIN_ROOT:+ and $MAIN_ROOT}). Create it, from the repository root:  $MAKE_VENV"
    fi
    if [ -n "${RUFF_BIN:-}" ]; then
        RUFF="$RUFF_BIN"; echo "    ruff:   $RUFF (RUFF_BIN override)"
    elif [ -n "$VENV_BIN" ] && [ -x "$VENV_BIN/ruff" ]; then
        RUFF="$VENV_BIN/ruff"; echo "    ruff:   $RUFF (backend/.venv)"
    else
        fail "no ruff in backend/.venv — it is pinned in backend/requirements-dev.txt, which CI installs too. From the repository root:  $MAKE_VENV"
    fi
    command -v "$PY" >/dev/null 2>&1 || fail "\`$PY\` not found or not executable."
    command -v "$RUFF" >/dev/null 2>&1 || fail "\`$RUFF\` not found or not executable."
    cd "$ROOT" || exit 1
fi

static_backend() {
STATIC_RED=0
if [ "$RUN_BACKEND" = 1 ] || [ -n "$BACKEND_READERS" ]; then
    cd "$ROOT/backend" || fail "backend/ missing"
    if [ "$RUN_BACKEND" = 1 ]; then
        echo "  → ruff";  "$RUFF" check .          || static_fail "ruff failed"
        # `makemigrations --check` BEFORE pytest, because it is the cheap one and
        # because it catches a class the suite does not: a model `choices` list
        # losing a member alters a field, and Django notices while every test that
        # only reads today's members stays green. Verified by dropping GREEK from
        # the org category choices — this exits 1 and names the missing migration.
        #
        # It ran only in CI, and CI never runs on a push (daily / tag / manual
        # since 2026-10-30), so a push could land a missing migration.
        #
        # Say what failed only when the output says it. This used to discard the
        # output and call EVERY non-zero exit "a model changed" — so a wrong
        # interpreter (ModuleNotFoundError) and a missing SECRET_KEY both read as a
        # migration problem, and the one line the push printed pointed away from the
        # cause. makemigrations names the app when a migration is really missing.
        echo "  → makemigrations --check"
        MM_OUT="$("$PY" manage.py makemigrations --check --dry-run 2>&1)"
        MM_STATUS=$?
        if [ "$MM_STATUS" -ne 0 ]; then
            echo "$MM_OUT" | tail -15 | sed 's/^/    /'
            if echo "$MM_OUT" | grep -q "^Migrations for '"; then
                static_fail "makemigrations --check: a model changed without a migration. Run \`manage.py makemigrations\` and read what it generated before committing it."
            else
                static_fail "makemigrations --check could not run (exit $MM_STATUS) — see the output above. This is not a missing migration. Interpreter: $PY"
            fi
        fi
    else
        echo "  → ruff, makemigrations: skipped — nothing under backend/ changed"
    fi
    cd "$ROOT" || exit 1
fi
[ "$STATIC_RED" = 0 ]
}  # static_backend

# pytest_finish — progress every 30 s until pytest (here, or over ssh) exits, then its verdict.
# Each progress line is followed by the tests that failed since the last one, by node id (2026-11-15, user
# decision): a long run used to say "failed so far: 3" for twenty minutes and name them only at its end — or
# never, when the time limit ended it first. pytest runs with -v for this, so every test has a line of its
# own: `path::name FAILED [ 12%]` serially, `[gw0] [ 12%] FAILED path::name` under xdist.
# With SHARDED_PID / SHARDED_LOG set (`--real-pg --full`, SHARDED GROUP BESIDE THE SUITE below) it follows
# both runs, a progress line each, and both exit codes decide.
# GATES_PROGRESS_EVERY (seconds) is the test seam.
# The percentage counts tests, not time, and the last few are minutes each (2026-11-19: 99% for 10–15 of ~35
# minutes). So the line also says what each worker is running and for how long, and how much is left — the
# scheduler's status file (<log>.status), read by backend/config/gate_progress.py; the estimate needs history.
# pytest_progress: defined above TESTS ON THE GATE HOSTS, which uses it too.
pytest_summary() {  # <log> <status>
    # The thirty slowest over 5 s, so a run that stalls says where (--durations=30 --durations-min=5 below).
    sed -n '/slowest [0-9]* *durations/,/^$/p' "$1" | sed 's/^/    /'
    # COLD (migrated) or HOT (cloned), the input hash, the seconds — the root conftest's summary line
    # (backend/config/sqlite_template.py, telemetry 2026-11-13). Named here: `tail -4` may not reach it.
    grep -m1 '^test template: ' "$1" | sed 's/^/    /'
    tail -4 "$1"
    rm -f "$1.status" "$1.status.tmp"
    if [ "$2" -eq 0 ]; then rm -f "$1"; else echo "    full log: $1"; fi
}
pytest_finish() {
    local every="${GATES_PROGRESS_EVERY:-30}" shown_main="" shown_sharded="" main_on sharded_on main_s="" sharded_s=""
    T0=$(date +%s); NEXT=$every; SHARDED_STATUS=0
    while :; do
        main_on=0; sharded_on=0
        EL=$(( $(date +%s) - T0 ))
        if kill -0 "$PYTEST_PID" 2>/dev/null; then main_on=1; else main_s="${main_s:-$EL}"; fi
        if [ -n "${SHARDED_PID:-}" ]; then
            if kill -0 "$SHARDED_PID" 2>/dev/null; then sharded_on=1; else sharded_s="${sharded_s:-$EL}"; fi
        fi
        [ "$main_on$sharded_on" = 00 ] && break
        sleep 1
        EL=$(( $(date +%s) - T0 ))
        if [ "$EL" -ge "$NEXT" ]; then
            NEXT=$(( NEXT + every ))
            [ "$main_on" = 1 ] && pytest_progress pytest "$PYTEST_LOG" shown_main
            [ "$sharded_on" = 1 ] && pytest_progress "pytest (sharded group)" "$SHARDED_LOG" shown_sharded
        fi
    done
    wait "$PYTEST_PID"; PYTEST_STATUS=$?
    if [ -n "${SHARDED_PID:-}" ]; then
        wait "$SHARDED_PID"; SHARDED_STATUS=$?
        echo "  → pytest: sharded group, exit $SHARDED_STATUS in ${sharded_s}s"
        pytest_summary "$SHARDED_LOG" "$SHARDED_STATUS"
        echo "  → pytest: suite, exit $PYTEST_STATUS in ${main_s}s"
    fi
    pytest_summary "$PYTEST_LOG" "$PYTEST_STATUS"
    # Stop the throwaway before deciding, so a failure does not leak a daemon.
    [ -n "$RPORT" ] && redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1
    local why=""
    [ "$PYTEST_STATUS" -eq 0 ] || why="pytest failed"
    [ "$SHARDED_STATUS" -eq 0 ] || why="${why:+$why; }pytest (sharded group, --ds=config.settings_sharded -m sharded) failed"
    [ -z "$why" ] || fail "$why"
    cd "$ROOT" || exit 1
}

# pg_only_tests — node ids of every test SQLite skips, from the scanner test_concurrency.py pins the set with.
pg_only_tests() {
    # GATES_PG_ONLY_TESTS is the test seam (the gate tests' stand-in python has no Django).
    [ -n "${GATES_PG_ONLY_TESTS:-}" ] && { printf '%s\n' "$GATES_PG_ONLY_TESTS"; return 0; }
    (cd "$ROOT/backend" && SECRET_KEY="$CI_SECRET_KEY" DATABASE_URL="sqlite:///:memory:" "$PY" - <<'PG_ONLY_PY'
import ast, os, sys
from pathlib import Path
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, ".")
import django
django.setup()
from tests.test_concurrency import _sqlite_skipped_tests
for p in sorted(Path(".").rglob("*.py")):
    if {".venv", "node_modules"} & set(p.parts):
        continue
    if p.name.startswith("test_") or p.name == "tests.py":
        for name in _sqlite_skipped_tests(ast.parse(p.read_text(encoding="utf-8"))):
            print(f"{p.as_posix()}::{name}")
PG_ONLY_PY
    ) 2>/dev/null
}

# RUN_BACKEND: the whole suite. BACKEND_READERS: nothing under backend/ changed,
# only the tests that read the areas that did (see above) — no ruff and no
# makemigrations, which read nothing outside backend/.
# A function so the remote run can start it beside the JS tests (TWO SIDES AT ONCE, near the end).
run_backend_tests() {
if [ "$RUN_BACKEND" = 1 ] || [ -n "$BACKEND_READERS" ]; then
    cd "$ROOT/backend" || fail "backend/ missing"

    echo "  → pytest"
    # PYTEST_PREPUSH_ARGS lets one machine exclude tests its environment cannot
    # run (this repo's websocket tests need a reachable Redis). It is an
    # exclusion list, so it is stated per-machine and visible in the output
    # below rather than hidden in the hook.
    [ -n "${PYTEST_PREPUSH_ARGS:-}" ] && echo "    (with ${PYTEST_PREPUSH_ARGS})"

    # PROBE THE SERVICES THAT WILL ACTUALLY BE USED, THEN SAY WHICH ONES RAN.
    #
    # The effective targets are not simply backend/.env: `.prepush.env` is
    # sourced above and may already override either one. On the machine this
    # was written for it exports DATABASE_URL=sqlite:///:memory: and leaves
    # REDIS_URL alone — so the database was already isolated and only the cache
    # still pointed at the shared box. Probing backend/.env would have reported
    # a PostgreSQL host that this run never contacts.
    #
    # WHY THIS EXISTS. On 2026-09-04 the shared box answered ping and refused
    # both ports, and pytest reported ONE failure:
    # `test_a_warm_read_does_not_touch_the_database_per_codename`. That test
    # warms the permission cache and asserts the second read is cheap; with
    # Redis unreachable the cache write degrades silently, so the warm read is
    # a cold read and the assertion cannot hold. Nothing was wrong with the
    # commit — but the push was refused. A dead box must not read as a red suite.
    #
    # Each service falls back on its own. A reachable PostgreSQL is worth
    # keeping when it is there: CLAUDE.md records two shipped bugs SQLite could
    # not have caught (a failed statement aborts the transaction on PostgreSQL
    # and does not on SQLite; varchar(n) length is enforced there and ignored
    # here). Dropping to SQLite is a real loss, so it is announced rather than
    # silently substituted.
    #
    # THE CACHE IS ALWAYS THROWN AWAY WHEN IT CAN BE — reachable or not.
    #
    # Until 2026-09-11 a reachable shared Redis was used as-is, on the ground
    # that the owner had confirmed (2026-09-04) nobody else uses that box. That
    # was a decision with a condition, and it was reversed on the owner's
    # instruction rather than because the condition broke. What the suite writes
    # there is not only Django-cache traffic: conftest.py swaps CACHES for
    # LocMem, but `apps/perm/cache.py` opens its OWN client from
    # `settings.REDIS_URL`, and so does the channels layer — the LocMem override
    # covers neither. So every push wrote permission-cache keys into the shared
    # Redis, and each `invalidate_all_permissions()` in the cache tests deleted
    # every `perm:*` key in it — whoever wrote them. A throwaway redis-server is
    # still a real Redis, so nothing
    # the tests measure is lost, and the push no longer depends on 115's cache
    # being up at all.
    #
    # The configured cache is used only when redis-server is not installed, and
    # the run says so. Unreachable AND no redis-server is still a refusal: the
    # permission-cache tests degrade silently without a cache and report a false
    # red, which is the 2026-09-04 failure described above.
    # Reports one line per service: "<name> <ok|down> <detail>".
    RPORT=""
    if :; then
    # --real-pg: the database is backend/.env's PostgreSQL, never .prepush.env's SQLite override, and
    # a worktree has no backend/.env of its own (gitignored) — the main checkout's describes the same box.
    if [ "$REAL_PG" = 1 ]; then
        unset DATABASE_URL
        PG_URL="${GATES_PG_URL:-}"   # a delegated run is handed its PostgreSQL (DELEGATED RUNS, near the lock)
        for f in "$ROOT/backend/.env" "${MAIN_ROOT:+$MAIN_ROOT/backend/.env}"; do
            [ -n "$PG_URL" ] && break
            [ -n "$f" ] && [ -f "$f" ] || continue
            PG_URL=$(sed -nE "s/^DATABASE_URL=[\"']?([^\"']*)[\"']?\$/\\1/p" "$f" | tail -1)
            [ -n "$PG_URL" ] && break
        done
        case "$PG_URL" in
            postgres://*|postgresql://*) export DATABASE_URL="$PG_URL" ;;
            "") fail "--real-pg: no DATABASE_URL in backend/.env (looked under $ROOT${MAIN_ROOT:+ and $MAIN_ROOT})" ;;
            *) fail "--real-pg: backend/.env's DATABASE_URL is not PostgreSQL (${PG_URL%%:*}://…)" ;;
        esac
    fi
    PROBE=$(ENV_FILE="$ROOT/backend/.env" DB_URL="${DATABASE_URL:-}" RD_URL="${REDIS_URL:-}" "$PY" - <<'PROBE_PY'
import os, re, socket

def from_env_file(key):
    # An absolute path from $ROOT. A relative one is wrong here: the hook has
    # already `cd`-ed into $ROOT/backend by this point, so "backend/.env"
    # resolves to backend/backend/.env and silently finds nothing — which is
    # how the first version of this probe printed "redis: unknown (unset)"
    # and started a throwaway cache while claiming the real one was down.
    # The outcome was harmless; the stated reason was false.
    try:
        with open(os.environ.get("ENV_FILE", ""), encoding="utf-8") as f:
            for line in f:
                if line.lstrip().startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""

def check(name, url):
    # sqlite / in-memory needs no socket.
    if url.startswith("sqlite"):
        print(f"{name} ok in-memory"); return
    # urlsplit, not a regex: a regex for "word:digits" matched "user:6…" when a password began
    # with a digit (the Windows PC's sl-pg-test, 2026-11-17) and probed host "sl" port 6.
    from urllib.parse import urlsplit
    try:
        u = urlsplit(url)
        host, port = u.hostname, u.port or {"postgres": 5432, "postgresql": 5432, "redis": 6379}.get(u.scheme)
    except ValueError:
        host = port = None
    if not host or not port:
        print(f"{name} unknown {'(set)' if url else '(unset)'}"); return
    s = socket.socket(); s.settimeout(3)
    try:
        s.connect((host, port)); print(f"{name} ok {host}:{port}")
    except OSError:
        print(f"{name} down {host}:{port}")
    finally:
        s.close()

check("db", os.environ.get("DB_URL") or from_env_file("DATABASE_URL"))
check("redis", os.environ.get("RD_URL") or from_env_file("REDIS_URL"))
PROBE_PY
)
    DB_STATE=$(echo "$PROBE" | awk '$1=="db"{print $2" "$3}')
    RD_STATE=$(echo "$PROBE" | awk '$1=="redis"{print $2" "$3}')
    echo "    db: $DB_STATE | redis: $RD_STATE"

    RPORT=""
    case "$DB_STATE" in
        ok*) ;;
        *)  [ "$REAL_PG" = 1 ] && fail "--real-pg: PostgreSQL unreachable ($DB_STATE). Not falling back to SQLite: that is the run this one exists to complement."
            echo "    → database unreachable, using in-memory SQLite"
            echo "      NOTE: SQLite ignores varchar(n) and does not abort a"
            echo "            transaction on a failed statement. Two shipped"
            echo "            bugs needed PostgreSQL to surface. Weaker run."
            export DATABASE_URL="sqlite:///:memory:" ;;
    esac
    if command -v redis-server >/dev/null 2>&1; then
        echo "    → starting a throwaway redis-server (configured cache is never used when this is possible)"
        RPORT=$("$PY" -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); print(p)")
        redis-server --port "$RPORT" --daemonize yes --save '' --appendonly no >/dev/null 2>&1 \
            || fail "could not start a throwaway redis-server on port $RPORT"
        # Also stop it when the run is interrupted (Ctrl-C, a killed push): the shutdown
        # below only runs on a normal finish, and one interrupted push on 2026-10-09 left
        # this daemon running for a day. Chains the gate lock's own EXIT trap.
        # Inside a side's subshell (IN_SIDE) the lock stays: the parent still holds it for the other side.
        trap 'redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1; [ -z "${IN_SIDE:-}" ] && type gate_unlock >/dev/null 2>&1 && gate_unlock' EXIT
        trap 'exit 130' INT TERM
        export REDIS_URL="redis://127.0.0.1:$RPORT/0"
        export CELERY_BROKER_URL="redis://127.0.0.1:$RPORT/1"
        export CELERY_RESULT_BACKEND="redis://127.0.0.1:$RPORT/2"
    else
        case "$RD_STATE" in
            ok*) echo "    → redis-server not installed — using the configured cache ($RD_STATE)"
                 echo "      NOTE: this run writes permission-cache keys into it and"
                 echo "            invalidates that cache's perm:* keys. Install redis-server to isolate." ;;
            *)   fail "redis-server not found and the configured cache is unreachable ($RD_STATE). Refusing rather than running without one: the permission-cache tests degrade silently and report a false red, which is exactly the failure this probe exists to prevent." ;;
        esac
    fi

    fi
    # --no-cov: the coverage floor (--cov-fail-under in pytest.ini) is checked
    # in CI only — `ci.yml` runs the plain command. Accepted trade-off
    # (2026-09-29): measuring coverage costs this gate minutes on every push,
    # and CI is manual-dispatch only, so a drop below the floor is found when
    # someone dispatches it, not when it is pushed.
    #
    # SECRET_KEY: always the ≥32-byte test key here. The suite needs *a* key,
    # not the developer's: a checkout's backend/.env may hold a shorter one
    # (the main checkout's was 20 bytes on 2026-09-29), and pytest.ini turns
    # PyJWT's short-key warning into an error, so every JWT test would fail.
    SKIP_MIGRATION=""
    if [ "$RUN_MIGRATION" = 1 ]; then
        echo "    (with the migration round trips: the push touches migrations or their tests)"
    else
        SKIP_MIGRATION=1
        echo "    (-m 'not migration': nothing the 26 round-trip tests exercise changed)"
    fi
    # Progress every 30 s instead of silence: the run takes minutes and `-q`
    # piped through `tail` printed nothing until it ended. The full log is kept
    # on failure, like the jest one above.
    #
    # -n $PYTEST_WORKERS (pytest-xdist, requirements-dev.txt) when it is installed. 2 since 2026-10-27
    # (see TWO WORKERS near the top); it was 4 (measured 2026-09-29 at 4:21 against 5:43 serial).
    # PYTEST_WORKERS=0 runs serially; CI runs -n auto (ci.yml).
    XDIST=""
    if [ "$PYTEST_WORKERS" != "0" ] && "$PY" -c "import xdist" 2>/dev/null; then
        # --dist worksteal: an idle worker takes tests from a busy one. Plain -n hands out chunks up front,
        # and the slow migration round trips (1–2 min each) ended up queued on one worker: the full run sat
        # at 99% for 30–40 minutes on one busy worker with seven idle (2026-10-29, twice).
        # It was off from 2026-10-28 because reordering turned realtime tests red (9 and 11 failures). The
        # cause was test_event_bus emptying the process-wide handler registry; the root conftest now restores
        # it after every test (e56a6a2e), and two worksteal full runs then passed 8076/8076.
        # Still no --ff: it reorders across runs for no gain once the suite is this short.
        XDIST="-n $PYTEST_WORKERS --dist worksteal"
        echo "    (pytest-xdist: $XDIST)"
    fi
    # A full run (--full, GATES_FULL=1, a push to main) migrates for real instead of
    # loading the cached SQLite template, and checks that template against what it
    # migrated — backend/config/sqlite_template.py. Other runs reuse the template.
    if [ "$FULL_RUN" = 1 ]; then
        export SOULLEDGER_SQLITE_TEMPLATE=0
        echo "    (SQLite: real migrate + template check, SOULLEDGER_SQLITE_TEMPLATE=0)"
    fi
    # The remote run keeps its PostgreSQL template between runs (config/testdb.py). Its xdist controller
    # collects no tests, so it cannot see round trips in the run the way the SQLite template does: say it here.
    # A full run is already covered by the line above.
    if [ "${GATES_IN_REMOTE:-0}" = 1 ]; then
        [ "$RUN_MIGRATION" = 1 ] && export SOULLEDGER_SQLITE_TEMPLATE=0
        if [ "${SOULLEDGER_SQLITE_TEMPLATE:-}" = 0 ]; then
            echo "    (PostgreSQL: real migrate, checked against the kept template of the same input hash)"
        else
            echo "    (PostgreSQL: the kept template of this input hash, if there is one — config/testdb.py)"
        fi
    fi
    PYTEST_LOG=$(mktemp "${TMPDIR:-/tmp}/prepush-pytest.XXXXXX")
    # PER-TEST DURATIONS BETWEEN RUNS (2026-11-19). The controller records what each test took
    # (backend/config/gate_progress.py); the scheduler (config/worksteal.py) orders the next run longest first and
    # starts the migration round trips on dedicated workers, and the progress line estimates what is left. One file
    # per database kind: on the remote boxes under the synced tree's node_modules/.cache (the sync keeps it, like
    # the jest cache), here in the git common dir. GATES_TEST_DURATIONS overrides. A missing or corrupt file is
    # an empty history: no estimate, plain worksteal order.
    if [ "${GATES_IN_REMOTE:-0}" = 1 ]; then DUR_DIR="$ROOT/node_modules/.cache"
    else DUR_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; fi
    DUR_KIND=sqlite; { [ "$REAL_PG" = 1 ] || [ "${GATES_IN_REMOTE:-0}" = 1 ]; } && DUR_KIND=pg
    mkdir -p "${DUR_DIR:-.}" 2>/dev/null
    export SOULLEDGER_TEST_DURATIONS="${GATES_TEST_DURATIONS:-${DUR_DIR:-.}/soulledger-test-durations-$DUR_KIND.json}"
    # Round-trip start states (tests/migration_roundtrip.py, SOULLEDGER_RT_START_CACHE): same place; SQLite only.
    if [ -n "$DUR_DIR" ]; then export SOULLEDGER_RT_START_CACHE="${SOULLEDGER_RT_START_CACHE:-$DUR_DIR/soulledger-rt-start-cache}"; fi
    PYTEST_PATHS=""
    META_IGNORE=""
    if [ -n "$META_SKIP" ]; then
        META_IGNORE=$(echo "$META_SKIP" | sed 's|^backend/|--ignore=|' | tr '\n' ' ')
        echo "    (without $(echo "$META_SKIP" | grep -c .) of the 2 suite-about-the-suite tests: nothing they guard changed — $(echo "$META_SKIP" | sed 's|.*/||' | paste -sd' ' -))"
    fi
    if [ "$RUN_BACKEND" = 0 ]; then
        # Readers are listed relative to backend/; drop the meta tests here too, and
        # if nothing is left run nothing — an empty path list would mean "the whole suite".
        PYTEST_PATHS="$BACKEND_READERS"
        [ -n "$META_SKIP" ] && PYTEST_PATHS=$(echo "$PYTEST_PATHS" | grep -vxF "$(echo "$META_SKIP" | sed 's|^backend/||')" || true)
        echo "    (only the $(echo "$PYTEST_PATHS" | grep -c . || true) test files that read what changed — backend/tests/reads-outside-backend.txt)"
    fi
    # BY APP, NOT THE WHOLE SUITE (2026-10-27, user decision): a backend change runs the test files
    # that belong to, name, or call the URLs of the apps it touched — scripts/select-backend-tests.py,
    # which also says when a change cannot be traced (settings, a conftest, dependencies) and the
    # whole suite runs. --full / GATES_FULL=1 always run everything. The files that read other areas
    # (reads-outside-backend.txt) are added as on a backend-less push: the lines naming a top-level
    # entry this push changed. A push that changed only backend/ matches none of them by that rule, so
    # the selection itself adds the frontend / packages / mobile lines — the contracts between the
    # backend and the other side — for any non-test change under backend/apps/ (2026-11-13,
    # `contract_readers` in select-backend-tests.py). The two sets are unioned below.
    if [ "$RUN_BACKEND" = 1 ] && [ "$FULL_RUN" = 0 ] && [ ! -f "$HERE/select-backend-tests.py" ]; then
        echo "    (whole suite: no select-backend-tests.py next to this script)"
    elif [ "$RUN_BACKEND" = 1 ] && [ "$FULL_RUN" = 0 ]; then
        backend_selection "$PY" || fail "select-backend-tests.py failed"
        SELECTED="$BE_SEL"
        case "$SELECTED" in
            FULL*) echo "    (whole suite: ${SELECTED#FULL	})" ;;
            *)
                READERS=$(readers_for "$READERS_LIST" 2>/dev/null)
                # The suite-about-the-suite tests this run owes (RUN_META / RUN_SCOPE) are named outright. The
                # selection picks by app and the readers by top-level entry; neither knows those rules, so a
                # rule that said "run it" only stopped ignoring a test nothing had selected: a changed
                # apps/*/tests.py or a new test file ran without test_collection_scope.py (2026-11-13).
                META_RUN=$(echo "$META_TESTS" | grep -vxF "${META_SKIP:-(none skipped)}" | sed 's|^backend/||' || true)
                PYTEST_PATHS=$(printf '%s\n%s\n%s\n' "$SELECTED" "$READERS" "$META_RUN" | grep -v '^$' | sort -u)
                [ -n "$META_SKIP" ] && PYTEST_PATHS=$(echo "$PYTEST_PATHS" | grep -vxF "$(echo "$META_SKIP" | sed 's|^backend/||')" || true)
                if [ "$REAL_PG" = 1 ] || [ "${GATES_IN_REMOTE:-0}" = 1 ]; then
                    PG_ONLY=$(pg_only_tests) || fail "--real-pg: could not list the PostgreSQL-only tests"
                    [ -n "$PG_ONLY" ] || fail "--real-pg: the PostgreSQL-only test list came back empty — the scanner in tests/test_concurrency.py is broken, not the set"
                    PYTEST_PATHS=$(printf '%s\n%s\n' "$PYTEST_PATHS" "$PG_ONLY" | grep -v '^$' | sort -u)
                    echo "    (plus the $(echo "$PG_ONLY" | grep -c .) PostgreSQL-only tests — tests/test_concurrency.py pins the set)"
                fi
                echo "    (by app: $(echo "$PYTEST_PATHS" | grep -c . || true) test files — scripts/select-backend-tests.py; --full runs all)"
                [ -z "$PYTEST_PATHS" ] && RUN_BACKEND=0
                ;;
        esac
    fi
    # Nothing selected: no pytest, and the checks after this one still run (it used to be the last step).
    PYTEST_SKIP=0
    if [ "$RUN_BACKEND" = 0 ] && [ -z "$PYTEST_PATHS" ]; then
        echo "    nothing to run"
        [ -n "$RPORT" ] && redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1
        PYTEST_SKIP=1
    fi
    if [ "$PYTEST_SKIP" = 0 ]; then
    # A HUNG TEST COSTS ONE WORKER, NOT THE PUSH (2026-10-27). Without this a test that blocks
    # (2026-10-19: a worker idle in transaction, another stuck on a thread lock, CPU 0, no output)
    # held the gate lock for hours and every other session waited behind it. A test past the limit
    # dumps every thread's stack into the log and its worker exits, so the run ends red and names
    # it. The slowest test measured is a 67 s migration round trip; 300 s leaves room for load.
    TEST_TIMEOUT="${PYTEST_TEST_TIMEOUT:-300}"
    # Real PostgreSQL: a fresh per-run test database (a stale test_soulledger caused ~1800 errors once),
    # and a 600 s limit — the network round trips make the slow tests slower (CLAUDE.md, the real-PG command).
    REAL_PG_ARGS=""
    if [ "$REAL_PG" = 1 ] || [ "${GATES_IN_REMOTE:-0}" = 1 ]; then REAL_PG_ARGS="--create-db"; TEST_TIMEOUT="${PYTEST_TEST_TIMEOUT:-600}"; fi
    # SHARDED GROUP BESIDE THE SUITE (2026-11-16, user decision). Sharding stage 2: the four civilization shards
    # exist only under settings_sharded (a `sharded` test skips anywhere else), so the suite skips the group,
    # and `--real-pg --full` runs it on the same PostgreSQL and Redis (C21, 2026-10-31: then the multi-database
    # guard, which this group replaced): tests/test_control_boundary.py, tests/test_shard_sync.py ...
    # It ran serially before the suite and took 35+ minutes on PostgreSQL (2026-11-16). Now it runs at the same
    # time, under xdist: GATES_SHARDED_WORKERS of the PYTEST_WORKERS (default a sixth, rounded up: 2 of 11-12 — 2026-11-16, the group finished at ~20 min beside a ~59 min suite) and the suite
    # the rest, so the two together stay within the CPUs PYTEST_WORKERS was sized for. Each of its workers
    # clones default and the four shards from the controller's templates (root conftest.py; on the remote box
    # the kept template of the input hash). Its own log; both exit codes decide (pytest_finish).
    SHARDED_PID=""
    if [ "$REAL_PG" = 1 ] && [ "$FULL_RUN" = 1 ]; then
        SHARDED_XDIST=""
        if [ -n "$XDIST" ]; then
            SHARDED_WORKERS="${GATES_SHARDED_WORKERS:-$(( (PYTEST_WORKERS + 5) / 6 ))}"
            MAIN_WORKERS=$(( PYTEST_WORKERS - SHARDED_WORKERS )); [ "$MAIN_WORKERS" -ge 1 ] || MAIN_WORKERS=1
            SHARDED_XDIST="-n $SHARDED_WORKERS --dist worksteal"
            XDIST="-n $MAIN_WORKERS --dist worksteal"
        fi
        echo "  → pytest: sharded group (--ds=config.settings_sharded -m sharded, ${SHARDED_XDIST:-serial}) beside the suite (${XDIST:-serial})"
        SHARDED_LOG=$(mktemp "${TMPDIR:-/tmp}/prepush-pytest-sharded.XXXXXX")
        # shellcheck disable=SC2086
        SECRET_KEY="$CI_SECRET_KEY" SOULLEDGER_GATE_STATUS="$SHARDED_LOG.status" "$PY" -m pytest -v --no-header --no-cov --durations=30 --durations-min=5 \
            $SHARDED_XDIST -o faulthandler_timeout="$TEST_TIMEOUT" -o faulthandler_exit_on_timeout=true \
            $REAL_PG_ARGS --ds=config.settings_sharded -m sharded >"$SHARDED_LOG" 2>&1 &
        SHARDED_PID=$!
    fi
    PYARGS=(-v --no-header --no-cov --durations=30 --durations-min=5 $XDIST
        -o faulthandler_timeout="$TEST_TIMEOUT" -o faulthandler_exit_on_timeout=true $REAL_PG_ARGS
        ${SKIP_MIGRATION:+-m "not migration"} $META_IGNORE ${PYTEST_PREPUSH_ARGS:-} $PYTEST_PATHS)
    SECRET_KEY="$CI_SECRET_KEY" SOULLEDGER_GATE_STATUS="$PYTEST_LOG.status" "$PY" -m pytest "${PYARGS[@]}" >"$PYTEST_LOG" 2>&1 &
    PYTEST_PID=$!
    pytest_finish
    fi  # PYTEST_SKIP = 0
    cd "$ROOT" || exit 1
fi
}  # run_backend_tests

# The JS test runners, in order. A function for the same reason as run_backend_tests.
run_js_tests() {
# Core first: it is the frontend's dependency, it is fast, and a boundary
# failure should be the thing you read rather than the tsc error it causes 400
# lines later.
if [ "$RUN_CORE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    # `typecheck` alone does NOT catch the widest hole in this boundary.
    # `types: []` only disables *automatic* @types inclusion; it does not stop
    # ambient globals arriving through an import. hooks/useStatutes.ts pulls in
    # @tanstack/react-query -> @types/react -> @types/react/global.d.ts, which
    # declares Document, HTMLElement, MouseEvent and ~150 more as **empty
    # interfaces**. Measured: `export const el: HTMLElement = {}` compiles
    # clean in this package, because `{}` satisfies an empty interface. So a
    # DOM-shaped signature passes tsc while being unimplementable on RN.
    # domBoundary.test.ts builds a program from this very tsconfig (not a
    # hand-copy, which would drift) and asserts those names stay unresolvable.
    # Without this line it would be a guard nobody runs — which is the exact
    # defect the `packages/` gate above was added to fix.
    # Plain `test` — no coverage floor here anymore. `vitest.config.ts` used
    # to carry one, but its denominator was core's whole source and its
    # numerator only the ~7 files core has its own vitest tests for (9%): it
    # measured "how much of core has its own tests", not "how much of core is
    # tested" — most of core's hooks/API modules are exercised by the
    # frontend's jest suites via the `@soulledger/core` mappings, which that
    # gate could not see. As of 2026-09-14 `frontend/jest.config.js` has
    # `rootDir` at the repo root and a path-scoped coverageThreshold for
    # `packages/core/src`, and the frontend gate below runs that.
    echo "  → core vitest"
    npm run --workspace packages/core test --silent -- --maxWorkers="$VITEST_WORKERS" \
        || fail "@soulledger/core tests failed. If it is domBoundary.test.ts: a DOM or Node global reached the platform-independent package. That is a host capability and belongs behind a PlatformAdapter port — do not widen \`lib\` to make it compile."
fi

# RUN_FRONTEND already folds in TOUCHES_CORE (scripts/gates_classify.py).
if [ "$RUN_FRONTEND" = 1 ]; then
    need npx
    cd "$ROOT/frontend" || fail "frontend/ missing"
    # The last 4 lines say "1 failed" and name nothing. 2026-09-25 a push was
    # refused twice for one test that never failed outside the hook, and there
    # was no way to tell which. On failure, print the failing files and tests
    # and keep the whole log.
    echo "  → jest"
    ALWAYS_LIST="$ROOT/frontend/jest.always-run.txt"
    [ -z "$FULL_F" ] && [ ! -f "$ALWAYS_LIST" ] && full "no frontend/jest.always-run.txt in this checkout"
    JEST_PATHS=""
    if [ -z "$FULL_F" ]; then
        # `--roots` adds packages/core: jest.config.js roots only `frontend/`, so
        # a changed core file is outside jest's graph and --findRelatedTests
        # returns nothing for it — no error, just an empty selection. Measured
        # 2026-09-30: packages/core/src/hooks/useSouls.ts → 0 related tests
        # without it, 20 with; the full test list is 196 either way.
        SRC=$(echo "$CHANGED_JS" | grep -E '^(frontend|packages/core)/' | while IFS= read -r f; do [ -f "$ROOT/$f" ] && echo "$ROOT/$f"; done)
        RELATED=""
        if [ -n "$SRC" ]; then
            # shellcheck disable=SC2086
            RELATED=$(npx jest --roots '<rootDir>/frontend' --roots '<rootDir>/packages/core' \
                --listTests --findRelatedTests $SRC 2>/dev/null) \
                || full "jest --findRelatedTests failed, so the selection is unknown"
            RELATED=$(echo "$RELATED" | grep '^/' || true)
        fi
    fi
    if [ -z "$FULL_F" ]; then
        ALWAYS=$(awk '!/^[[:space:]]*(#|$)/ { print $1 }' "$ALWAYS_LIST" | sed "s|^|$ROOT/frontend/|")
        JEST_PATHS=$(printf '%s\n%s\n' "$RELATED" "$ALWAYS" | grep -v '^$' | sort -u)
        n() { [ -n "$1" ] && echo "$1" | wc -l | tr -d ' ' || echo 0; }
        # No "of <total>": counting it started a second jest just to list files.
        echo "    affected: $(n "$JEST_PATHS") test files ($(n "$RELATED") related to the change, $(n "$ALWAYS") always-run)"
    else
        echo "    FULL, because:"; printf '%s' "$FULL_F" | sed 's/^/      /'
    fi
    JEST_LOG=$(mktemp "${TMPDIR:-/tmp}/prepush-jest.XXXXXX")
    T_JEST=$(date +%s)
    # COVERAGE ON --full ONLY (A3, 2026-10-31). jest.config.js's coverageThreshold (global, and
    # packages/core/src) is evaluated only under --coverage, and until now only CI passed it. A selective
    # run cannot judge it: each threshold is an aggregate over every file under its key, and the related
    # tests leave most of those files unexecuted — so a core change gets no core-scoped coverage check here.
    JEST_COV=--coverage=false
    [ "$FULL_RUN" = 1 ] && { JEST_COV=--coverage; echo "    with coverage: --full checks jest.config.js's coverageThreshold"; }
    # shellcheck disable=SC2086
    npx jest $JEST_COV --silent ${JEST_PATHS:+--runTestsByPath $JEST_PATHS} >"$JEST_LOG" 2>&1
    JEST_STATUS=$?
    tail -4 "$JEST_LOG"
    echo "    jest took $(( $(date +%s) - T_JEST ))s"
    if [ "$JEST_STATUS" -ne 0 ]; then
        grep -E '^(FAIL |  ● |Jest: .*coverage threshold)' "$JEST_LOG" | awk '!seen[$0]++' | head -20
        echo "    full jest log: $JEST_LOG"
        fail "jest failed"
    fi
    rm -f "$JEST_LOG"
    cd "$ROOT" || exit 1
fi

# The frontend is not running, so its file readers do (see TESTS THAT READ
# ANOTHER AREA'S FILES above).
if [ "$RUN_JEST_READERS" = 1 ]; then
    need npx
    cd "$ROOT/frontend" || fail "frontend/ missing"
    ALWAYS=$(echo "$JEST_READERS" | sed "s|^|$ROOT/frontend/|")
    echo "  → jest: the $(echo "$ALWAYS" | grep -c . || true) tests that read what changed (frontend/jest.always-run.txt)"
    JEST_LOG=$(mktemp "${TMPDIR:-/tmp}/prepush-jest.XXXXXX")
    T_JEST=$(date +%s)
    # shellcheck disable=SC2086
    npx jest --coverage=false --silent --runTestsByPath $ALWAYS >"$JEST_LOG" 2>&1
    JEST_STATUS=$?
    tail -4 "$JEST_LOG"
    echo "    jest took $(( $(date +%s) - T_JEST ))s"
    if [ "$JEST_STATUS" -ne 0 ]; then
        grep -E '^(FAIL |  ● )' "$JEST_LOG" | head -20
        echo "    full jest log: $JEST_LOG"
        fail "jest (file readers) failed"
    fi
    rm -f "$JEST_LOG"
    cd "$ROOT" || exit 1
fi

# app_jest <dir> <changed-path regex> <extra --roots> <failure message> — the full-run reasons are APP_FULL_F (scripts/gates_classify.py).
app_jest() {
    local dir="$1" re="$2" roots="$3" msg="$4" paths="" related="" readers src log status
    echo "  → $dir jest"
    if [ -z "$APP_FULL_F" ]; then
        src=$(echo "$CHANGED_JS" | grep -E "$re" | while IFS= read -r f; do [ -f "$ROOT/$f" ] && echo "$ROOT/$f"; done)
        if [ -n "$src" ]; then
            # shellcheck disable=SC2086
            related=$(cd "$ROOT/$dir" && npx jest --roots '<rootDir>/src' $roots --listTests --findRelatedTests $src 2>/dev/null) \
                || APP_FULL_F="jest --findRelatedTests failed, so the selection is unknown"$'\n'
            related=$(echo "$related" | grep "^$ROOT/$dir/src/" || true)
        fi
    fi
    if [ -z "$APP_FULL_F" ]; then
        readers=$(git ls-files "$dir/src/*.test.ts" "$dir/src/*.test.tsx" | while IFS= read -r f; do
            grep -lE "$READS_FILES_RE" "$ROOT/$f" 2>/dev/null
        done)
        paths=$(printf '%s\n%s\n' "$related" "$readers" | grep -v '^$' | sort -u)
        echo "    affected: $(echo "$paths" | grep -c . || true) test files ($(echo "$related" | grep -c . || true) related to the change, $(echo "$readers" | grep -c . || true) that read files)"
        # Empty here means "nothing affected", never "everything": no --runTestsByPath would run the suite.
        [ -z "$paths" ] && { echo "    nothing to run"; return 0; }
    else
        echo "    FULL, because:"; printf '%s' "$APP_FULL_F" | sed 's/^/      /'
    fi
    # Kept to a file and named on failure, as the web jest above: `| tail -4` printed only the
    # totals, so a red run (2026-10-01, load 87, green on retry) left no trace of which test.
    log=$(mktemp "${TMPDIR:-/tmp}/prepush-$dir-jest.XXXXXX")
    # --full runs the app's `test:coverage` when it has one (its thresholds), as CI's job does; else `test`.
    local script=test
    [ "$FULL_RUN" = 1 ] && grep -q '"test:coverage"' "$ROOT/$dir/package.json" && { script=test:coverage; echo "    with coverage: npm run test:coverage"; }
    # shellcheck disable=SC2086
    npm run --workspace "$dir" "$script" --silent -- --silent ${paths:+--runTestsByPath $paths} >"$log" 2>&1
    status=$?
    tail -4 "$log"
    if [ "$status" -ne 0 ]; then
        grep -E '^(FAIL |  ● |Jest: .*coverage threshold)' "$log" | awk '!seen[$0]++' | head -20
        echo "    full $dir jest log: $log"
        fail "$msg"
    fi
    rm -f "$log"
}

if [ "$RUN_MOBILE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    app_jest mobile "^(mobile|packages/core|packages/mobile-ui)/" "--roots <rootDir>/../packages/core --roots <rootDir>/../packages/mobile-ui/src" \
        "mobile jest failed. If it is theme.test.ts: frontend/app/globals.css changed an ink-layer token that packages/mobile-ui/src/theme.ts copies — copy the new triple, do not delete the check."
fi

if [ "$RUN_OFFICER" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    app_jest mobile-officer "^(mobile-officer|mobile|packages/core|packages/mobile-ui)/" "--roots <rootDir>/../packages/core --roots <rootDir>/../packages/mobile-ui/src" \
        "officer jest failed. The officer app shares packages/mobile-ui with the soul app (mobile-officer/src/shared.ts): a failure here after a change there is that change reaching the officer app."
fi

if [ -n "$MOBILE_READERS" ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → mobile jest: the $(echo "$MOBILE_READERS" | wc -l | tr -d ' ') tests that read files"
    # To a file, and the failing tests named, as app_jest does: `| tail -4` showed the totals only.
    MOBILE_LOG=$(mktemp "${TMPDIR:-/tmp}/prepush-mobile-readers.XXXXXX")
    # shellcheck disable=SC2046
    npm run --workspace mobile test --silent -- --silent --runTestsByPath $(echo "$MOBILE_READERS" | sed "s|^|$ROOT/|") >"$MOBILE_LOG" 2>&1
    MOBILE_STATUS=$?
    tail -4 "$MOBILE_LOG"
    if [ "$MOBILE_STATUS" -ne 0 ]; then
        grep -E '^(FAIL |  ● )' "$MOBILE_LOG" | awk '!seen[$0]++' | head -20
        echo "    full mobile jest log: $MOBILE_LOG"
        fail "mobile jest (file readers) failed"
    fi
    rm -f "$MOBILE_LOG"
fi
}  # run_js_tests

# ── TWO SIDES AT ONCE (the remote run only, 2026-10-30, user decision) ──────────────────────────────
#
# On the gate box the backend pytest and the JS runners (core vitest, web jest, the two app jests) ran one
# after the other. There they now run side by side, each into its own log, 6 + 6 workers over the
# container's 12 CPUs (the docker run in DELEGATED RUNS). On this Mac they stay serial — memory, not CPU, is
# what runs out here (TWO WORKERS near the top): every static check, then the backend's tests, then the JS
# side's. Either way each step runs in a subshell marked IN_SIDE, so a `fail` ends only its own side, and a
# red side never stops the other (2026-11-15: here too, so that each side can be recorded on its own).
# Each side begins with its own static checks (STATIC CHECKS FIRST, above), which fail late. At the end:
# one line with both verdicts (`gates-sides:`, which a delegating machine reads to record the sides), the
# ledgers, and — when either side is red — every red step of both, then the exit.
NOTES_BE=$(mktemp "${TMPDIR:-/tmp}/gates-notes-backend.XXXXXX"); NOTES_JS=$(mktemp "${TMPDIR:-/tmp}/gates-notes-js.XXXXXX")
for side in backend js; do
    side_on "$side" || echo "  → $side side skipped (GATES_SIDES=$GATES_SIDES): nothing run, nothing recorded"
done
if [ "${GATES_IN_REMOTE:-0}" = 1 ]; then
    BE_LOG=$(mktemp "${TMPDIR:-/tmp}/gates-backend.XXXXXX"); JS_LOG=$(mktemp "${TMPDIR:-/tmp}/gates-js.XXXXXX")
    echo "  → backend (ruff, makemigrations, pytest) and JS (tsc, eslint, tests) side by side"
    ( IN_SIDE=1; NOTES="$NOTES_BE"; side_on backend || exit 0; static_backend; st=$?; run_backend_tests; exit "$st" ) >"$BE_LOG" 2>&1 &
    BE_PID=$!
    ( IN_SIDE=1; NOTES="$NOTES_JS"; side_on js || exit 0; static_js; st=$?; run_js_tests; exit "$st" ) >"$JS_LOG" 2>&1 &
    JS_PID=$!
    T0=$(date +%s); NEXT=60
    while kill -0 "$BE_PID" 2>/dev/null || kill -0 "$JS_PID" 2>/dev/null; do
        sleep 2
        if [ $(( $(date +%s) - T0 )) -ge "$NEXT" ]; then
            NEXT=$(( NEXT + 60 ))
            echo "    … $(( ($(date +%s) - T0) / 60 ))m · backend: $(grep -E '^ +(→|…)' "$BE_LOG" | tail -1 | sed 's/^ *//') · js: $(grep -E '^ +(→|…)' "$JS_LOG" | tail -1 | sed 's/^ *//')"
        fi
    done
    wait "$BE_PID"; BE_RC=$?
    wait "$JS_PID"; JS_RC=$?
    echo "  ── backend (exit $BE_RC) ──"; cat "$BE_LOG"
    echo "  ── JS (exit $JS_RC) ──"; cat "$JS_LOG"
    rm -f "$BE_LOG" "$JS_LOG"
else
    ( IN_SIDE=1; NOTES="$NOTES_JS"; side_on js || exit 0; static_js ); JS_ST=$?
    ( IN_SIDE=1; NOTES="$NOTES_BE"; side_on backend || exit 0; static_backend ); BE_ST=$?
    ( IN_SIDE=1; NOTES="$NOTES_BE"; side_on backend || exit 0; run_backend_tests ); BE_RC=$?
    ( IN_SIDE=1; NOTES="$NOTES_JS"; side_on js || exit 0; run_js_tests ); JS_RC=$?
    [ "$BE_ST" = 0 ] || BE_RC="$BE_ST"
    [ "$JS_ST" = 0 ] || JS_RC="$JS_ST"
fi
echo "gates-sides: backend=$BE_RC js=$JS_RC"

# Record each green side (A PUSH OF A TREE BOTH SIDES ALREADY PASSED, near the top). Only outside the hook,
# and only when what was tested IS HEAD's tree: tracked files match HEAD, and no untracked file sits where a
# gate could have read it — an untracked test or migration ran here but would not be in the pushed commit.
record_side backend "$BE_RC"
record_side js "$JS_RC"
if [ "$BE_RC" -ne 0 ] || [ "$JS_RC" -ne 0 ]; then
    echo ""
    sed 's/^/  backend: /' "$NOTES_BE"
    sed 's/^/  JS:      /' "$NOTES_JS"
    rm -f "$NOTES_BE" "$NOTES_JS"
    fail "checks or tests failed (backend exit $BE_RC, JS exit $JS_RC) — both sides ran to the end, logs above"
fi
rm -f "$NOTES_BE" "$NOTES_JS"
echo "$P: ok ($(( $(date +%s) - T_GATES ))s, not counting any wait for the gate lock)"
