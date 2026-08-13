#!/bin/bash
# Start SoulLedger backend server in background

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"
LOG_FILE="$SCRIPT_DIR/logs/backend.log"
PID_FILE="$SCRIPT_DIR/pids/backend.pid"

mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/pids"

# Load env
if [ -f "$BACKEND_DIR/.env" ]; then
    export $(grep -v '^#' "$BACKEND_DIR/.env" | xargs)
fi

cd "$BACKEND_DIR"

# Python interpreter: PYTHON env var wins if set (e.g. a named conda/pyenv
# env whose python isn't on PATH as python3/python) — verified by import,
# not just presence, so a wrong path fails loudly instead of 500ing on the
# first request. Otherwise auto-detect: project venv, then PATH's
# python3/python, same verification.
if [ -n "${PYTHON:-}" ]; then
    if ! "$PYTHON" -c "import django" >/dev/null 2>&1; then
        echo "PYTHON=$PYTHON was set but has no Django installed." >&2
        exit 1
    fi
else
    for candidate in "$BACKEND_DIR/.venv/bin/python" "$BACKEND_DIR/venv/bin/python" python3 python; do
        if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then
            if "$candidate" -c "import django" >/dev/null 2>&1; then
                PYTHON="$candidate"
                break
            fi
        fi
    done
    if [ -z "$PYTHON" ]; then
        echo "No python interpreter with Django installed found (checked backend/.venv, backend/venv, python3, python)." >&2
        echo "Set PYTHON=/path/to/python to point at one directly (e.g. a named conda env), or create backend/.venv and install requirements.txt." >&2
        exit 1
    fi
fi

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Backend already running (PID $OLD_PID)"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

echo "Starting backend server..."
nohup "$PYTHON" manage.py runserver 0.0.0.0:8000 > "$LOG_FILE" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$PID_FILE"

sleep 2
if kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend started: PID $BACKEND_PID"
    echo "Log: $LOG_FILE"
    echo "API: http://localhost:8000/api/v1/"
else
    echo "Backend failed to start — check $LOG_FILE"
    cat "$LOG_FILE"
    exit 1
fi
