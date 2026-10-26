#!/bin/bash
# Build and install a dev client without taking the whole Mac (2026-10-27, user decision).
#   scripts/build-mobile-dev.sh <mobile|mobile-officer> <ios|android> [extra expo run args, e.g. --device <udid>]
#
# ONLY WHEN THE NATIVE SIDE CHANGED. `@expo/fingerprint` hashes what goes into the native build (native
# dependencies, app.json plugins and config, react-native.config.js, …). Same hash as the last build
# that succeeded here = nothing to compile: the script says so and exits — start Metro for JS changes.
# A different hash runs `expo prebuild --no-install` (+ pod install) first, so a changed plugin or
# permission reaches ios/ / android/ (the step CLAUDE.md used to ask for by hand). FORCE=1 builds anyway.
# The last hashes live in <git common dir>/soulledger-native-builds/, shared by every worktree.
#
# - utility QoS + nice 10, like scripts/run-gates.sh: yields to whatever is in the foreground.
# - Xcode compiles at most $IOS_JOBS tasks at once (default 4 of 8 cores): each clang/swift task takes
#   hundreds of MB, and 8 at once pushed this 16 GB machine's swap to 19 of 20 GB.
# - ccache comes from mobile/plugins/withBuildTuning.js; Sentry's native code is left out of builds
#   without a DSN by each app's react-native.config.js (so the DSN is part of the build key below).
set -euo pipefail
APP="${1:?mobile or mobile-officer}"; PLATFORM="${2:?ios or android}"; shift 2
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_JOBS="${IOS_JOBS:-4}"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null && (cd "$ROOT" && nvm use >/dev/null)
cd "$ROOT/$APP"

case "$APP" in mobile) DSN_VAR=EXPO_PUBLIC_SENTRY_DSN_SOUL ;; *) DSN_VAR=EXPO_PUBLIC_SENTRY_DSN_OFFICER ;; esac
FP=$(npx @expo/fingerprint fingerprint:generate --platform "$PLATFORM" 2>/dev/null \
     | python3 -c "import json,sys; print(json.load(sys.stdin)['hash'])")
# react-native.config.js (Sentry on / off) is not part of the fingerprint: hash it in, with the DSN state.
KEY="$FP rnconfig=$(shasum react-native.config.js 2>/dev/null | cut -c1-12) sentry=$([ -n "${!DSN_VAR:-}" ] && echo on || echo off)"
STORE="$(git -C "$ROOT" rev-parse --git-common-dir)/soulledger-native-builds"
mkdir -p "$STORE"
LAST="$STORE/$APP-$PLATFORM"
if [ "${FORCE:-0}" != 1 ] && [ -f "$LAST" ] && [ "$(cat "$LAST")" = "$KEY" ]; then
    echo "build-mobile-dev: $APP $PLATFORM — native side unchanged since the last build (${FP:0:12}); nothing to compile."
    echo "build-mobile-dev: JS changes only need Metro: cd $APP && npx expo start --dev-client. FORCE=1 to build anyway."
    exit 0
fi
echo "build-mobile-dev: $APP $PLATFORM — native fingerprint ${FP:0:12} differs from the last build; prebuild + build"

command -v ccache >/dev/null || echo "build-mobile-dev: ccache not installed (brew install ccache) — building without the cache"
npx expo prebuild --platform "$PLATFORM" --no-install
if [ "$PLATFORM" = ios ]; then
    (cd ios && taskpolicy -c utility nice -n 10 pod install)
    # xcodebuild reads its concurrency from this user default; Xcode.app from the second.
    defaults write com.apple.dt.xcodebuild IDEBuildOperationMaxNumberOfConcurrentCompileTasks -int "$IOS_JOBS"
    defaults write com.apple.dt.Xcode IDEBuildOperationMaxNumberOfConcurrentCompileTasks -int "$IOS_JOBS"
else
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
fi
taskpolicy -c utility nice -n 10 npx expo run:"$PLATFORM" "$@"
echo "$KEY" >"$LAST"
