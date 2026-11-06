#!/bin/bash
# Install an iOS simulator dev client built in the cloud (.github/workflows/ios-sim-build.yml) into the booted
# simulator — the Mac does not compile iOS for this (user decision 2026-11-07).
#   scripts/ios-sim-fetch.sh <mobile|mobile-officer>
# Computes the app's native key here (scripts/mobile-native-key.sh, the same as build-mobile-dev.sh and the
# workflow), downloads <app>-<fingerprint>-rn<hash>.zip from the `ios-sim-dev` release, installs it with simctl.
# No such asset = the native side changed since the last cloud build: the script prints the command to start one.
# Boots nothing: with no simulator booted it says so and stops. JS changes need only Metro, not a new build.
set -euo pipefail
APP="${1:?mobile or mobile-officer}"
case "$APP" in mobile|mobile-officer) ;; *) echo "ios-sim-fetch: unknown app $APP" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null && (cd "$ROOT" && nvm use >/dev/null)
cd "$ROOT"

if ! xcrun simctl list devices booted | grep -q Booted; then
    echo "ios-sim-fetch: no simulator is booted. Boot one yourself when the load is down, then run this again." >&2
    exit 1
fi
read -r FP RNCONFIG < <(scripts/mobile-native-key.sh "$APP" ios)
[ -n "$FP" ] || { echo "ios-sim-fetch: could not compute the fingerprint" >&2; exit 1; }
ASSET="$APP-$FP-rn$RNCONFIG.zip"
case "$APP" in mobile) DSN_VAR=EXPO_PUBLIC_SENTRY_DSN_SOUL ;; *) DSN_VAR=EXPO_PUBLIC_SENTRY_DSN_OFFICER ;; esac
if [ -n "${!DSN_VAR:-}" ]; then echo "ios-sim-fetch: note: $DSN_VAR is set, but cloud builds have no Sentry native code"; fi

if ! gh release view ios-sim-dev --json assets --jq '.assets[].name' 2>/dev/null | grep -qxF "$ASSET"; then
    echo "ios-sim-fetch: no cloud build for $APP at fingerprint ${FP:0:12} ($ASSET)." >&2
    echo "ios-sim-fetch: start one (estimated half an hour), then run this again:" >&2
    echo "  gh workflow run ios-sim-build.yml --ref $(git rev-parse --abbrev-ref HEAD) -f app=$APP" >&2
    echo "  (the branch must be pushed: the workflow builds what is on GitHub)" >&2
    exit 1
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ios-sim-fetch.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
gh release download ios-sim-dev -p "$ASSET" -D "$TMP"
ditto -x -k "$TMP/$ASSET" "$TMP/app"
APP_PATH=$(ls -d "$TMP"/app/*.app | head -1)
xcrun simctl install booted "$APP_PATH"
echo "ios-sim-fetch: installed $(basename "$APP_PATH") ($APP, ${FP:0:12}). Start Metro: cd $APP && npx expo start --dev-client"
