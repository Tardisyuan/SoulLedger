#!/bin/bash
# Install Git hooks for SoulLedger
# Run this after cloning the repository

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
# Ask git, do not assume `.git` is a directory. In a worktree (.claude/worktrees/*)
# `.git` is a one-line FILE pointing at the main repository, so "$ROOT_DIR/.git/hooks"
# is not a path and this script died on its first `cat >`. `--git-path hooks`
# resolves to the shared hooks directory from either checkout and honours
# core.hooksPath, which the hook is actually read from.
HOOKS_DIR="$(git -C "$ROOT_DIR" rev-parse --path-format=absolute --git-path hooks)"

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
# Pre-push hook: work out what is being pushed, then run scripts/run-gates.sh.
#
# All the gate logic — which areas run, what forces a full run, the backend
# interpreter, the throwaway Redis, the gate lock — lives in scripts/run-gates.sh,
# so a session can run exactly what a push would (`scripts/run-gates.sh`). This
# file only turns git's stdin into a list of changed files.
#
# The pushed checkout's own scripts/run-gates.sh is used, so a branch that
# changes the gates is checked by its own version. A branch that predates the
# file uses the copy scripts/install-hooks.sh left next to this hook.
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
# Git runs hooks with GIT_DIR (and friends) in the environment; run-gates.sh
# unsets them too, see there for the 2026-09-25 incident.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY

# TEST SEAM: PREPUSH_CHANGED (one path per line) replaces git's stdin, for
# backend/tests/test_prepush_runs_the_gates_a_change_can_break.py.
if [ -z "${PREPUSH_CHANGED+x}" ]; then
    # git feeds "<local ref> <local sha> <remote ref> <remote sha>" per ref.
    RANGE=""; TO_MAIN=0
    while read -r _local_ref local_sha remote_ref remote_sha; do
        [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue   # branch deletion
        # Anything that lands on main runs every suite in full.
        [ "$remote_ref" = "refs/heads/main" ] && TO_MAIN=1
        if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
            RANGE="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~1)..$local_sha"   # new branch
        else
            RANGE="$remote_sha..$local_sha"
        fi
    done
    [ -z "$RANGE" ] && { echo "pre-push: nothing to check"; exit 0; }
    # --no-renames: a rename is its old path deleted plus its new path added,
    # and a deleted path is one of the things that forces a full jest run.
    PREPUSH_CHANGED="$(git diff --name-only --no-renames "$RANGE" 2>/dev/null)"
    export PREPUSH_CHANGED PREPUSH_RANGE="$RANGE" PREPUSH_TO_MAIN="$TO_MAIN"
fi

RUNNER="$ROOT/scripts/run-gates.sh"
if [ ! -f "$RUNNER" ]; then
    RUNNER="$(git rev-parse --path-format=absolute --git-path hooks)/soulledger-gates/run-gates.sh"
    echo "pre-push: this checkout has no scripts/run-gates.sh — using the copy installed with the hook"
fi
[ -f "$RUNNER" ] || { echo "pre-push: no scripts/run-gates.sh anywhere; run scripts/install-hooks.sh. Push refused."; exit 1; }
exec bash "$RUNNER" --prepush
EOF

chmod +x "$HOOKS_DIR/pre-push"

# The hook runs the pushed checkout's scripts/run-gates.sh. A branch cut before
# that file existed has none, so a copy of it (and of the gate lock it sources)
# goes next to the hook; it is exactly as current as the hook itself.
mkdir -p "$HOOKS_DIR/soulledger-gates"
cp "$SCRIPT_DIR/run-gates.sh" "$SCRIPT_DIR/gate-lock.sh" "$HOOKS_DIR/soulledger-gates/"

echo "✅ Git hooks installed successfully"
echo "   - pre-commit: ESLint on staged frontend files"
echo "   - pre-push:   typecheck + eslint (packages/core), tsc + eslint + jest"
echo "                 (frontend, also on packages/ changes) / tsc + eslint +"
echo "                 jest (mobile, also on packages/ and globals.css) / tsc + eslint"
echo "                 + jest (officer, also on mobile/ and packages/) / ruff +"
echo "                 makemigrations --check + pytest (backend),"
echo "                 scoped to what the push actually changes; jest runs only"
echo "                 the affected tests unless a rule forces it full"
echo "                 (scripts/run-gates.sh, which sessions can run directly)."
echo ""
echo "   Backend gates run in backend/.venv (Python 3.11 + requirements.lock +"
echo "   requirements-dev.txt). Without it the hook refuses and prints the"
echo "   one-line command that creates it."
echo ""
echo "   Per-machine settings go in .prepush.env (gitignored) — DATABASE_URL,"
echo "   PYTEST_PREPUSH_ARGS, and PYTHON_BIN / RUFF_BIN only to override the venv."
echo "   A worktree without its own copy (or venv) uses the main checkout's. The"
echo "   hook fails rather than skips when a tool is missing; SKIP_PREPUSH=1 git"
echo "   push overrides."
