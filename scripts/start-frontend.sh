#!/bin/bash
# Start SoulLedger frontend server in background

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"
LOG_FILE="$SCRIPT_DIR/logs/frontend.log"
PID_FILE="$SCRIPT_DIR/pids/frontend.pid"

mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/pids"

cd "$FRONTEND_DIR"

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Frontend already running (PID $OLD_PID)"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

echo "Starting frontend server..."
PORT=3333 nohup npm run dev > "$LOG_FILE" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$PID_FILE"

sleep 5
if kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend started: PID $FRONTEND_PID"
    echo "Log: $LOG_FILE"
    echo "UI: http://localhost:3333"
else
    echo "Frontend failed to start — check $LOG_FILE"
    cat "$LOG_FILE"
    exit 1
fi
