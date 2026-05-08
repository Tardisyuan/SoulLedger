#!/bin/bash
# Check status of SoulLedger services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== SoulLedger Service Status ==="
echo ""

check_service() {
    local name=$1
    local pid_file="$SCRIPT_DIR/pids/$name.pid"
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "  $name : RUNNING (PID $pid)"
        else
            echo "  $name : DEAD (stale PID file)"
        fi
    else
        echo "  $name : NOT RUNNING"
    fi
}

check_service "backend"
check_service "frontend"

echo ""
echo "=== Docker Services ==="
docker ps --filter "name=soulledger" --format "  {{.Names}} : {{.Status}}" 2>/dev/null
echo ""
echo "=== URLs ==="
echo "  Backend API : http://localhost:8000/api/v1/"
echo "  Frontend   : http://localhost:3333"
