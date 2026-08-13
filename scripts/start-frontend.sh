#!/bin/bash
# Start SoulLedger frontend server in background

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"
LOG_FILE="$SCRIPT_DIR/logs/frontend.log"
PID_FILE="$SCRIPT_DIR/pids/frontend.pid"

mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/pids"

# Kill any process holding port 3333 (fallback for orphaned processes).
# lsof works on both macOS and Linux; ss+fuser (Linux-only) is the fallback
# for a system that somehow lacks lsof.
if command -v lsof >/dev/null 2>&1; then
    PORT_PIDS=$(lsof -ti tcp:3333 2>/dev/null || true)
    if [ -n "$PORT_PIDS" ]; then
        echo "Clearing port 3333..."
        kill $PORT_PIDS 2>/dev/null || true
        sleep 1
    fi
elif ss -tlnp 2>/dev/null | grep -q ':3333'; then
    echo "Clearing port 3333..."
    fuser -k 3333/tcp 2>/dev/null || true
    sleep 1
fi

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

# Auto-detect server IP for API URL. `hostname -I` is Linux-only; macOS
# has no equivalent flag, so fall back to ipconfig, then localhost.
if hostname -I >/dev/null 2>&1; then
    SERVER_IP=$(hostname -I | awk '{print $1}')
elif command -v ipconfig >/dev/null 2>&1; then
    SERVER_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
fi
SERVER_IP="${SERVER_IP:-localhost}"
NEXT_PUBLIC_API_URL="http://${SERVER_IP}:8000/api/v1"

echo "Building frontend..."
npm run build > "$LOG_FILE" 2>&1

echo "Starting frontend server (production mode)..."
PORT=3333 NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" nohup npm start > "$LOG_FILE" 2>&1 &
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
