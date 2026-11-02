#!/usr/bin/env bash
# What a finished `next build` contains of the demo. `absent`: a normal build must have none of it, in the
# browser's chunks or on the server. `present`: a demo build must have it (otherwise `absent` proves nothing).
#   scripts/check-demo-bundle.sh absent|present [frontend/.next]
set -u
WANT="${1:?absent or present}"
DIR="${2:-$(dirname "$0")/../frontend/.next}"
hits=$(grep -rlE 'soulledger_demo_overlay|demo_moderator|demo-enter-' "$DIR/static" "$DIR/server" 2>/dev/null | wc -l | tr -d ' ')
echo "demo markers found in $hits file(s) of $DIR (want: $WANT)"
if [ "$WANT" = absent ]; then [ "$hits" -eq 0 ]; else [ "$hits" -gt 0 ]; fi
