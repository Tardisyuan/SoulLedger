/** The pure parts of withBuildTuning.js; dependency-free so jest can load them. */

const GRADLE = {
  "org.gradle.workers.max": "4",
  "android.enableMinifyInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
  reactNativeArchitectures: "armeabi-v7a,arm64-v8a",
};

/** gradle.properties entries → the same with ours set (each key once, replacing the template's value). */
function tuneGradleProperties(props) {
  const ours = new Set(Object.keys(GRADLE));
  return [
    ...props.filter((p) => !(p.type === "property" && ours.has(p.key))),
    ...Object.entries(GRADLE).map(([key, value]) => ({ type: "property", key, value })),
  ];
}

module.exports = { GRADLE, tuneGradleProperties };
