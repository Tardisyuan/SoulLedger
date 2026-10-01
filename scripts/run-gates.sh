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
# WHAT RUNS. Which areas run (core / frontend / mobile / backend) is decided
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
# EVERYTHING ELSE RUNS IN FULL: tsc, eslint, core, mobile, ruff,
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
# WHY THIS EXISTS. Both GitHub Actions workflows are `workflow_dispatch` only,
# so nothing in this repository runs automatically. The contract tests that
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

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREPUSH=0; MODE=auto; BASE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --prepush)  PREPUSH=1 ;;
        --full)     MODE=full ;;
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

# No backend/.env → no SECRET_KEY → config/settings.py refuses to load, and
# every backend gate fails for a reason that has nothing to do with the change.
# That is every worktree (the file is gitignored) and every fresh clone. Use the
# same two values CI does (.github/workflows/ci.yml, which has no .env either),
# and say so. NOT the main checkout's backend/.env: that one points DATABASE_URL
# and REDIS_URL at the shared box.
# ≥32 bytes, or PyJWT's InsecureKeyLengthWarning — an error in pytest.ini.
CI_SECRET_KEY="ci-test-key-not-for-production-32-bytes-min"
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
# rule that refuses `process.env`. CI does run them — and both workflows are
# `workflow_dispatch` only, so in practice nothing did.
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
RUN_CORE=0; RUN_FRONTEND=0; RUN_BACKEND=0; RUN_MOBILE=0
[ "$TOUCHES_CORE" -gt 0 ] && RUN_CORE=1
# `|| TOUCHES_CORE` on purpose: the frontend compiles the package's sources
# directly rather than a built artefact, so a change under packages/ can break
# `frontend/` type-checking while touching no file under `frontend/`.
if [ "$TOUCHES_FRONTEND" -gt 0 ] || [ "$TOUCHES_CORE" -gt 0 ]; then RUN_FRONTEND=1; fi
[ "$TOUCHES_BACKEND" -gt 0 ] && RUN_BACKEND=1
# TOUCHES_CORE already folds in the JS root files and unknown root files.
if [ "$TOUCHES_MOBILE" -gt 0 ] || [ "$TOUCHES_CORE" -gt 0 ]; then RUN_MOBILE=1; fi

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

# ── JEST: FULL OR SELECTIVE ──────────────────────────────────────────────────
#
# --findRelatedTests follows imports. Each rule below names a change it cannot
# trace, and sends jest to a full run. Tests that READ files (contract tests,
# the egy lexicon, i18n parity, design guards) need no rule: they are in
# frontend/jest.always-run.txt and run on every selective run. The rules cover
# what that list cannot: configuration that changes how every test runs, data
# that tests import (a JSON import is an edge jest may or may not resolve;
# not worth betting a language pack on), and the selection machinery itself.
FULL_RULES='^scripts/(run-gates\.sh|install-hooks\.sh)$	the gate machinery itself changed
^packages/core/messages/	a language pack changed
^(package\.json|package-lock\.json|\.nvmrc)$	the JS dependency tree changed
^(frontend|packages/core)/[^/]+$	top-level config of frontend/ or packages/core/ changed (jest, ts, next, eslint, package.json)
^(frontend|packages/core)/.*\.(json|md|ya?ml)$	a data file under frontend/ or packages/core/ changed'
FULL_F=""
full() { FULL_F="$FULL_F$1"$'\n'; }
[ "$MODE" = full ] && full "--full"
[ "${GATES_FULL:-}" = 1 ] && full "GATES_FULL=1"
[ "${PREPUSH_TO_MAIN:-0}" = 1 ] && full "the push updates refs/heads/main"
unset PREPUSH_TO_MAIN
[ -n "$UNKNOWN_ROOT" ] && full "a root-level file this script does not recognise"
while IFS=$'\t' read -r re name; do
    hit=$(echo "$CHANGED" | grep -E "$re" | head -1)
    [ -n "$hit" ] && full "$name: $hit"
done <<<"$FULL_RULES"
# A deleted or renamed file cannot be traced: the import edge to it is gone
# from the tree the graph is built from.
while IFS= read -r f; do
    if [ -n "$f" ] && [ ! -e "$ROOT/$f" ]; then
        case "$f" in frontend/*|packages/core/*) full "a file was deleted or renamed: $f"; break ;; esac
    fi
done <<<"$CHANGED"

echo "$P: $RANGE — frontend:$TOUCHES_FRONTEND backend:$TOUCHES_BACKEND core:$TOUCHES_CORE changed files (root: js $JS_ROOT, backend $BACKEND_ROOT)"

if [ "${PREPUSH_CLASSIFY_ONLY:-0}" = "1" ]; then
    echo "classify: core=$RUN_CORE frontend=$RUN_FRONTEND backend=$RUN_BACKEND"
    # A separate line so the existing `classify:` contract (parsed by
    # backend/tests/test_prepush_runs_the_gates_a_change_can_break.py) is unchanged.
    echo "classify-mobile: mobile=$RUN_MOBILE"
    echo "classify-migration: migration=$RUN_MIGRATION"
    echo "classify-jest: full=$([ -n "$FULL_F" ] && echo 1 || echo 0)"
    printf '%s' "$FULL_F" | sed 's/^/  full because: /'
    exit 0
fi

if [ "$PREPUSH" = 1 ]; then
    fail() { echo ""; echo "pre-push: $1"; echo "pre-push: push refused. SKIP_PREPUSH=1 git push  to override deliberately."; exit 1; }
else
    fail() { echo ""; echo "gates: $1"; echo "gates: FAILED"; exit 1; }
fi

# One heavy gate at a time across every worktree and session (gate-lock.sh,
# next to this script — the hook's installed copy carries its own).
if [ -f "$HERE/gate-lock.sh" ]; then
    . "$HERE/gate-lock.sh"
    gate_lock "$P $(git rev-parse --abbrev-ref HEAD)"
fi
T_GATES=$(date +%s)   # after the lock: the time below is the gates', not the queue's

need() { command -v "$1" >/dev/null 2>&1 || fail "\`$1\` not found, so this check cannot run. Refusing rather than skipping — a check that did not run is not a check that passed."; }

# Core first: it is the frontend's dependency, it is fast, and a boundary
# failure should be the thing you read rather than the tsc error it causes 400
# lines later.
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
    npm run --workspace packages/core test --silent \
        || fail "@soulledger/core tests failed. If it is domBoundary.test.ts: a DOM or Node global reached the platform-independent package. That is a host capability and belongs behind a PlatformAdapter port — do not widen \`lib\` to make it compile."
fi

# RUN_FRONTEND already folds in TOUCHES_CORE — see where it is computed.
if [ "$RUN_FRONTEND" = 1 ]; then
    need npx
    cd "$ROOT/frontend" || fail "frontend/ missing"
    echo "  → tsc";   npx tsc --noEmit          || fail "tsc failed"
    echo "  → eslint"; npm run lint --silent    || fail "eslint failed"
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
        ALWAYS=$(grep -vE '^[[:space:]]*(#|$)' "$ALWAYS_LIST" | sed "s|^|$ROOT/frontend/|")
        JEST_PATHS=$(printf '%s\n%s\n' "$RELATED" "$ALWAYS" | grep -v '^$' | sort -u)
        n() { [ -n "$1" ] && echo "$1" | wc -l | tr -d ' ' || echo 0; }
        echo "    affected: $(n "$JEST_PATHS") of $(npx jest --listTests 2>/dev/null | grep -c '^/') test files ($(n "$RELATED") related to the change, $(n "$ALWAYS") always-run)"
    else
        echo "    FULL, because:"; printf '%s' "$FULL_F" | sed 's/^/      /'
    fi
    JEST_LOG=$(mktemp -t prepush-jest)
    T_JEST=$(date +%s)
    # shellcheck disable=SC2086
    npx jest --coverage=false --silent ${JEST_PATHS:+--runTestsByPath $JEST_PATHS} >"$JEST_LOG" 2>&1
    JEST_STATUS=$?
    tail -4 "$JEST_LOG"
    echo "    jest took $(( $(date +%s) - T_JEST ))s"
    if [ "$JEST_STATUS" -ne 0 ]; then
        grep -E '^(FAIL |  ● )' "$JEST_LOG" | awk '!seen[$0]++' | head -20
        echo "    full jest log: $JEST_LOG"
        fail "jest failed"
    fi
    rm -f "$JEST_LOG"
    cd "$ROOT" || exit 1
fi

if [ "$RUN_MOBILE" = 1 ]; then
    need npm
    cd "$ROOT" || exit 1
    echo "  → mobile tsc"
    npm run --workspace mobile typecheck --silent || fail "mobile typecheck failed"
    echo "  → mobile eslint"
    npm run --workspace mobile lint --silent || fail "mobile lint failed"
    echo "  → mobile jest"
    # Kept to a file and named on failure, as the web jest above: `| tail -4` printed only the
    # totals, so a red run (2026-10-01, load 87, green on retry) left no trace of which test.
    MOBILE_LOG=$(mktemp -t prepush-mobile-jest)
    npm run --workspace mobile test --silent -- --silent >"$MOBILE_LOG" 2>&1
    MOBILE_STATUS=$?
    tail -4 "$MOBILE_LOG"
    if [ "$MOBILE_STATUS" -ne 0 ]; then
        grep -E '^(FAIL |  ● )' "$MOBILE_LOG" | awk '!seen[$0]++' | head -20
        echo "    full mobile jest log: $MOBILE_LOG"
        fail "mobile jest failed. If it is theme.test.ts: frontend/app/globals.css changed an ink-layer token that mobile/src/theme.ts copies — copy the new triple, do not delete the check."
    fi
    rm -f "$MOBILE_LOG"
fi

if [ "$RUN_BACKEND" = 1 ]; then
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
    echo "  → ruff";  "$RUFF" check .          || fail "ruff failed"
    # `makemigrations --check` BEFORE pytest, because it is the cheap one and
    # because it catches a class the suite does not: a model `choices` list
    # losing a member alters a field, and Django notices while every test that
    # only reads today's members stays green. Verified by dropping GREEK from
    # the org category choices — this exits 1 and names the missing migration.
    #
    # It ran only in CI, and both workflows are `workflow_dispatch` now, so
    # nothing ran it at all.
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
        *)  echo "    → database unreachable, using in-memory SQLite"
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
    # -n 4 (pytest-xdist, requirements-dev.txt) when it is installed: measured
    # 2026-09-29 at 4:21 against 5:43 serial for this selection, and -n 6 was no
    # faster (each worker spends ~36 s building its own test database).
    # PYTEST_WORKERS=0 runs serially; CI stays serial either way.
    XDIST=""
    if [ "${PYTEST_WORKERS:-4}" != "0" ] && "$PY" -c "import xdist" 2>/dev/null; then
        XDIST="-n ${PYTEST_WORKERS:-4}"
        echo "    (pytest-xdist: $XDIST)"
    fi
    PYTEST_LOG=$(mktemp -t prepush-pytest)
    SECRET_KEY="$CI_SECRET_KEY" "$PY" -m pytest -q --no-header --no-cov $XDIST \
        ${SKIP_MIGRATION:+-m "not migration"} ${PYTEST_PREPUSH_ARGS:-} >"$PYTEST_LOG" 2>&1 &
    PYTEST_PID=$!
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
    tail -4 "$PYTEST_LOG"
    if [ "$PYTEST_STATUS" -eq 0 ]; then rm -f "$PYTEST_LOG"; else echo "    full log: $PYTEST_LOG"; fi
    # Stop the throwaway before deciding, so a failure does not leak a daemon.
    [ -n "$RPORT" ] && redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1
    [ "$PYTEST_STATUS" -eq 0 ] || fail "pytest failed"
    cd "$ROOT" || exit 1
fi

echo "$P: ok ($(( $(date +%s) - T_GATES ))s, not counting any wait for the gate lock)"
