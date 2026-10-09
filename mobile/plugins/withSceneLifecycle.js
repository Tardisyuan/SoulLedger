/**
 * iOS 27 asserts at launch unless the app adopts the scene-based life cycle
 * (`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, EXC_BREAKPOINT). Seen on
 * 2026-10-09: the officer app quit the instant it opened on an iOS 27.2 simulator.
 *
 * Expo ships the scene delegate (`ExpoAppSceneDelegate`, objc name `EXExpoAppSceneDelegate`),
 * but the SDK 57 prebuild template (57.0.29 included) still declares no scene manifest and
 * starts React Native into a window from the app delegate. This plugin, used by both apps:
 *   1. declares the scene manifest with Expo's delegate;
 *   2. makes AppDelegate an `ExpoReactNativeFactoryProvider`, so the scene delegate finds the
 *      factory;
 *   3. drops the app delegate's own window + startReactNative (the scene delegate does both).
 * Each rewrite fails the prebuild loudly if the template text it expects is gone.
 */
const { withAppDelegate, withInfoPlist } = require("@expo/config-plugins");

const { adoptScenes } = require("./adoptScenes");

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" },
        ],
      },
    };
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") throw new Error("withSceneLifecycle: expected a Swift AppDelegate.");
    cfg.modResults.contents = adoptScenes(cfg.modResults.contents);
    return cfg;
  });
};

