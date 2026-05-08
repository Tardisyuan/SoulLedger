#!/bin/bash
# Stop SoulLedger all services (backend + frontend)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Stopping SoulLedger ==="
bash "$SCRIPT_DIR/stop-backend.sh"
bash "$SCRIPT_DIR/stop-frontend.sh"
echo "=== All services stopped ==="
