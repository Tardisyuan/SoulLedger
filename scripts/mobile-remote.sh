#!/bin/bash
# The apps' Android dev clients, built and served from the unRAID box (2026-10-29).
# This Mac only rsyncs, scps the APK back and runs adb; gradle, expo and Metro run in containers there.
# <app> is mobile (soul app, Metro port 8081) or mobile-officer (officer app, port 8082), as in
# scripts/build-mobile-dev.sh. The two apps have different package names and live side by side.
#
#   scripts/mobile-remote.sh <app> build        rsync → (native fingerprint changed?) prebuild + assembleDebug
#                                               → scp the APK → adb install -r. Unchanged: says so, no build.
#   scripts/mobile-remote.sh <app> metro start  rsync, then Metro in a container on <box>:<port> (detached)
#   scripts/mobile-remote.sh <app> metro sync   rsync; the running Metro sees the change (inotify), and is
#                                               restarted if it was started under other JS dependencies
#   scripts/mobile-remote.sh <app> metro open   the same check, then adb: point the app at <box ip>:<port>
#   scripts/mobile-remote.sh <app> metro logs|stop
#
# Settings (environment):
#   MOBILE_REMOTE      ssh host (default: GATES_REMOTE from .prepush.env, else `unraid`)
#   MOBILE_REMOTE_IP   the box's LAN address the phone reaches (default 192.168.2.2)
#   EXPO_PUBLIC_API_URL  backend the JS talks to; read by Metro at `metro start` (it is inlined into
#                      the bundle, so changing it needs `metro stop` + `metro start`). Default
#                      http://192.168.2.2:8010/api/v1 — 8000 on the box is taken by another service.
#   ANDROID_SERIAL     adb device (default 88Y0219926008256, the Huawei TAS-AL00)
#   FORCE=1            build even when the native fingerprint is unchanged
#   MOBILE_REMOTE_CPUS / MOBILE_REMOTE_MEMORY / MOBILE_REMOTE_JOBS   build container limits (8 / 16g / 8)
#
# The fingerprint rule is scripts/build-mobile-dev.sh's (@expo/fingerprint + react-native.config.js +
# Sentry DSN state); the key of the last successful build lives in the synced tree on the box
# (.sl-android-key-<app>), so it is per checkout. Only arm64-v8a is compiled (every phone we install on).
# Builds take their own lock ($RDIR/android/build.lock), not the gates' run.lock: the box has 20
# cores, a gate container is held to 12 and a build to 8, so the two run side by side (user decision
# 2026-10-29); the lock only keeps two builds apart. Metro takes no lock — it is light.
set -euo pipefail
APP="${1:-}"; case "$APP" in mobile) PORT=8081 DSN_VAR=EXPO_PUBLIC_SENTRY_DSN_SOUL ;;
    mobile-officer) PORT=8082 DSN_VAR=EXPO_PUBLIC_SENTRY_DSN_OFFICER ;; *) sed -n '2,13p' "$0"; exit 2 ;; esac
shift
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.prepush.env" ] && . "$ROOT/.prepush.env"
H="${MOBILE_REMOTE:-${GATES_REMOTE:-unraid}}"
IP="${MOBILE_REMOTE_IP:-192.168.2.2}"
API_URL="${EXPO_PUBLIC_API_URL:-http://$IP:8010/api/v1}"
SERIAL="${ANDROID_SERIAL:-88Y0219926008256}"
RDIR="${GATES_REMOTE_DIR:-/mnt/cache/appdata/sl-gates}"
IMG="${MOBILE_REMOTE_IMAGE:-sl-mobile-android:1}"
RID="$(basename "$ROOT")-$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
W="$RDIR/android/work/$RID"
METRO="sl-metro-$APP-$RID"
DSN="${!DSN_VAR:-}"
P=mobile-remote
cd "$ROOT"

rsh() { ssh -o BatchMode=yes -o ConnectTimeout=5 "$H" "$@"; }

sync_tree() {
    rsh "mkdir -p $W $RDIR/android/sdk $RDIR/android/gradle"
    # Same file list and protections as run-gates.sh's remote_sync, minus .git; plus the generated
    # android/ and Expo's cache, so prebuild output and the gradle build survive --delete.
    { git ls-files -z; git ls-files -z -o --exclude-standard -- packages mobile mobile-officer scripts; } \
        | rsync -a --no-owner --no-group --delete --filter='P **/node_modules/' --filter='P mobile*/android/' \
            --filter='P mobile*/.expo/' --filter='P .sl-*' --from0 --files-from=- -r "$ROOT/" "$H:$W/"
}

# The JS dependency hash, as run-gates.sh's deps_hash_js: the lockfile, only the dependency fields of each
# package.json (a version or script edit reinstalls nothing), and the image. No Python is installed here, so
# there is no second hash. A function for its test (backend/tests/test_prepush_runs_the_gates_a_change_can_break.py).
deps_hash_js() {
    git ls-files -z -- package-lock.json '*package.json' | xargs -0 python3 -I -c '
import json, sys
fields = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "workspaces")
for path in sys.argv[1:]:
    data = json.load(open(path, encoding="utf-8"))
    if path.endswith("package-lock.json"):
        print(path, json.dumps(data, sort_keys=True))
    else:
        print(path, json.dumps({k: data.get(k) for k in fields}, sort_keys=True))
' || echo "unreadable $(date +%s%N)"
    echo "$IMG"
}
DEPS=$(deps_hash_js | shasum | cut -c1-16)
# Installed in the synced tree once per lockfile change (run-gates.sh's REMOTE_DEPS, without the venv).
REMOTE_DEPS='
    if [ "$(cat .sl-deps 2>/dev/null)" != "$SL_DEPS" ]; then
      echo "    (installing node_modules for these lockfiles — once per lockfile change)"
      { npx -y npm@11 ci --no-audit --no-fund --loglevel=error && git checkout -- package-lock.json 2>/dev/null; true; } >/tmp/deps.log 2>&1
      [ -d node_modules/.bin ] || { tail -20 /tmp/deps.log; echo "mobile-remote: npm ci failed"; exit 1; }
      echo "$SL_DEPS" > .sl-deps
    fi'

case "${1:-}" in
build)
    T0=$(date +%s)
    rsh "docker image inspect $IMG >/dev/null" || { echo "$P: $H unreachable or has no $IMG"; exit 1; }
    sync_tree
    echo "$P: synced to $H:$W ($(( $(date +%s) - T0 ))s); waiting for $RDIR/android/build.lock, then building $APP"
    NAME="sl-android-$APP-$RID-$$"
    trap 'rsh "docker rm -f $NAME" >/dev/null 2>&1' EXIT
    trap 'exit 130' INT TERM
    set +e
    rsh "flock $RDIR/android/build.lock docker run --rm --init --name $NAME \
        --cpus ${MOBILE_REMOTE_CPUS:-8} --memory ${MOBILE_REMOTE_MEMORY:-16g} \
        -v $W:/app -v $RDIR/android/sdk:/android/sdk -v $RDIR/android/gradle:/android/gradle -w /app \
        -e SL_DEPS=$DEPS -e FORCE=${FORCE:-0} -e JOBS=${MOBILE_REMOTE_JOBS:-8} -e EXPO_NO_TELEMETRY=1 -e EXPO_NO_GIT_STATUS=1 \
        -e APP=$APP -e DSN='$DSN' -e $DSN_VAR='$DSN' $IMG bash -c '$REMOTE_DEPS
      set -e
      if [ ! -x \$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager ]; then
        echo \"    (first run: Android command-line tools into the persistent SDK)\"
        curl -fsSL -o /tmp/clt.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
        rm -rf /tmp/clt && unzip -q /tmp/clt.zip -d /tmp/clt && mkdir -p \$ANDROID_HOME/cmdline-tools \
          && rm -rf \$ANDROID_HOME/cmdline-tools/latest && mv /tmp/clt/cmdline-tools \$ANDROID_HOME/cmdline-tools/latest
        yes | sdkmanager --licenses >/dev/null
      fi
      cd \$APP
      FP=\$(npx @expo/fingerprint fingerprint:generate --platform android 2>/dev/null | node -e \"let s=\\\"\\\";process.stdin.on(\\\"data\\\",d=>s+=d).on(\\\"end\\\",()=>console.log(JSON.parse(s).hash))\")
      KEY=\"\$FP rnconfig=\$(sha1sum react-native.config.js | cut -c1-12) sentry=\$([ -n \"\$DSN\" ] && echo on || echo off)\"
      if [ \"\$FORCE\" != 1 ] && [ -f /app/.sl-\$APP-debug.apk ] && [ \"\$(cat /app/.sl-android-key-\$APP 2>/dev/null)\" = \"\$KEY\" ]; then
        echo \"mobile-remote: native side unchanged (\${FP:0:12}) — nothing to compile\"; exit 3
      fi
      echo \"mobile-remote: native fingerprint \${FP:0:12} — prebuild + assembleDebug (arm64-v8a)\"
      npx expo prebuild --platform android --no-install >/tmp/prebuild.log 2>&1 || { tail -30 /tmp/prebuild.log; exit 1; }
      cd android
      ./gradlew assembleDebug --no-daemon -q -PreactNativeArchitectures=arm64-v8a -Dorg.gradle.workers.max=\$JOBS \
        -Dorg.gradle.jvmargs=-Xmx6g >/app/.sl-gradle-\$APP.log 2>&1 || { tail -60 /app/.sl-gradle-\$APP.log; exit 1; }
      cp app/build/outputs/apk/debug/app-debug.apk /app/.sl-\$APP-debug.apk
      echo \"\$KEY\" > /app/.sl-android-key-\$APP'"
    RC=$?
    set -e
    trap - EXIT
    if [ "$RC" = 3 ]; then
        echo "$P: no build needed ($(( $(date +%s) - T0 ))s). JS changes only need Metro: scripts/mobile-remote.sh $APP metro start|sync. FORCE=1 to build anyway."
        exit 0
    fi
    [ "$RC" = 0 ] || { echo "$P: build failed (exit $RC); full gradle log: $H:$W/.sl-gradle-$APP.log"; exit 1; }
    APK="${TMPDIR:-/tmp}/soulledger-$APP-debug.apk"
    scp -q -o BatchMode=yes "$H:$W/.sl-$APP-debug.apk" "$APK"
    echo "$P: built in $(( $(date +%s) - T0 ))s; APK $(du -h "$APK" | cut -f1) → adb -s $SERIAL install -r (unlock the phone; Huawei may ask to allow the install)"
    adb -s "$SERIAL" install -r "$APK"
    echo "$P: installed. Next: scripts/mobile-remote.sh $APP metro start && scripts/mobile-remote.sh $APP metro open"
    ;;
metro)
    # Always a fresh container: the install (REMOTE_DEPS) runs before Metro, so Metro's module map is built
    # over the node_modules that match $DEPS, never over a tree `npm ci` replaced under a running Metro.
    metro_start() {
        rsh "docker rm -f $METRO >/dev/null 2>&1; docker run -d --init --name $METRO --cpus 4 --memory 6g -p $PORT:$PORT \
            -v $W:/app -w /app -e SL_DEPS=$DEPS -e EXPO_NO_TELEMETRY=1 -e REACT_NATIVE_PACKAGER_HOSTNAME=$IP \
            -e EXPO_PUBLIC_API_URL='$API_URL' -e $DSN_VAR='$DSN' \
            $IMG bash -c '$REMOTE_DEPS
              cd $APP && exec npx expo start --dev-client --port $PORT --clear' >/dev/null"
        echo "$P: Metro ($APP) starting on http://$IP:$PORT (API $API_URL). Ready when 'metro logs' shows 'Waiting on'."
    }
    # A Metro started under other dependencies serves the module map of a node_modules that is gone
    # (2026-10-31: `Unable to resolve "react-native" from node_modules/react-native-is-edge-to-edge` after a
    # dependency change and only `metro sync`). The SL_DEPS it was started with is in its container's
    # environment; when that is not $DEPS it is restarted (which installs first). Automatic, not a hint: the
    # bundler error never names the cause. Not running (empty) = nothing to restart.
    running_deps() {
        { rsh "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $METRO 2>/dev/null" || true; } | sed -n 's/^SL_DEPS=//p'
    }
    restart_if_stale() {
        local was; was=$(running_deps)
        if [ -n "$was" ] && [ "$was" != "$DEPS" ]; then
            echo "$P: the running Metro was started under other JS dependencies ($was, now $DEPS); restarting it"
            sync_tree
            metro_start
        fi
    }
    case "${2:-}" in
    start)
        sync_tree
        metro_start
        echo "$P: open the app on it: scripts/mobile-remote.sh $APP metro open"
        ;;
    sync) sync_tree; restart_if_stale; echo "$P: synced; Metro on $H picks the change up" ;;
    open)
        restart_if_stale
        # No expo-dev-client in these apps: the APK is a plain React Native debug build, which reads the
        # packager address from debug_http_host in its default SharedPreferences (the dev menu's
        # "Debug server host"). run-as works because the build is debuggable. Restart to pick it up.
        PKG=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["expo"]["android"]["package"])' "$ROOT/$APP/app.json")
        X=$(printf '%s' "<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name=\"debug_http_host\">$IP:$PORT</string></map>" | base64)
        adb -s "$SERIAL" shell "am force-stop $PKG; echo $X | run-as $PKG sh -c 'mkdir -p shared_prefs && base64 -d > shared_prefs/${PKG}_preferences.xml'"
        adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
        echo "$P: $PKG on $SERIAL now loads its JS from $IP:$PORT (restarted)"
        ;;
    logs) rsh "docker logs --tail ${3:-40} $METRO" ;;
    stop) rsh "docker rm -f $METRO" >/dev/null && echo "$P: Metro stopped" ;;
    *) echo "usage: $0 $APP metro start|sync|open|logs|stop"; exit 2 ;;
    esac
    ;;
*) sed -n '2,13p' "$0"; exit 2 ;;
esac
