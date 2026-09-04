#!/bin/bash
# Install Git hooks for SoulLedger
# Run this after cloning the repository

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$ROOT_DIR/.git/hooks"

# Create pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash
# Pre-commit hook: Run ESLint on staged frontend files

# --diff-filter=d drops deleted paths. Without it a commit that removes a
# frontend file hands eslint a path that no longer exists, and eslint exits
# non-zero with "No files matching the pattern" — making deletions impossible
# to commit.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=d | grep -E '\.(ts|tsx|js|jsx)$' | grep -E '^frontend/')

if [ -n "$STAGED_FILES" ]; then
    echo "Running ESLint on staged frontend files..."
    cd frontend
    # Strip frontend/ prefix for paths relative to frontend dir
    RELATIVE_FILES=$(echo "$STAGED_FILES" | sed 's|^frontend/||')
    # --no-warn-ignored: staged files the eslint config ignores (src/__tests__/**)
    # otherwise emit an "ignored file" warning, which --max-warnings 0 turns into
    # a failure — making test files impossible to commit. Real lint warnings are
    # still reported and still fail the commit.
    npx eslint $RELATIVE_FILES --max-warnings 0 --no-warn-ignored 2>&1 || {
        echo "ESLint failed. Fix errors before committing."
        exit 1
    }
    cd ..
fi
EOF

chmod +x "$HOOKS_DIR/pre-commit"

# Create pre-push hook
cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash
# Pre-push hook: run the checks that would otherwise only run when someone
# remembers to.
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
# that runs them would be the joke writing itself.
#
# TO BYPASS: `SKIP_PREPUSH=1 git push`. Named deliberately rather than relying on
# `--no-verify`, because this way the bypass is greppable in a shell history and
# does not also disable pre-commit.

set -u

if [ "${SKIP_PREPUSH:-0}" = "1" ]; then
    echo "pre-push: skipped via SKIP_PREPUSH=1"
    exit 0
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 1

# Optional per-machine settings, e.g. a DATABASE_URL for a developer whose
# default database is not usable for tests. Gitignored: it describes one
# machine, not the project.
[ -f "$ROOT/.prepush.env" ] && . "$ROOT/.prepush.env"

# What is being pushed. git feeds "<local ref> <local sha> <remote ref>
# <remote sha>" on stdin, one line per ref.
RANGE=""
while read -r _local_ref local_sha _remote_ref remote_sha; do
    [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue   # branch deletion
    if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
        RANGE="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~1)..$local_sha"   # new branch
    else
        RANGE="$remote_sha..$local_sha"
    fi
done
[ -z "$RANGE" ] && { echo "pre-push: nothing to check"; exit 0; }

CHANGED="$(git diff --name-only "$RANGE" 2>/dev/null)"
[ -z "$CHANGED" ] && { echo "pre-push: no file changes in $RANGE"; exit 0; }

TOUCHES_FRONTEND=$(echo "$CHANGED" | grep -cE '^frontend/' || true)
TOUCHES_BACKEND=$(echo "$CHANGED" | grep -cE '^backend/' || true)

echo "pre-push: $RANGE — frontend:$TOUCHES_FRONTEND backend:$TOUCHES_BACKEND changed files"

fail() { echo ""; echo "pre-push: $1"; echo "pre-push: push refused. SKIP_PREPUSH=1 git push  to override deliberately."; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "\`$1\` not found, so this check cannot run. Refusing rather than skipping — a check that did not run is not a check that passed."; }

if [ "$TOUCHES_FRONTEND" -gt 0 ]; then
    need npx
    cd "$ROOT/frontend" || fail "frontend/ missing"
    echo "  → tsc";   npx tsc --noEmit          || fail "tsc failed"
    echo "  → eslint"; npm run lint --silent    || fail "eslint failed"
    echo "  → jest";  npx jest --coverage=false --silent 2>&1 | tail -4
    [ "${PIPESTATUS[0]}" -eq 0 ] || fail "jest failed"
    cd "$ROOT" || exit 1
fi

if [ "$TOUCHES_BACKEND" -gt 0 ]; then
    cd "$ROOT/backend" || fail "backend/ missing"
    RUFF="${RUFF_BIN:-ruff}"
    command -v "$RUFF" >/dev/null 2>&1 || fail "\`$RUFF\` not found. Set RUFF_BIN in .prepush.env if it lives elsewhere."
    echo "  → ruff";  "$RUFF" check .          || fail "ruff failed"
    PY="${PYTHON_BIN:-python}"
    command -v "$PY" >/dev/null 2>&1 || fail "\`$PY\` not found. Set PYTHON_BIN in .prepush.env if it lives elsewhere."
    # `makemigrations --check` BEFORE pytest, because it is the cheap one and
    # because it catches a class the suite does not: a model `choices` list
    # losing a member alters a field, and Django notices while every test that
    # only reads today's members stays green. Verified by dropping GREEK from
    # the org category choices — this exits 1 and names the missing migration.
    #
    # It ran only in CI, and both workflows are `workflow_dispatch` now, so
    # nothing ran it at all.
    echo "  → makemigrations --check"
    "$PY" manage.py makemigrations --check --dry-run >/dev/null 2>&1 \
        || fail "makemigrations --check: a model changed without a migration. Run \`manage.py makemigrations\` and read what it generated before committing it."

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
    # Reports one line per service: "<name> <ok|down> <detail>".
    PROBE=$(DB_URL="${DATABASE_URL:-}" RD_URL="${REDIS_URL:-}" "$PY" - <<'PROBE_PY'
import os, re, socket

def from_env_file(key):
    try:
        with open("backend/.env", encoding="utf-8") as f:
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
    case "$RD_STATE" in
        ok*) ;;
        *)  echo "    → cache unreachable, starting a throwaway redis-server"
            command -v redis-server >/dev/null 2>&1 || fail "redis-server not found and the configured cache is unreachable. Refusing rather than running without one: the permission-cache tests degrade silently and report a false red, which is exactly the failure this probe exists to prevent."
            RPORT=$("$PY" -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); print(p)")
            redis-server --port "$RPORT" --daemonize yes --save '' --appendonly no >/dev/null 2>&1 \
                || fail "could not start a throwaway redis-server on port $RPORT"
            export REDIS_URL="redis://127.0.0.1:$RPORT/0"
            export CELERY_BROKER_URL="redis://127.0.0.1:$RPORT/1"
            export CELERY_RESULT_BACKEND="redis://127.0.0.1:$RPORT/2" ;;
    esac

    "$PY" -m pytest -q --no-header ${PYTEST_PREPUSH_ARGS:-} 2>&1 | tail -4
    PYTEST_STATUS="${PIPESTATUS[0]}"
    # Stop the throwaway before deciding, so a failure does not leak a daemon.
    [ -n "$RPORT" ] && redis-cli -p "$RPORT" shutdown nosave >/dev/null 2>&1
    [ "$PYTEST_STATUS" -eq 0 ] || fail "pytest failed"
    cd "$ROOT" || exit 1
fi

echo "pre-push: ok"
EOF

chmod +x "$HOOKS_DIR/pre-push"

echo "✅ Git hooks installed successfully"
echo "   - pre-commit: ESLint on staged frontend files"
echo "   - pre-push:   tsc + eslint + jest (frontend) / ruff + pytest (backend),"
echo "                 scoped to what the push actually changes."
echo ""
echo "   Per-machine settings go in .prepush.env (gitignored) — PYTHON_BIN,"
echo "   RUFF_BIN, DATABASE_URL, PYTEST_PREPUSH_ARGS. The hook fails rather than"
echo "   skips when a tool is missing; SKIP_PREPUSH=1 git push overrides."
