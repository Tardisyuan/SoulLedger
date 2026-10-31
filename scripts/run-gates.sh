#!/bin/bash
# scripts/run-gates.sh — the gates `.git/hooks/pre-push` runs, runnable by hand.
#
#   scripts/run-gates.sh [--full|--affected] [--base <ref>]
#
# Outside a push the changed files are `git diff <base>` (committed, staged and
# unstaged) plus untracked files; <base> defaults to the merge-base with
# origin/main. The pre-push hook (scripts/install-hooks.sh) calls this with
# `--prepush` and the pushed range's files in PREPUSH_CHANGED; there is one copy
# of the logic, and it is this file.
#
# WHAT RUNS. Which areas run (core / frontend / mobile / officer / backend) is decided
# from the changed paths, as it always was. Inside the frontend area, jest runs
# SELECTIVELY unless something forces it FULL: the tests `jest
# --findRelatedTests` reaches from the changed files, plus every test in
# frontend/jest.always-run.txt — the tests that read files (fs, child_process,
# git) instead of importing them, which the import graph cannot see.
# src/__tests__/jestAlwaysRunList.test.ts keeps that list exact.
#
# FULL, and the run prints which rule said so: `--full`, GATES_FULL=1, a push to
# refs/heads/main, or a changed path matching FULL_RULES below. `--affected` is
# the default spelled out; it cannot override a rule, and neither can
# GATES_FULL=0 — there is deliberately no way to force selective.
#
# EVERYTHING ELSE RUNS IN FULL: tsc, eslint, core, mobile, officer, ruff,
# makemigrations — and the backend pytest. Selective backend runs with
# pytest-testmon were built and measured on 2026-09-30 and not adopted, because
# the safe version is slower than a full run (numbers in CLAUDE.md, Build &
# Test): testmon attributes to a test only the lines that ran during it, so
# anything Django evaluates at import time (model fields, serializer Meta,
# viewset attributes, urls, constant tables) is invisible to it — changing the
# souls router prefix failed 72 of 177 apps/souls tests and testmon selected 4;
# guarding that sends ~75% of historical backend commits to a full run anyway,
# the backend tests that read files have to run every time (1145 tests, 101 s
# with nothing changed), and recording costs 277 s per full run against 130 s
# without it.
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
PREPUSH=0; MODE=auto; BASE=""; REAL_PG=0; E2E=""
while [ $# -gt 0 ]; do
    case "$1" in
        --prepush)  PREPUSH=1 ;;
        --full)     MODE=full ;;
        --real-pg)  REAL_PG=1 ;;
        --e2e)      E2E=chromium ;;
        --e2e=*)    E2E="${1#--e2e=}"; [ "$E2E" = all ] && E2E="chromium,firefox,mobile-chrome" ;;
        --affected) MODE=auto ;;
        --base)     BASE="${2:?--base needs a ref}"; shift ;;
        -h|--help)  sed -n '2,36p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *)          echo "run-gates: unknown argument $1 (see --help)"; exit 2 ;;
    esac
    shift
done
P="gates"; [ "$PREPUSH" = 1 ] && P="pre-push"

ROOT="$(git rev-parse --show-toplevel)"
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
MAIN_ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." 2>/dev/null && pwd)"
PREPUSH_ENV=""
if [ -f "$ROOT/.prepush.env" ]; then
    PREPUSH_ENV="$ROOT/.prepush.env"
else
    [ -n "$MAIN_ROOT" ] && [ -f "$MAIN_ROOT/.prepush.env" ] && PREPUSH_ENV="$MAIN_ROOT/.prepush.env"
fi
if [ -n "$PREPUSH_ENV" ]; then
    echo "$P: per-machine settings from $PREPUSH_ENV"
    . "$PREPUSH_ENV"
fi

# ── THE REMOTE MACHINE (GATES_REMOTE): shared by the delegated gates and --e2e ─────────────────
RDIR="${GATES_REMOTE_DIR:-/mnt/cache/appdata/sl-gates}"
RIMG="${GATES_REMOTE_IMAGE:-sl-gates-all:1}"
RID="$(basename "$ROOT")-$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
RWORK="$RDIR/work/$RID"
# remote_sync — this tree to $GATES_REMOTE:$RWORK. Owned by the remote user, not this machine's uid:
# git there refuses a repository another user owns once the tests turn the system config off
# (GIT_CONFIG_NOSYSTEM), and four gate tests went red. node_modules, the venv, caches and the Next
# build survive the --delete.
remote_sync() {
    { git ls-files -z; git ls-files -z -o --exclude-standard -- backend frontend packages mobile mobile-officer scripts; printf '.git\0'; } \
        | rsync -a --no-owner --no-group --delete --filter='P **/node_modules/' --filter='P backend/.venv/' --filter='P **/.pytest_cache/' \
            --filter='P frontend/.next/' --filter='P .sl-*' --exclude='.git/soulledger-*' --from0 --files-from=- -r "$ROOT/" "$GATES_REMOTE:$RWORK/" \
        || return 1
    # --delete never fires under --files-from: a file deleted here is simply absent from the list, so the
    # remote copy stayed and kept running (2026-10-29: a test deleted by a merge failed the gates there).
    # The synced .git no longer tracks it, so it shows up remotely as untracked; remove every such file
    # that is not one of this machine's own untracked files (those were just sent on purpose).
    local keep; keep=$(git ls-files -o --exclude-standard -- backend frontend packages mobile mobile-officer scripts)
    ssh "$GATES_REMOTE" "cd '$RWORK' && git ls-files -o --exclude-standard -- backend frontend packages mobile mobile-officer scripts" \
        | grep -vxF -f <(printf '%s\n' "$keep") \
        | ssh "$GATES_REMOTE" "cd '$RWORK' && xargs -r -d '\n' rm -f --"
}
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
          if [ "$(cat .sl-deps-js 2>/dev/null)" != "$SL_DEPS_JS" ]; then
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

# ── --e2e: PLAYWRIGHT ON THE REMOTE MACHINE (2026-10-28, user decision) ─────────────────────────
#
# `--e2e` runs chromium, `--e2e=all` the three projects, `--e2e=chromium,mobile-chrome` a list — the
# project rule in CLAUDE.md (everyday chromium; layout adds mobile-chrome; all three before main).
# It builds (`next build`) and runs `playwright test` in the image GATES_REMOTE_E2E_IMAGE (the gate
# image plus Playwright 1.63's chromium and firefox), 4 workers, one retry: a test green on the retry
# is reported as flaky, by name, not hidden. Measured 2026-10-28 on the unRAID box: build 31 s,
# chromium 236 passed in 70 s, firefox 236 in 88 s, mobile-chrome 228 + 1 flaky in 115 s — against
# 3.6 / 7.9 / 4.5 minutes here on 10-27. Never on this machine: no GATES_REMOTE, no E2E.
# One `playwright test` for all the projects (2026-10-30): one `next start`, and the workers move on to
# the next project's tests instead of idling at each project's tail. Per-project passed / failed / flaky,
# and the failed and flaky tests by name, come from the json reporter (scripts/e2e-report.py).
if [ -n "$E2E" ]; then
    [ -n "${GATES_REMOTE:-}" ] || { echo "$P: --e2e runs on the machine GATES_REMOTE names (.prepush.env), never on this one"; exit 2; }
    EIMG="${GATES_REMOTE_E2E_IMAGE:-sl-gates-e2e:1}"
    ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE" "docker image inspect $EIMG >/dev/null 2>&1" 2>/dev/null \
        || { echo "$P: $GATES_REMOTE is unreachable, or has no $EIMG image — E2E does not run on this machine"; exit 1; }
    # Its own synced tree and its own lock (2026-10-29): E2E builds .next and runs browsers in a tree of its
    # own, so it no longer waits for — or rsyncs under — a gate run on the same box. 8 CPUs here + 12 for a
    # gate run = the box's 20; the two used to queue on run.lock one after the other.
    RWORK="$RDIR/work/$RID-e2e"
    echo "$P: E2E on $GATES_REMOTE ($RWORK): ${E2E//,/ }"
    remote_sync || { echo "$P: could not rsync this tree to $GATES_REMOTE:$RWORK"; exit 1; }
    ssh -o BatchMode=yes "$GATES_REMOTE" "mkdir -p $RDIR/tmp/$RID" || exit 1
    ENAME="sl-e2e-$RID-$$"
    trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $ENAME" >/dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM
    ssh -o BatchMode=yes "$GATES_REMOTE" "flock $RDIR/e2e.lock docker run --rm --init --name $ENAME \
        --cpus ${GATES_REMOTE_E2E_CPUS:-8} --memory ${GATES_REMOTE_E2E_MEMORY:-16g} --shm-size 2g \
        -v $RWORK:/app -v $RDIR/tmp/$RID:/sl-tmp -w /app -e SL_DEPS_JS=$DEPS_JS -e SL_DEPS_PY=$DEPS_PY -e PW_WORKERS=${GATES_REMOTE_PW_WORKERS:-4} \
        -e PROJECTS='$E2E' $EIMG bash -c '$REMOTE_DEPS
          cd frontend && npm run build > /sl-tmp/e2e-build.log 2>&1 || { tail -30 /sl-tmp/e2e-build.log; echo \"e2e: next build failed\"; exit 1; }
          PF=\"\"; for p in \$(echo \$PROJECTS | tr , \" \"); do PF=\"\$PF --project=\$p\"; done
          T=\$(date +%s); rm -f /sl-tmp/e2e.json
          PLAYWRIGHT_JSON_OUTPUT_NAME=/sl-tmp/e2e.json npx playwright test \$PF --reporter=line,json --retries=1 > /sl-tmp/e2e.log 2>&1
          rc=\$?
          echo \"  → \$PROJECTS in one run (\$(( \$(date +%s) - T ))s)\"
          python3 /app/scripts/e2e-report.py /sl-tmp/e2e.json \$(echo \$PROJECTS | tr , \" \") \
            || { tail -30 /sl-tmp/e2e.log; [ \$rc -eq 0 ] && rc=1; }
          exit \$rc'"
    ERC=$?
    trap - EXIT
    [ "$ERC" -eq 0 ] && { echo "$P: E2E ok on $GATES_REMOTE"; exit 0; }
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
# ENCRYPTION_KEY: the death-registration retry tests need one, and so far it came from the main
# checkout's backend/.env — a worktree, a container or CI has none, and four tests went red there
# (2026-10-28, first run in a container). A fixed test-only Fernet key, used only when none is set.
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-Y2ktdGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyE=}"
if [ -z "${SECRET_KEY:-}" ] && [ ! -f "$ROOT/backend/.env" ]; then
    echo "$P: no backend/.env here — using CI's SECRET_KEY/DEBUG for the backend gates"
    export SECRET_KEY="$CI_SECRET_KEY"
    export DEBUG="true"
fi

# WHAT CHANGED. The hook passes the pushed range's files in PREPUSH_CHANGED (one
# path per line, `git diff --no-renames`, so a rename shows its old path as
# deleted). PREPUSH_CHANGED is also the test seam, with PREPUSH_CLASSIFY_ONLY=1,
# which prints the decisions and exits before running any gate — both exist for
# `backend/tests/test_prepush_runs_the_gates_a_change_can_break.py`.
if [ -n "${PREPUSH_CHANGED+x}" ]; then
    CHANGED="$PREPUSH_CHANGED"
    RANGE="${PREPUSH_RANGE:-(PREPUSH_CHANGED)}"
else
    if [ -z "$BASE" ]; then
        BASE="$(git merge-base HEAD origin/main 2>/dev/null)" \
            || { echo "$P: no merge-base with origin/main; pass --base <ref>"; exit 2; }
    fi
    git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "$P: --base $BASE is not a commit"; exit 2; }
    CHANGED="$( { git diff --name-only --no-renames "$BASE"; git ls-files --others --exclude-standard; } | sort -u)"
    RANGE="$(git rev-parse --short "$BASE")..(working tree)"
fi
# A TREE THAT ALREADY PASSED `--full` IS NOT RUN AGAIN (2026-10-19, user decision).
# A push to main runs the full set, which is exactly what `scripts/run-gates.sh --full`
# runs; doing it twice for the same files cost ~22 minutes a push. A full run that
# passes on a clean checkout records HEAD's tree in this file (see record_pass
# at the end); a push whose pushed commit has that very tree is let through. Any
# change at all — one byte in any tracked file — is a different tree and runs as before.
# The real-PostgreSQL run and E2E were never part of this script; they are unaffected.
# GATES_STAMP_FILE is the test seam.
STAMP="${GATES_STAMP_FILE:-$(git rev-parse --path-format=absolute --git-common-dir)/soulledger-gates-passed}"
PUSHED_SHA=""
case "${PREPUSH_RANGE:-}" in *..*) PUSHED_SHA="${PREPUSH_RANGE##*..}" ;; esac
PUSHED_TREE=""
[ -n "$PUSHED_SHA" ] && PUSHED_TREE="$(git rev-parse -q --verify "$PUSHED_SHA^{tree}" 2>/dev/null || true)"
if [ "$PREPUSH" = 1 ] && [ -n "$PUSHED_TREE" ] && [ -f "$STAMP" ]; then
    HIT="$(grep -m1 "^$PUSHED_TREE	" "$STAMP" || true)"
    if [ -n "$HIT" ]; then
        echo "$P: tree ${PUSHED_TREE:0:10} already passed \`scripts/run-gates.sh --full\` (${HIT#*	}) — not running it again"
        exit 0
    fi
fi
# A SELECTIVE PASS COUNTS TOO (2026-10-27, user decision). A session runs `scripts/run-gates.sh`
# and then pushes, and the hook ran the same tests a second time. A selective run that passes on a
# clean checkout records HEAD's tree and the files it treated as changed (SEL_STAMP); a push is let
# through when its commit has that very tree and every file the push changes is among the recorded
# ones. A larger change set never selects less: each rule only adds tests or forces a full run.
# --full / GATES_FULL=1 at push time still run.
SEL_STAMP="$STAMP-selective"
if [ "$PREPUSH" = 1 ] && [ -n "${PUSHED_TREE:-}" ] && [ -f "$SEL_STAMP" ] \
    && [ "$MODE" != full ] && [ "${GATES_FULL:-}" != 1 ] && [ -n "$CHANGED" ]; then
    HIT="$(CHANGED="$CHANGED" awk -F'\t' -v t="$PUSHED_TREE" '
        BEGIN { n = split(ENVIRON["CHANGED"], c, "\n") }
        $1 == t { m = split($3, r, "|"); delete have; for (i = 1; i <= m; i++) have[r[i]] = 1
                  ok = 1; for (i = 1; i <= n; i++) if (c[i] != "" && !(c[i] in have)) { ok = 0; break }
                  if (ok) { print $2; exit } }' "$SEL_STAMP")"
    if [ -n "$HIT" ]; then
        echo "$P: tree ${PUSHED_TREE:0:10} already passed \`scripts/run-gates.sh\` for these changes ($HIT) — not running it again"
        exit 0
    fi
fi

# record_pass: after a green run outside a push, on a clean checkout. --full goes to STAMP (any push
# of the tree passes); a selective run goes to SEL_STAMP with the files it covered.
record_pass() {
    [ "$PREPUSH" = 0 ] && [ "$REAL_PG" = 0 ] || return 0
    cd "$ROOT" || return 0
    if ! git diff --quiet HEAD --; then
        echo "$P: not recording this pass — tracked files differ from HEAD"; return 0
    fi
    local stray
    stray="$(git ls-files --others --exclude-standard -- backend frontend packages mobile mobile-officer scripts | head -3)"
    if [ -n "$stray" ]; then
        echo "$P: not recording this pass — untracked files a gate may have read: $(echo "$stray" | tr '\n' ' ')"; return 0
    fi
    local tree file; tree="$(git rev-parse HEAD^{tree})"
    if [ "$FULL_RUN" = 1 ]; then
        file="$STAMP"
        printf '%s\t%s, %s\n' "$tree" "$(date '+%Y-%m-%d %H:%M')" "$(git rev-parse --short HEAD)" >>"$file"
        echo "$P: recorded a full pass for tree ${tree:0:10} — a push of this exact tree will not re-run the gates"
    else
        file="$SEL_STAMP"
        printf '%s\t%s, %s\t%s\n' "$tree" "$(date '+%Y-%m-%d %H:%M')" "$(git rev-parse --short HEAD)" \
            "$(echo "$CHANGED" | grep -v '^$' | paste -sd'|' -)" >>"$file"
        echo "$P: recorded a selective pass for tree ${tree:0:10} — a push of this tree changing only these files will not re-run the gates"
    fi
    tail -n 50 "$file" >"$file.tmp" && mv "$file.tmp" "$file"
}
# Consumed: nothing below (pytest included) should inherit the hand-off.
unset PREPUSH_CHANGED PREPUSH_RANGE
[ -z "$CHANGED" ] && { echo "$P: no file changes in $RANGE"; exit 0; }

TOUCHES_FRONTEND=$(echo "$CHANGED" | grep -cE '^frontend/' || true)
# The gate machinery counts as backend: its only tests are in the backend suite
# (test_prepush_runs_the_gates_a_change_can_break.py), which reads these files
# rather than importing them. Before 2026-09-30 a push changing only the hook
# generator ran nothing at all.
TOUCHES_BACKEND=$(echo "$CHANGED" | grep -cE '^backend/|^scripts/(run-gates|install-hooks|gate-lock)\.sh$' || true)
# `packages/` had no gate at all, so a commit touching only @soulledger/core ran
# nothing. That is the whole of the package's boundary: `lib: ["ES2020"]` with
# no "dom", the `host-globals.d.ts` allowlist, and the `no-restricted-syntax`
# rule that refuses `process.env`. CI does run them — but only daily, never on
# the push that broke them.
#
# The frontend gate did not cover it either, and this is the part worth writing
# down: `frontend/tsconfig.json` compiles the package's *sources* under
# `lib: ["dom","dom.iterable","esnext"]`, and its `include` is relative to
# `frontend/`, so `host-globals.d.ts` — a global script nobody imports — is not
# in that program at all. Measured: 39 files from packages/core/src reach the
# frontend program, and 0 of them is the allowlist. So the one check that ran
# automatically was compiling the platform-independent package *with the DOM
# available*, which is the opposite of the thing being enforced.
TOUCHES_CORE=$(echo "$CHANGED" | grep -cE '^packages/' || true)
# `mobile/` (the soul app, Expo) was a top-level directory this hook did not
# know, so a push touching only it ran nothing. It consumes packages/core's
# sources the same way the frontend does, and its theme test reads
# frontend/app/globals.css (the ink layer it copies) — so a change to either
# of those can break it without touching mobile/.
TOUCHES_MOBILE=$(echo "$CHANGED" | grep -cE '^(mobile/|frontend/app/globals\.css$)' || true)
# `mobile-officer/` (灵魂簿 · 官员, the officer app, Expo; package @soulledger/officer) is the same
# shape as mobile/ and ALSO imports mobile/src's leaf modules in place
# (mobile-officer/src/shared.ts: ui, theme, fonts, i18n, feedback ...), so a change under mobile/
# can break it without touching mobile-officer/ -- both directories trigger it. (Not `officer/`:
# backend/tests/test_reads_outside_backend_list.py derives list entries from top-level directory
# names quoted in test sources, and "officer" is a word a dozen backend tests already contain.)
TOUCHES_OFFICER=$(echo "$CHANGED" | grep -cE '^(mobile-officer/|mobile/)' || true)

# ── Root-level files ─────────────────────────────────────────────────────────
#
# The three prefixes above match nothing at the repository root, and several
# files there decide what every gate below is testing. On 2026-09-11 two
# consecutive pushes — a regenerated `package-lock.json` (`694aec9`: 182 packages
# moved, one of them `nwsapi`, which turned eight jest tests into timeouts) and
# the `nwsapi` pin in the root `package.json` (`c6368ea`) — went out with this
# hook printing
#
#     frontend:0 backend:0 core:0 changed files
#
# and running nothing. The gates were run by hand both times, which is the only
# reason the slowdown was caught before it landed.
#
# Three kinds, and the third is the point:
#
#   JS tree   package.json, package-lock.json, .nvmrc — the workspace list, the
#             overrides, every resolved version, the node version. Runs core,
#             and core already implies the frontend gate below.
#   backend   pytest.ini, conftest.py — collection rules, the coverage floor,
#             pythonpath, and the session-wide cache override. Dropping `tests.py`
#             from `python_files` stops `apps/*/tests.py` being collected (see
#             the comment in pytest.ini); test_collection_scope.py catches that,
#             but only if something runs the suite — and this hook did not.
#   unknown   any other root-level file NOT on the inert list below. Nobody can
#             know what a file this hook has never seen affects, so every gate
#             runs. Fail closed, as the header says — a root file added later
#             (a tsconfig.base.json, a vitest.workspace.ts) must not inherit the
#             blind spot this block was written to close.
#
# The inert list is documentation and deployment: it changes nothing a local
# gate measures. (`.pre-commit-config.yaml` was on it until the file was deleted
# (IS-23): the `pre-commit` framework was never installed, and the pre-commit
# hook scripts/install-hooks.sh writes is its own ESLint hook, not the framework's.)
#
# Only root-level FILES. Top-level directories other than the three code roots
# (docs/, scripts/ other than the gate machinery above, .github/) are not gated, deliberately —
# failing closed on them would put a full backend run behind every docs edit,
# and a hook that is slow for no reason is a hook people learn to skip.
ROOT_LEVEL=$(echo "$CHANGED" | grep -vE '/' | grep -vE '^$' || true)
JS_ROOT_RE='^(package\.json|package-lock\.json|\.nvmrc)$'
BACKEND_ROOT_RE='^(pytest\.ini|conftest\.py)$'
INERT_ROOT_RE='(\.md$|^(docker-compose[A-Za-z0-9._-]*\.ya?ml|\.dockerignore|\.gitignore|\.claudeignore|\.env\.example)$)'
JS_ROOT=$(echo "$ROOT_LEVEL" | grep -cE "$JS_ROOT_RE" || true)
BACKEND_ROOT=$(echo "$ROOT_LEVEL" | grep -cE "$BACKEND_ROOT_RE" || true)
UNKNOWN_ROOT=$(echo "$ROOT_LEVEL" | grep -vE "$JS_ROOT_RE" | grep -vE "$BACKEND_ROOT_RE" | grep -vE "$INERT_ROOT_RE" | grep -vE '^$' || true)

TOUCHES_CORE=$((TOUCHES_CORE + JS_ROOT))
TOUCHES_BACKEND=$((TOUCHES_BACKEND + BACKEND_ROOT))
if [ -n "$UNKNOWN_ROOT" ]; then
    echo "$P: root-level file(s) this hook does not recognise — running every gate:"
    echo "$UNKNOWN_ROOT" | sed 's/^/    /'
    echo "$P: if one of these cannot affect a gate, add it to INERT_ROOT_RE in scripts/run-gates.sh."
    TOUCHES_CORE=$((TOUCHES_CORE + 1))
    TOUCHES_BACKEND=$((TOUCHES_BACKEND + 1))
fi

# The gate decisions, computed ONCE. Every `if` below reads these rather than
# re-deriving them, and so does the classify-only output — so the test asserts
# the exact values that decide what runs, not a second copy of the rule.
RUN_CORE=0; RUN_FRONTEND=0; RUN_BACKEND=0; RUN_MOBILE=0; RUN_OFFICER=0
[ "$TOUCHES_CORE" -gt 0 ] && RUN_CORE=1
# `|| TOUCHES_CORE` on purpose: the frontend compiles the package's sources
# directly rather than a built artefact, so a change under packages/ can break
# `frontend/` type-checking while touching no file under `frontend/`.
if [ "$TOUCHES_FRONTEND" -gt 0 ] || [ "$TOUCHES_CORE" -gt 0 ]; then RUN_FRONTEND=1; fi
[ "$TOUCHES_BACKEND" -gt 0 ] && RUN_BACKEND=1
# TOUCHES_CORE already folds in the JS root files and unknown root files.
if [ "$TOUCHES_MOBILE" -gt 0 ] || [ "$TOUCHES_CORE" -gt 0 ]; then RUN_MOBILE=1; fi
if [ "$TOUCHES_OFFICER" -gt 0 ] || [ "$TOUCHES_CORE" -gt 0 ]; then RUN_OFFICER=1; fi

# ── TESTS THAT READ ANOTHER AREA'S FILES ─────────────────────────────────────
#
# The rules above follow where a changed file lives. Some tests read another
# area's files as text, and those ran only when their OWN area changed: the A1
# workflow redesign changed only frontend/ and broke
# backend/tests/test_workflow_preset_case_types.py (it parses WorkflowEditor.tsx);
# every frontend-only push passed until a later branch touched backend/
# (2026-10-02). The mirror holes: frontend tests that read backend/*.py
# (roleForbiddenCodenamesMatchBackend, officerAssist, ...) and
# mobile/src/__tests__/assist.test.tsx (backend/apps/soul_assist) did not run
# on a backend-only push. So when an area is not running in full, its readers
# run for any change outside it:
#
#   backend   the lines of backend/tests/reads-outside-backend.txt whose entries
#             include the first path component of a changed file, plus the `*`
#             lines. Derived, and kept exact by
#             backend/tests/test_reads_outside_backend_list.py.
#   frontend  jest on frontend/jest.always-run.txt (every test that reads files;
#             kept exact by jestAlwaysRunList.test.ts). No tsc / eslint.
#   mobile    jest on the mobile tests that read files, found by grep right here
#             (6 on 2026-10-02) — derived on every run, so nothing to drift.
TOPS=$(echo "$CHANGED" | grep -v '^$' | sed 's|/.*||' | sort -u)
READERS_LIST="$ROOT/backend/tests/reads-outside-backend.txt"
BACKEND_READERS=""
if [ "$RUN_BACKEND" = 0 ]; then
    if [ -f "$READERS_LIST" ]; then
        # awk, not a shell loop: a `*` entry must not glob.
        BACKEND_READERS=$(TOPS="$TOPS" awk '
            BEGIN { n = split(ENVIRON["TOPS"], a, "\n"); for (i = 1; i <= n; i++) top[a[i]] = 1 }
            /^[[:space:]]*(#|$)/ { next }
            { for (i = 2; i <= NF; i++) if ($i == "*" || ($i in top)) { print $1; next } }
        ' "$READERS_LIST")
    else
        echo "$P: no backend/tests/reads-outside-backend.txt in this checkout — cannot tell which backend tests read other areas, so the backend suite runs"
        RUN_BACKEND=1
    fi
fi
# No list means no frontend tests here (a throwaway test repository): there is
# nothing to run. Deleting the list is itself a frontend change, which runs jest
# in full — and jestAlwaysRunList.test.ts fails on it.
RUN_JEST_READERS=0
[ "$RUN_FRONTEND" = 0 ] && [ -f "$ROOT/frontend/jest.always-run.txt" ] && RUN_JEST_READERS=1
# Of those, only the lines naming a top-level entry this push changed, and the `*` ones (2026-10-27).
# The labels are derived and checked by frontend/src/__tests__/jestAlwaysRunList.test.ts.
JEST_READERS=""
if [ "$RUN_JEST_READERS" = 1 ]; then
    JEST_READERS=$(TOPS="$TOPS" awk '
        BEGIN { n = split(ENVIRON["TOPS"], a, "\n"); for (i = 1; i <= n; i++) top[a[i]] = 1 }
        /^[[:space:]]*(#|$)/ { next }
        { for (i = 2; i <= NF; i++) if ($i == "*" || ($i in top)) { print $1; next } }
    ' "$ROOT/frontend/jest.always-run.txt")
    # Empty means "nothing reads what changed", and must never reach jest as an empty path list.
    [ -z "$JEST_READERS" ] && RUN_JEST_READERS=0
fi
MOBILE_READERS=""
if [ "$RUN_MOBILE" = 0 ]; then
    MOBILE_READERS=$(git ls-files 'mobile/*.test.ts' 'mobile/*.test.tsx' \
        | while IFS= read -r f; do
            grep -lE "readFileSync|readdirSync|existsSync|statSync|execSync|execFileSync|spawnSync|['\"](node:)?(fs|fs/promises|child_process)['\"]" "$f" 2>/dev/null
        done)
fi

# THE MIGRATION ROUND TRIPS RUN ONLY WHEN SOMETHING THEY TEST CHANGED.
#
# 26 tests (the `migration` marker — see pytest.ini and backend/tests/conftest.py)
# unapply and reapply slices of the migration graph: 2-67 s each, 813 s together,
# about 13.5 of the backend suite's 23 minutes (measured 2026-09-29). What they
# test is the migrations, so a push that changes none of the following cannot
# change their result:
#   - a migration (backend/apps/*/migrations/),
#   - the harness (backend/tests/migration_roundtrip.py) or a conftest,
#   - a file holding one of those tests (found by content, not by a list, so a
#     new round-trip test is covered the day it lands),
#   - requirements.lock (a new Django changes how migrations run),
#   - pytest.ini, or an unrecognised root file (fail closed, as above).
# CI and the real-PostgreSQL command in CLAUDE.md still run all of them.
MIGRATION_PATH_RE='^(backend/apps/[^/]+/migrations/|backend/tests/migration_roundtrip\.py$|backend/tests/conftest\.py$|backend/requirements\.lock$|conftest\.py$|pytest\.ini$)'
TOUCHES_MIGRATION=$(echo "$CHANGED" | grep -cE "$MIGRATION_PATH_RE" || true)
while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$ROOT/$f" ] \
        && grep -qE 'migration_round_trip|mark\.migration' "$ROOT/$f" \
        && TOUCHES_MIGRATION=$((TOUCHES_MIGRATION + 1))
done <<MIGRATION_FILES
$(echo "$CHANGED" | grep -E '^backend/.*\.py$' || true)
MIGRATION_FILES
[ -n "$UNKNOWN_ROOT" ] && TOUCHES_MIGRATION=$((TOUCHES_MIGRATION + 1))
RUN_MIGRATION=0
[ "$RUN_BACKEND" = 1 ] && [ "$TOUCHES_MIGRATION" -gt 0 ] && RUN_MIGRATION=1

# THE TWO SUITE-ABOUT-THE-SUITE TESTS RUN ONLY WHEN WHAT THEY GUARD CHANGED.
#
# Each starts a second pytest: test_collection_scope.py collects the whole suite
# again in a subprocess (it is a `*` line in reads-outside-backend.txt, so it ran
# on every push of any kind), and test_audit_assertions_are_not_vacuous.py runs
# a nested pytest on a freshly migrated database. What they guard is the
# collection and plugin setup — pytest.ini, the conftests, the two plugins it
# loads, apps/*/tests.py existing at all — plus what the nested probe imports
# (apps/audit, apps/tenants), the settings, and the pytest version. Same
# fail-closed extras as the round trips: the files themselves, an unknown root
# file, and an explicit full run (--full, GATES_FULL=1, a push to main).
META_TESTS='backend/tests/test_collection_scope.py
backend/tests/test_audit_assertions_are_not_vacuous.py'
META_PATH_RE='^(pytest\.ini$|conftest\.py$|backend/.*conftest\.py$|backend/requirements\.lock$|backend/config/|backend/apps/(audit|tenants)/|backend/apps/core/lock_join_guard\.py$|backend/apps/[^/]+/tests\.py$|backend/tests/test_collection_scope\.py$|backend/tests/test_audit_assertions_are_not_vacuous\.py$)'
TOUCHES_META=$(echo "$CHANGED" | grep -cE "$META_PATH_RE" || true)
[ -n "$UNKNOWN_ROOT" ] && TOUCHES_META=$((TOUCHES_META + 1))
# An explicit full run, read here because PREPUSH_TO_MAIN is unset further down;
# the SQLite template switch before pytest uses the same flag.
FULL_RUN=0
# A push to main is NOT a full run any more (2026-10-24, user decision): it ran the whole suite on every push,
# ~15–20 minutes at load ~19 on this Mac, and the pushes here all go to main. Main gets the same selective
# run as any branch; `--full` / GATES_FULL=1 are the way to ask for everything.
{ [ "$MODE" = full ] || [ "${GATES_FULL:-}" = 1 ]; } && FULL_RUN=1
TOUCHES_META=$((TOUCHES_META + FULL_RUN))
RUN_META=0
[ "$TOUCHES_META" -gt 0 ] && RUN_META=1

# ── --real-pg: THE BACKEND SUITE ON REAL POSTGRESQL (2026-10-28, user decision) ─
#
# What SQLite cannot test — row locks, varchar(n), aborted transactions, pg_trgm,
# pgvector — runs on the shared box (backend/.env's DATABASE_URL), with a throwaway
# Redis as always. Day to day it runs the same by-app selection as the push, plus
# every PostgreSQL-only test (the set test_concurrency.py pins); the 26 migration
# round trips only when a migration changed. `--real-pg --full` runs everything,
# round trips included — before merging into main. The full run took ~45 minutes
# at -n 2 with the round trips (2026-10-28); 950 s at -n 4 without (2026-10-19).
# No jest, no tsc/eslint, no ruff/makemigrations: the ordinary run covers those.
if [ "$REAL_PG" = 1 ]; then
    P="real-pg"
    RUN_CORE=0; RUN_FRONTEND=0; RUN_MOBILE=0; RUN_OFFICER=0; RUN_JEST_READERS=0; MOBILE_READERS=""
    RUN_BACKEND=1; BACKEND_READERS=""
    [ "$FULL_RUN" = 1 ] && RUN_MIGRATION=1
fi

# ── JEST: FULL OR SELECTIVE ──────────────────────────────────────────────────
#
# --findRelatedTests follows imports. Each rule below names a change it cannot
# trace, and sends jest to a full run. Tests that READ files (contract tests,
# the egy lexicon, i18n parity, design guards) need no rule: they are in
# frontend/jest.always-run.txt and run on every selective run. The rules cover
# what that list cannot: configuration that changes how every test runs, data
# that tests import (a JSON import is an edge jest may or may not resolve;
# not worth betting a language pack on), and the selection machinery itself.
# A LANGUAGE PACK IS SELECTIVE (2026-10-27, user decision). It forced a full run
# until then, and 204 of the 497 commits from 10-13 to 10-27 touched one. Every
# runtime use is a static `import … from "@soulledger/core/messages/<lang>.json"`
# (I18nContext, slipTexts, mobile/src/i18n.tsx), which --findRelatedTests
# follows: measured that day, en.json selects 204 of 312 test files, egy.json
# 205, zh-Hans.json 209. Parity and lexicon tests read the packs and are
# always-run. A pack loaded by a computed path would not be traced — keep them
# static imports. The data-file rule below therefore skips messages/.
FULL_RULES='^scripts/(run-gates\.sh|install-hooks\.sh)$	the gate machinery itself changed
^(package\.json|package-lock\.json|\.nvmrc)$	the JS dependency tree changed
^(frontend|packages/core)/[^/]+$	top-level config of frontend/ or packages/core/ changed (jest, ts, next, eslint, package.json)
^(frontend|packages/core)/.*\.(json|md|ya?ml)$	a data file under frontend/ or packages/core/ changed'
FULL_F=""
full() { FULL_F="$FULL_F$1"$'\n'; }
[ "$MODE" = full ] && full "--full"
[ "${GATES_FULL:-}" = 1 ] && full "GATES_FULL=1"
unset PREPUSH_TO_MAIN
[ -n "$UNKNOWN_ROOT" ] && full "a root-level file this script does not recognise"
while IFS=$'\t' read -r re name; do
    hit=$(echo "$CHANGED" | grep -v '^packages/core/messages/' | grep -E "$re" | head -1)
    [ -n "$hit" ] && full "$name: $hit"
done <<<"$FULL_RULES"
# A deleted or renamed file cannot be traced: the import edge to it is gone
# from the tree the graph is built from.
while IFS= read -r f; do
    if [ -n "$f" ] && [ ! -e "$ROOT/$f" ]; then
        case "$f" in frontend/*|packages/core/*) full "a file was deleted or renamed: $f"; break ;; esac
    fi
done <<<"$CHANGED"

# ── MOBILE / OFFICER JEST: FULL OR SELECTIVE (2026-10-27, user decision) ─────
#
# Same scheme as the web jest above: --findRelatedTests from the changed files,
# plus the app's tests that read files (grep, below). Both app configs root jest
# at <app>/src, so only a code file under <app>/src or packages/core (added with
# --roots) is in the graph; anything else an app changed cannot be traced and
# runs that app's suite. Measured 2026-10-27: mobile navigation.tsx selects 20 of
# 58 test files, screens/letters.tsx 25; officer judgmentActions.tsx 16 of 39.
APP_FULL_F="$FULL_F"
hit=$(echo "$CHANGED" | grep -E '^(mobile|mobile-officer)/' | grep -vE '^(mobile|mobile-officer)/src/.*\.(ts|tsx|js|jsx)$' | head -1)
[ -n "$hit" ] && APP_FULL_F="${APP_FULL_F}an app file outside src/, or not code: $hit"$'\n'
while IFS= read -r f; do
    case "$f" in mobile/*|mobile-officer/*) [ ! -e "$ROOT/$f" ] && { APP_FULL_F="${APP_FULL_F}an app file was deleted or renamed: $f"$'\n'; break; } ;; esac
done <<<"$CHANGED"

echo "$P: $RANGE — frontend:$TOUCHES_FRONTEND backend:$TOUCHES_BACKEND core:$TOUCHES_CORE changed files (root: js $JS_ROOT, backend $BACKEND_ROOT)"

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
    if [ "$RUN_BACKEND" = 1 ] && [ "$FULL_RUN" = 0 ] && [ -f "$HERE/select-backend-tests.py" ]; then
        SEL=$(echo "$CHANGED" | python3 -I "$HERE/select-backend-tests.py")
        case "$SEL" in FULL*) echo "classify-backend-select: whole suite (${SEL#FULL	})" ;;
                       *) echo "classify-backend-select: $(echo "$SEL" | grep -c . || true) test files" ;; esac
    fi
    echo "classify-jest: full=$([ -n "$FULL_F" ] && echo 1 || echo 0)"
    printf '%s' "$FULL_F" | sed 's/^/  full because: /'
    echo "classify-jest-readers: $(echo "$JEST_READERS" | grep -c . || true)"
    printf '%s\n' "$JEST_READERS" | grep . | sed 's/^/  jest reader: /'
    echo "classify-readers: jest=$RUN_JEST_READERS mobile=$([ -n "$MOBILE_READERS" ] && echo 1 || echo 0) backend=$(echo "$BACKEND_READERS" | grep -c . || true)"
    printf '%s' "$BACKEND_READERS" | sed 's/^/  backend reader: /'; echo
    exit 0
fi

if [ "$PREPUSH" = 1 ]; then
    fail() { echo ""; echo "pre-push: $1"; echo "pre-push: push refused. SKIP_PREPUSH=1 git push  to override deliberately."; exit 1; }
else
    fail() { echo ""; echo "$P: $1"; echo "$P: FAILED"; exit 1; }
fi

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
    ssh -o ConnectTimeout=5 -o BatchMode=yes "$GATES_REMOTE" "docker image inspect $RIMG >/dev/null 2>&1" 2>/dev/null \
        || fail "$GATES_REMOTE is unreachable, or has no $RIMG image. Not running the gates on this machine (GATES_REMOTE is set) — try again when it is up, or SKIP_PREPUSH=1 git push."
    echo "$P: on $GATES_REMOTE ($RWORK) — this machine only syncs and waits"
    T_SYNC=$(date +%s)
    remote_sync || fail "could not rsync this tree to $GATES_REMOTE:$RWORK"
    printf '%s\n' "$CHANGED" | ssh -o BatchMode=yes "$GATES_REMOTE" "cat > $RWORK/.sl-changed" || fail "could not hand the change list to $GATES_REMOTE"
    echo "    (synced in $(( $(date +%s) - T_SYNC ))s)"
    RFLAGS="--prepush"; [ "$MODE" = full ] && RFLAGS="$RFLAGS --full"; [ "$REAL_PG" = 1 ] && RFLAGS="$RFLAGS --real-pg"
    RNAME="sl-gates-$RID-$$"
    trap 'ssh -o BatchMode=yes "$GATES_REMOTE" "docker rm -f $RNAME" >/dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM
    # TMPDIR is OUTSIDE the tree (/sl-tmp): under /app, test_testdb_name's child pytest found the tree's
    # root conftest above its tmp_path and applied it twice (test_soulledger_wired_wired), every delegated run.
    ssh -o BatchMode=yes "$GATES_REMOTE" "mkdir -p $RDIR/tmp/$RID" || fail "could not create $RDIR/tmp/$RID on $GATES_REMOTE"
    # flock: one delegated run at a time on that machine, from any checkout or session. It is the only
    # lock there: GATE_LOCK=0 turns off gate-lock.sh inside the container, whose pid check cannot work
    # across containers — each numbers its processes from 1, so a lock an interrupted run left behind
    # named pid 7, the next container had a live pid 7, and that push waited 30 minutes (2026-10-28).
    # Workers: 6 for pytest + 6 for the JS runners = the container's 12 CPUs, because the two sides now
    # run at once (TWO SIDES AT ONCE, near the end). GATES_REMOTE_PYTEST_WORKERS / _JS_WORKERS override.
    ssh -o BatchMode=yes "$GATES_REMOTE" "flock $RDIR/run.lock docker run --rm --init --name $RNAME \
        --network ${GATES_REMOTE_NET:-sl-gates} --cpus ${GATES_REMOTE_CPUS:-12} --memory ${GATES_REMOTE_MEMORY:-24g} \
        -v $RWORK:/app -w /app -e GATES_IN_REMOTE=1 -e GATES_QOS=none -e GATE_LOCK=0 -e GATES_FULL=${GATES_FULL:-} \
        -e JEST_WORKERS=${GATES_REMOTE_JS_WORKERS:-6} -e VITEST_WORKERS=${GATES_REMOTE_JS_WORKERS:-6} -e PYTEST_WORKERS=${GATES_REMOTE_PYTEST_WORKERS:-6} \
        -e DATABASE_URL='$GATES_REMOTE_DB_URL' -e GATES_PG_URL='$GATES_REMOTE_DB_URL' -e SL_DEPS_JS=$DEPS_JS -e SL_DEPS_PY=$DEPS_PY \
        -v $RDIR/tmp/$RID:/sl-tmp -e TMPDIR=/sl-tmp $RIMG bash -c '
          find /sl-tmp -mindepth 1 -mmin +1440 -delete 2>/dev/null
          $REMOTE_DEPS
          export PREPUSH_CHANGED=\"\$(cat .sl-changed)\"
          exec bash scripts/run-gates.sh $RFLAGS'"
    RSTATUS=$?
    trap - EXIT
    # Logs it names as /sl-tmp/… are kept there: $RDIR/tmp/$RID/ on $GATES_REMOTE (a day).
    [ "$RSTATUS" -eq 0 ] || fail "the gates failed on $GATES_REMOTE (exit $RSTATUS) — see above; a log named /sl-tmp/… is $GATES_REMOTE:$RDIR/tmp/$RID/…"
    record_pass
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
if [ "$RUN_CORE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    # This tsconfig is the boundary. Running it here is the only automatic
    # execution it gets.
    echo "  → core tsc"
    npm run --workspace packages/core typecheck --silent \
        || fail "@soulledger/core typecheck failed. This compiles under lib:[\"ES2020\"] with no DOM — a \`document\`/\`window\`/\`localStorage\` reference here is a host capability that belongs behind a PlatformAdapter port, not a type error to widen the lib for."
    echo "  → core eslint"
    npm run --workspace packages/core lint --silent \
        || fail "@soulledger/core lint failed. Note this config refuses \`process.env\` and \`import.meta.env\`: Expo and Tauri define neither of the ones Next does, and the fallback fails silently."
fi
if [ "$RUN_FRONTEND" = 1 ]; then
    need npx
    cd "$ROOT/frontend" || fail "frontend/ missing"
    echo "  → tsc";   npx tsc --noEmit          || fail "tsc failed"
    echo "  → eslint"; npm run lint --silent    || fail "eslint failed"
    cd "$ROOT" || exit 1
fi
if [ "$RUN_MOBILE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → mobile tsc"
    npm run --workspace mobile typecheck --silent || fail "mobile typecheck failed"
    echo "  → mobile eslint"
    npm run --workspace mobile lint --silent || fail "mobile lint failed"
fi
if [ "$RUN_OFFICER" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → officer tsc"
    npm run --workspace mobile-officer typecheck --silent || fail "officer typecheck failed"
    echo "  → officer eslint"
    npm run --workspace mobile-officer lint --silent || fail "officer lint failed"
fi
if [ "$RUN_BACKEND" = 1 ] || [ -n "$BACKEND_READERS" ]; then
    cd "$ROOT/backend" || fail "backend/ missing"
    # THE INTERPRETER IS THE PROJECT VENV, `backend/.venv` — Python 3.11 with
    # exactly `requirements.lock`, the set the image and CI install.
    #
    # It used to be PYTHON_BIN from .prepush.env, else a bare `python` on PATH.
    # On the machine this hook was written for, PYTHON_BIN named the shared
    # conda `vision` environment: Python 3.12 and the dependency versions from
    # before `d561340` upgraded the lock, so a green push measured a different
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
    if [ "$RUN_BACKEND" = 1 ] && [ "$REAL_PG" = 0 ]; then
        echo "  → ruff";  "$RUFF" check .          || fail "ruff failed"
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
                fail "makemigrations --check: a model changed without a migration. Run \`manage.py makemigrations\` and read what it generated before committing it."
            fi
            fail "makemigrations --check could not run (exit $MM_STATUS) — see the output above. This is not a missing migration. Interpreter: $PY"
        fi
    elif [ "$REAL_PG" = 1 ]; then
        echo "  → ruff, makemigrations: skipped — --real-pg runs pytest only"
    else
        echo "  → ruff, makemigrations: skipped — nothing under backend/ changed"
    fi
    cd "$ROOT" || exit 1
fi

# pytest_finish — progress every 30 s until pytest (here, or over ssh) exits, then its verdict.
pytest_finish() {
    T0=$(date +%s); NEXT=30
    while kill -0 "$PYTEST_PID" 2>/dev/null; do
        sleep 2
        EL=$(( $(date +%s) - T0 ))
        if [ "$EL" -ge "$NEXT" ] && kill -0 "$PYTEST_PID" 2>/dev/null; then
            NEXT=$(( NEXT + 30 ))
            PCT=$(grep -oE '\[ *[0-9]+%\]' "$PYTEST_LOG" | tail -1 | tr -d '[] ')
            # Progress lines are `path.py ..F. [ 12%]` serially and bare
            # `..F. [ 12%]` under xdist: count F/E in the marks, never in a path.
            NBAD=$(grep -E '\[ *[0-9]+%\]$' "$PYTEST_LOG" | sed -E 's/^[^ ]+\.py //; s/\[.*//' | tr -cd 'FE' | wc -c | tr -d ' ')
            echo "    … pytest ${PCT:-0%} · $((EL / 60))m$((EL % 60))s · failed so far: $NBAD"
        fi
    done
    wait "$PYTEST_PID"; PYTEST_STATUS=$?
    # The thirty slowest over 5 s, so a run that stalls says where (--durations=30 --durations-min=5 below).
    sed -n '/slowest [0-9]* *durations/,/^$/p' "$PYTEST_LOG" | sed 's/^/    /'
    tail -4 "$PYTEST_LOG"
    if [ "$PYTEST_STATUS" -eq 0 ]; then rm -f "$PYTEST_LOG"; else echo "    full log: $PYTEST_LOG"; fi
    # Stop the throwaway before deciding, so a failure does not leak a daemon.
    [ -n "$RPORT" ] && redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1
    [ "$PYTEST_STATUS" -eq 0 ] || fail "pytest failed"
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
    m = re.search(r"@?([\w.-]+):(\d+)", url)
    if not m:
        print(f"{name} unknown {url or '(unset)'}"); return
    host, port = m.group(1), int(m.group(2))
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
        trap 'redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1; type gate_unlock >/dev/null 2>&1 && gate_unlock' EXIT
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
        # it after every test (6d2c21dd), and two worksteal full runs then passed 8076/8076.
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
    PYTEST_PATHS=""
    META_IGNORE=""
    if [ "$RUN_META" = 0 ]; then
        META_IGNORE=$(echo "$META_TESTS" | sed 's|^backend/|--ignore=|' | tr '\n' ' ')
        echo "    (without the 2 suite-about-the-suite tests: nothing they guard changed)"
    fi
    if [ "$RUN_BACKEND" = 0 ]; then
        # Readers are listed relative to backend/; drop the meta tests here too, and
        # if nothing is left run nothing — an empty path list would mean "the whole suite".
        PYTEST_PATHS="$BACKEND_READERS"
        [ "$RUN_META" = 0 ] && PYTEST_PATHS=$(echo "$PYTEST_PATHS" | grep -vxF "$(echo "$META_TESTS" | sed 's|^backend/||')" || true)
        echo "    (only the $(echo "$PYTEST_PATHS" | grep -c . || true) test files that read what changed — backend/tests/reads-outside-backend.txt)"
    fi
    # BY APP, NOT THE WHOLE SUITE (2026-10-27, user decision): a backend change runs the test files
    # that belong to, name, or call the URLs of the apps it touched — scripts/select-backend-tests.py,
    # which also says when a change cannot be traced (settings, a conftest, dependencies) and the
    # whole suite runs. --full / GATES_FULL=1 always run everything. The files that read other areas
    # (reads-outside-backend.txt) are added as on a backend-less push.
    if [ "$RUN_BACKEND" = 1 ] && [ "$FULL_RUN" = 0 ] && [ ! -f "$HERE/select-backend-tests.py" ]; then
        echo "    (whole suite: no select-backend-tests.py next to this script)"
    elif [ "$RUN_BACKEND" = 1 ] && [ "$FULL_RUN" = 0 ]; then
        SELECTED=$(echo "$CHANGED" | "$PY" -I "$HERE/select-backend-tests.py") || fail "select-backend-tests.py failed"
        case "$SELECTED" in
            FULL*) echo "    (whole suite: ${SELECTED#FULL	})" ;;
            *)
                READERS=$(TOPS="$TOPS" awk '
                    BEGIN { n = split(ENVIRON["TOPS"], a, "\n"); for (i = 1; i <= n; i++) top[a[i]] = 1 }
                    /^[[:space:]]*(#|$)/ { next }
                    { for (i = 2; i <= NF; i++) if ($i == "*" || ($i in top)) { print $1; next } }
                ' "$READERS_LIST" 2>/dev/null)
                PYTEST_PATHS=$(printf '%s\n%s\n' "$SELECTED" "$READERS" | grep -v '^$' | sort -u)
                [ "$RUN_META" = 0 ] && PYTEST_PATHS=$(echo "$PYTEST_PATHS" | grep -vxF "$(echo "$META_TESTS" | sed 's|^backend/||')" || true)
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
    PYARGS=(-q --no-header --no-cov --durations=30 --durations-min=5 $XDIST
        -o faulthandler_timeout="$TEST_TIMEOUT" -o faulthandler_exit_on_timeout=true $REAL_PG_ARGS
        ${SKIP_MIGRATION:+-m "not migration"} $META_IGNORE ${PYTEST_PREPUSH_ARGS:-} $PYTEST_PATHS)
    # The multi-database guard (tests/test_multidb_shadow.py) exists only under its own settings, so the
    # suite below skips it. `--real-pg --full` runs it first, on the same PostgreSQL and Redis (C21, 2026-10-31).
    if [ "$REAL_PG" = 1 ] && [ "$FULL_RUN" = 1 ]; then
        echo "  → pytest: multi-database guard (--ds=config.settings_multidb -m multidb)"
        SECRET_KEY="$CI_SECRET_KEY" "$PY" -m pytest -q --no-header --no-cov $REAL_PG_ARGS --ds=config.settings_multidb \
            -m multidb tests/test_multidb_shadow.py 2>&1 | tail -4
        [ "${PIPESTATUS[0]}" -eq 0 ] || fail "pytest (multi-database guard, tests/test_multidb_shadow.py) failed"
    fi
    SECRET_KEY="$CI_SECRET_KEY" "$PY" -m pytest "${PYARGS[@]}" >"$PYTEST_LOG" 2>&1 &
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

# RUN_FRONTEND already folds in TOUCHES_CORE — see where it is computed.
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
        SRC=$(echo "$CHANGED" | grep -E '^(frontend|packages/core)/' | while IFS= read -r f; do [ -f "$ROOT/$f" ] && echo "$ROOT/$f"; done)
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

# app_jest <dir> <changed-path regex> <extra --roots> <failure message> — see MOBILE / OFFICER JEST above.
app_jest() {
    local dir="$1" re="$2" roots="$3" msg="$4" paths="" related="" readers src log status
    echo "  → $dir jest"
    if [ -z "$APP_FULL_F" ]; then
        src=$(echo "$CHANGED" | grep -E "$re" | while IFS= read -r f; do [ -f "$ROOT/$f" ] && echo "$ROOT/$f"; done)
        if [ -n "$src" ]; then
            # shellcheck disable=SC2086
            related=$(cd "$ROOT/$dir" && npx jest --roots '<rootDir>/src' $roots --listTests --findRelatedTests $src 2>/dev/null) \
                || APP_FULL_F="jest --findRelatedTests failed, so the selection is unknown"$'\n'
            related=$(echo "$related" | grep "^$ROOT/$dir/src/" || true)
        fi
    fi
    if [ -z "$APP_FULL_F" ]; then
        readers=$(git ls-files "$dir/src/*.test.ts" "$dir/src/*.test.tsx" | while IFS= read -r f; do
            grep -lE "readFileSync|readdirSync|existsSync|statSync|execSync|execFileSync|spawnSync|['\"](node:)?(fs|fs/promises|child_process)['\"]" "$ROOT/$f" 2>/dev/null
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
    app_jest mobile "^(mobile|packages/core)/" "--roots <rootDir>/../packages/core" \
        "mobile jest failed. If it is theme.test.ts: frontend/app/globals.css changed an ink-layer token that mobile/src/theme.ts copies — copy the new triple, do not delete the check."
fi

if [ "$RUN_OFFICER" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    app_jest mobile-officer "^(mobile-officer|mobile|packages/core)/" "--roots <rootDir>/../packages/core --roots <rootDir>/../mobile/src" \
        "officer jest failed. officer/ imports mobile/src's leaf modules in place (mobile-officer/src/shared.ts): a failure here after a change under mobile/ is that change reaching the officer app."
fi

if [ -n "$MOBILE_READERS" ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → mobile jest: the $(echo "$MOBILE_READERS" | wc -l | tr -d ' ') tests that read files"
    # shellcheck disable=SC2046
    npm run --workspace mobile test --silent -- --silent --runTestsByPath $(echo "$MOBILE_READERS" | sed "s|^|$ROOT/|") 2>&1 | tail -4
    [ "${PIPESTATUS[0]}" -eq 0 ] || fail "mobile jest (file readers) failed"
fi
}  # run_js_tests

# ── TWO SIDES AT ONCE (the remote run only, 2026-10-30, user decision) ──────────────────────────────
#
# On the gate box the backend pytest and the JS runners (core vitest, web jest, the two app jests) ran one
# after the other. There they now run side by side, each into its own log, 6 + 6 workers over the
# container's 12 CPUs (the docker run in DELEGATED RUNS). A side that fails does not stop the other: both
# finish, then both logs are printed and both exit codes decide. On this Mac they stay serial — memory,
# not CPU, is what runs out here (TWO WORKERS near the top).
if [ "${GATES_IN_REMOTE:-0}" = 1 ]; then
    BE_LOG=$(mktemp "${TMPDIR:-/tmp}/gates-backend.XXXXXX"); JS_LOG=$(mktemp "${TMPDIR:-/tmp}/gates-js.XXXXXX")
    echo "  → backend pytest and JS tests side by side"
    ( run_backend_tests ) >"$BE_LOG" 2>&1 &
    BE_PID=$!
    ( run_js_tests ) >"$JS_LOG" 2>&1 &
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
    echo "  ── JS tests (exit $JS_RC) ──"; cat "$JS_LOG"
    if [ "$BE_RC" -ne 0 ] || [ "$JS_RC" -ne 0 ]; then
        echo ""
        [ "$BE_RC" -ne 0 ] && echo "  backend: $(grep -E "^$P: " "$BE_LOG" | grep -vE 'push refused|FAILED$' | tail -1)"
        [ "$JS_RC" -ne 0 ] && echo "  JS:      $(grep -E "^$P: " "$JS_LOG" | grep -vE 'push refused|FAILED$' | tail -1)"
        fail "tests failed (backend exit $BE_RC, JS exit $JS_RC) — both sides ran to the end, logs above"
    fi
    rm -f "$BE_LOG" "$JS_LOG"
else
    run_backend_tests
    run_js_tests
fi


# Record the pass (see "A TREE THAT ALREADY PASSED" near the top). Only a full run
# outside the hook, and only when what was tested IS HEAD's tree: tracked files
# match HEAD, and no untracked file sits where a gate could have read it — an
# untracked test or migration ran here but would not be in the pushed commit.
record_pass
echo "$P: ok ($(( $(date +%s) - T_GATES ))s, not counting any wait for the gate lock)"
