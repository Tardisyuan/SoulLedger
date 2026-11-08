/**
 * 锁屏实时进度, iOS side (user decision D13, 2026-11-06): a WidgetKit extension that draws the soul app's Live
 * Activity on the lock screen and in the Dynamic Island. The app starts / updates / ends it through the local
 * module modules/soulledger-live (mobile/src/liveProgress.ts); Android needs no native part (an ongoing
 * notification from expo-notifications).
 *
 * Writes ios/SoulLedgerLiveExtension/ (the widget's Swift, a copy of the module's SoulLedgerLiveAttributes.swift — ActivityKit
 * pairs app and widget by that type — and the extension's Info.plist), adds the app-extension target with its
 * Sources phase and its own group (the group has a path, so files are registered by bare name inside it; the
 * <Project>/file rule in CLAUDE.md is for the Expo template's path-less group), embeds it in the app (addTarget's
 * Copy Files phase) and sets NSSupportsLiveActivities. Idempotent: a target already there is left as it is.
 *
 * No App Group and no push entitlement: the activity carries its whole state and is updated from the app only.
 * Changing this file changes the native project: `expo prebuild` then a rebuild (scripts/build-mobile-dev.sh).
 */
const { withInfoPlist, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const { ATTRIBUTES_FILE, PLIST_FILE, TARGET, WIDGET_FILE, applyInfoPlist, widgetBuildSettings, widgetBundleId, widgetInfoPlist, widgetSwift } = require("./liveActivity");

/* global __dirname */
const ATTRIBUTES_SOURCE = path.join(__dirname, "../modules/soulledger-live/ios", ATTRIBUTES_FILE);

function appTargetSettings(project) {
  const app = project.getFirstTarget().firstTarget;
  const list = project.pbxXCConfigurationList()[app.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  for (const { value } of list.buildConfigurations) {
    const settings = configs[value]?.buildSettings;
    if (settings) return settings;
  }
  return {};
}

/**
 * addTarget appends the app's "Copy Files" (embed the .appex) after its script phases. With the Pods' and React
 * Native's scripts in between, Xcode can report "Cycle inside SoulLedger"; the phase goes right after the app's
 * Frameworks phase instead, where Xcode's own template puts "Embed Foundation Extensions".
 */
function embedBeforeScripts(project) {
  const phases = project.getFirstTarget().firstTarget.buildPhases;
  const embed = phases.findIndex((p) => p.comment === "Copy Files");
  const frameworks = phases.findIndex((p) => p.comment === "Frameworks");
  if (embed < 0 || frameworks < 0 || embed === frameworks + 1) return;
  const [phase] = phases.splice(embed, 1);
  phases.splice(phases.findIndex((p) => p.comment === "Frameworks") + 1, 0, phase);
}

module.exports = function withLiveActivity(config) {
  const bundleId = widgetBundleId(config.ios?.bundleIdentifier);
  config = withInfoPlist(config, (cfg) => {
    applyInfoPlist(cfg.modResults);
    return cfg;
  });
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, WIDGET_FILE), widgetSwift());
    fs.copyFileSync(ATTRIBUTES_SOURCE, path.join(dir, ATTRIBUTES_FILE));
    fs.writeFileSync(path.join(dir, PLIST_FILE), widgetInfoPlist());

    if (project.pbxTargetByName(TARGET)) return cfg;

    // addTarget's dependency on the app needs these sections; a fresh Expo project has neither.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    const app = appTargetSettings(project);
    const target = project.addTarget(TARGET, "app_extension", TARGET, bundleId);
    embedBeforeScripts(project);
    project.addBuildPhase([WIDGET_FILE, ATTRIBUTES_FILE], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    const group = project.addPbxGroup([WIDGET_FILE, ATTRIBUTES_FILE, PLIST_FILE], TARGET, TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);

    const settings = widgetBuildSettings({
      bundleId,
      version: config.version ?? "1.0.0",
      build: config.ios?.buildNumber ?? "1",
      team: app.DEVELOPMENT_TEAM,
      tablet: !!config.ios?.supportsTablet,
    });
    // With ccache on, the Podfile sets CC/CXX/LD to $(REACT_NATIVE_PATH)/scripts/xcode/ccache-clang.sh at
    // project level. The app target gets REACT_NATIVE_PATH from its Pods xcconfig; this extension has no pods,
    // so the path resolved to "/../../../node_modules/…" and the device build failed (2026-11-08). Give it the
    // real react-native directory, as node resolves it from the app.
    const rn = path.dirname(require.resolve("react-native/package.json", { paths: [cfg.modRequest.projectRoot] }));
    settings.REACT_NATIVE_PATH = `"${rn}"`;
    const configs = project.pbxXCBuildConfigurationSection();
    for (const { value } of project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList].buildConfigurations) {
      Object.assign(configs[value].buildSettings, settings);
    }
    return cfg;
  });
};
