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

STAGED_FILES=$(git diff --cached --name-only | grep -E '\.(ts|tsx|js|jsx)$' | grep -E '^frontend/')

if [ -n "$STAGED_FILES" ]; then
    echo "Running ESLint on staged frontend files..."
    cd frontend
    # Strip frontend/ prefix for paths relative to frontend dir
    RELATIVE_FILES=$(echo "$STAGED_FILES" | sed 's|^frontend/||')
    npx eslint $RELATIVE_FILES --max-warnings 0 2>&1 || {
        echo "ESLint failed. Fix errors before committing."
        exit 1
    }
    cd ..
fi
EOF

chmod +x "$HOOKS_DIR/pre-commit"

echo "✅ Git hooks installed successfully"
echo "   - pre-commit: ESLint on staged frontend files"
