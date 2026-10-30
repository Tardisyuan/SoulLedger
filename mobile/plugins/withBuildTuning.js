/**
 * Native build settings for this 16 GB / 8-core Mac (2026-10-27, user decision), used by both apps.
 *   - ccache on (`apple.ccacheEnabled`, read by the Expo Podfile): a rebuild reuses every unchanged
 *     object file. Needs `brew install ccache`; without it the Podfile skips it and builds as before.
 *   - Android: at most 4 Gradle workers (`org.gradle.workers.max`), the same limit as the iOS jobs
 *     set by scripts/build-mobile-dev.sh.
 *   - Android release (B1, 2026-10-30): R8 and resource shrinking on, read by the Expo template's
 *     app/build.gradle inside `buildTypes.release` only — the debug dev client is built as before.
 *     And arm only (`reactNativeArchitectures`): internal distribution goes to phones, not x86 emulators.
 *     `expo run:android` passes the connected device's own ABI on the command line, which wins over this.
 * Sentry is dropped from builds without a DSN in each app's react-native.config.js, not here.
 */
const { withGradleProperties, withPodfileProperties } = require("@expo/config-plugins");

const { tuneGradleProperties } = require("./buildTuning");

function withBuildTuning(config) {
  config = withPodfileProperties(config, (cfg) => {
    cfg.modResults["apple.ccacheEnabled"] = "true";
    return cfg;
  });
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = tuneGradleProperties(cfg.modResults);
    return cfg;
  });
}

module.exports = withBuildTuning;
