#!/bin/bash
# Build and install a dev client without taking the whole Mac (2026-10-27, user decision).
#   scripts/build-mobile-dev.sh <mobile|mobile-officer> <ios|android> [extra expo run args, e.g. --device <udid>]
# - utility QoS + nice 10, like scripts/run-gates.sh: yields to whatever is in the foreground.
# - Xcode compiles at most $IOS_JOBS tasks at once (default 4 of 8 cores): each clang/swift task takes
#   hundreds of MB, and 8 at once pushed this 16 GB machine's swap to 19 of 20 GB.
# - ccache comes from mobile/plugins/withBuildTuning.js; Sentry's native code is left out of builds
#   without a DSN by each app's react-native.config.js.
# Only rebuild after a native change (a new native module, app.json plugins). JS changes need Metro only.
set -euo pipefail
APP="${1:?mobile or mobile-officer}"; PLATFORM="${2:?ios or android}"; shift 2
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_JOBS="${IOS_JOBS:-4}"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null && (cd "$ROOT" && nvm use >/dev/null)
command -v ccache >/dev/null || echo "build-mobile-dev: ccache not installed (brew install ccache) — building without the cache"
if [ "$PLATFORM" = ios ]; then
    # xcodebuild reads its concurrency from this user default; Xcode.app from the second.
    defaults write com.apple.dt.xcodebuild IDEBuildOperationMaxNumberOfConcurrentCompileTasks -int "$IOS_JOBS"
    defaults write com.apple.dt.Xcode IDEBuildOperationMaxNumberOfConcurrentCompileTasks -int "$IOS_JOBS"
else
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
fi
cd "$ROOT/$APP"
exec taskpolicy -c utility nice -n 10 npx expo run:"$PLATFORM" "$@"
