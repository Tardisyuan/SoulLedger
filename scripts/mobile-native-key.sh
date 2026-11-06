#!/bin/bash
# Print "<fingerprint> <react-native.config.js hash>" for an app's native build: the one definition shared by
# scripts/build-mobile-dev.sh (skip a build whose native side is unchanged), .github/workflows/ios-sim-build.yml
# (name the Release asset) and scripts/ios-sim-fetch.sh (find that asset). The fingerprint is @expo/fingerprint's;
# react-native.config.js decides whether Sentry's native code is linked and is not part of it, so it is hashed in.
#   scripts/mobile-native-key.sh <mobile|mobile-officer> <ios|android>
set -euo pipefail
APP="${1:?mobile or mobile-officer}"; PLATFORM="${2:?ios or android}"
cd "$(dirname "${BASH_SOURCE[0]}")/../$APP"
FP=$(npx @expo/fingerprint fingerprint:generate --platform "$PLATFORM" 2>/dev/null \
     | python3 -c "import json,sys; print(json.load(sys.stdin)['hash'])")
echo "$FP $(shasum react-native.config.js 2>/dev/null | cut -c1-12)"
