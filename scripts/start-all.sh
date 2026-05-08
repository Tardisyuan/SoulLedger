#!/bin/bash
# Start SoulLedger all services (backend + frontend)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Starting SoulLedger ==="
bash "$SCRIPT_DIR/start-backend.sh"
bash "$SCRIPT_DIR/start-frontend.sh"
echo ""
echo "=== All services started ==="
echo "Backend API: http://localhost:8000/api/v1/"
echo "Frontend UI:  http://localhost:3000"
