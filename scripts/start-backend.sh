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
nohup python manage.py runserver 0.0.0.0:8000 > "$LOG_FILE" 2>&1 &
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
