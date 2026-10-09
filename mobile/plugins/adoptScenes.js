/** The AppDelegate rewrite used by withSceneLifecycle.js; dependency-free so jest can load it. */
const WINDOW_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function adoptScenes(source) {
  if (source.includes("ExpoReactNativeFactoryProvider")) return source;
  const declaration = "class AppDelegate: ExpoAppDelegate {";
  if (!source.includes(declaration) || !WINDOW_BLOCK.test(source)) {
    throw new Error("withSceneLifecycle: AppDelegate.swift no longer matches the SDK 57 template; update the plugin.");
  }
  return source
    .replace(declaration, "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {")
    .replace(WINDOW_BLOCK, "\n    // The window and the React Native start live in ExpoAppSceneDelegate (scene life cycle, iOS 27).\n");
}

module.exports = { adoptScenes };
