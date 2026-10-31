#!/bin/bash
# scripts/synapse-test.sh up|down — a disposable Synapse for backend/tests/test_chat_synapse_integration.py.
#
# Used by CI's `synapse` job (.github/workflows/ci.yml). That file skips without SYNAPSE_TEST_URL, so before
# 2026-10-31 it ran nowhere (review C21). It is not a GitHub `services:` container because Synapse first has
# to `generate` its homeserver.yaml, and ours is that file plus config/synapse/homeserver.soulledger.yaml
# (secrets substituted) with config/synapse mounted as the module path — a service starts before checkout.
#
# Needs SYNAPSE_TEST_SERVER_NAME, SYNAPSE_TEST_JWT_SECRET, SYNAPSE_TEST_SHARED_SECRET (the same values the
# test reads). SYN_PUSH_URL: where the policy module calls back (default: the test's --liveserver on
# host.docker.internal:18099). SYN_DOCKER_ARGS: extra `docker run` flags (ports, network, --add-host).
set -euo pipefail
NAME="${SYN_NAME:-sl-synapse-test}"
DIR="${SYN_DIR:-${RUNNER_TEMP:-/tmp}/$NAME}"
IMAGE=matrixdotorg/synapse:v1.161.0   # the version the test file was first run against (2026-09-19)
case "${1:-}" in
    down) docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR"; exit 0 ;;
    up) ;;
    *) echo "usage: $0 up|down"; exit 2 ;;
esac
: "${SYNAPSE_TEST_SERVER_NAME:?}" "${SYNAPSE_TEST_JWT_SECRET:?}" "${SYNAPSE_TEST_SHARED_SECRET:?}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUSH="${SYN_PUSH_URL:-http://host.docker.internal:18099/api/v1/chat/hooks/new-message/}"
OWNER=(-e UID="$(id -u)" -e GID="$(id -g)")

docker rm -f "$NAME" >/dev/null 2>&1 || true
rm -rf "$DIR"; mkdir -p "$DIR"
docker run --rm -v "$DIR:/data" "${OWNER[@]}" -e SYNAPSE_SERVER_NAME="$SYNAPSE_TEST_SERVER_NAME" \
    -e SYNAPSE_REPORT_STATS=no "$IMAGE" generate >/dev/null
# Appended, as in deployment: for a key both define, the later one wins.
sed -e "s|\${MATRIX_JWT_SECRET}|$SYNAPSE_TEST_JWT_SECRET|g" \
    -e "s|\${MATRIX_REGISTRATION_SHARED_SECRET}|$SYNAPSE_TEST_SHARED_SECRET|g" \
    -e "s|\${MATRIX_SERVER_NAME}|$SYNAPSE_TEST_SERVER_NAME|g" \
    -e "s|\${MATRIX_PUSH_HOOK_URL}|$PUSH|g" \
    "$ROOT/config/synapse/homeserver.soulledger.yaml" >>"$DIR/homeserver.yaml"
if grep -qE '^[^#]*\$\{' "$DIR/homeserver.yaml"; then
    echo "synapse-test: an unsubstituted \${...} is left in homeserver.yaml:"; grep -nE '^[^#]*\$\{' "$DIR/homeserver.yaml"; exit 1
fi
# The test's own note: relax the rc_* limits for a test (one client sends everything here).
cat >>"$DIR/homeserver.yaml" <<'YAML'
rc_message: {per_second: 1000, burst_count: 1000}
rc_joins: {local: {per_second: 1000, burst_count: 1000}}
rc_invites: {per_room: {per_second: 1000, burst_count: 1000}, per_user: {per_second: 1000, burst_count: 1000}}
rc_registration: {per_second: 1000, burst_count: 1000}
YAML
# shellcheck disable=SC2086
docker run -d --name "$NAME" ${SYN_DOCKER_ARGS:-} -v "$DIR:/data" -v "$ROOT/config/synapse:/modules:ro" \
    -e PYTHONPATH=/modules "${OWNER[@]}" "$IMAGE" >/dev/null
for _ in $(seq 90); do
    docker exec "$NAME" curl -fsS http://localhost:8008/health >/dev/null 2>&1 && { echo "synapse-test: $NAME is up"; exit 0; }
    sleep 2
done
echo "synapse-test: $NAME did not become healthy in 180 s"; docker logs --tail 60 "$NAME"; exit 1
