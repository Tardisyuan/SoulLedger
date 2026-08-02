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

echo "✅ Git hooks installed successfully"
echo "   - pre-commit: ESLint on staged frontend files"
