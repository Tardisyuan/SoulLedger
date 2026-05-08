#!/bin/bash
# Stop SoulLedger backend server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$SCRIPT_DIR/pids/backend.pid"
LOG_FILE="$SCRIPT_DIR/logs/backend.log"

if [ ! -f "$PID_FILE" ]; then
    echo "No PID file found — backend may not be running"
    exit 0
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping backend (PID $PID)..."
    kill "$PID"
    sleep 1
    if kill -0 "$PID" 2>/dev/null; then
        echo "Force killing..."
        kill -9 "$PID"
    fi
    echo "Backend stopped"
else
    echo "Process $PID not running"
fi

rm -f "$PID_FILE"
