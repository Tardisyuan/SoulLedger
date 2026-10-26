/**
 * Native build settings for this 16 GB / 8-core Mac (2026-10-27, user decision), used by both apps.
 *   - ccache on (`apple.ccacheEnabled`, read by the Expo Podfile): a rebuild reuses every unchanged
 *     object file. Needs `brew install ccache`; without it the Podfile skips it and builds as before.
 *   - Android: at most 4 Gradle workers (`org.gradle.workers.max`), the same limit as the iOS jobs
 *     set by scripts/build-mobile-dev.sh.
 * Sentry is dropped from builds without a DSN in each app's react-native.config.js, not here.
 */
const { withGradleProperties, withPodfileProperties } = require("@expo/config-plugins");

module.exports = function withBuildTuning(config) {
  config = withPodfileProperties(config, (cfg) => {
    cfg.modResults["apple.ccacheEnabled"] = "true";
    return cfg;
  });
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === "property" && p.key === "org.gradle.workers.max"));
    cfg.modResults.push({ type: "property", key: "org.gradle.workers.max", value: "4" });
    return cfg;
  });
};
