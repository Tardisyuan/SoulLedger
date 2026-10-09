/**
 * iOS App Intents: "open this page" actions for Siri and Shortcuts (「用灵魂簿 · 官员打开待办」).
 * Shared by both apps:  ["../mobile/plugins/withAppIntents", { "app": "officer" }]
 *
 * Writes ios/<Project>/ShortcutIntents.swift (one AppIntent per entry in voiceEntries.js, each with
 * `openAppWhenRun`, each opening its deep link, plus an AppShortcutsProvider with the phrases),
 * adds it to the app target, and writes en / zh-Hans AppShortcuts.strings (the phrases) and
 * Localizable.strings (the titles) under Supporting/, the way Expo writes InfoPlist.strings for `locales`.
 * Info.plist gets CFBundleLocalizations and INAlternativeAppNames (the Chinese name Siri also accepts).
 * Nothing it generates approves, rejects or submits: it only opens pages.
 */
const { IOSConfig, withInfoPlist, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const { LANGS, appShortcutsStrings, applyInfoPlist, localizableStrings, swiftSource } = require("./appIntents");
const { appOf } = require("./voiceEntries");

/* global __dirname */
const MESSAGES = path.join(__dirname, "../../packages/core/messages");
const readMessages = () => ({
  en: JSON.parse(fs.readFileSync(path.join(MESSAGES, "en.json"), "utf8")),
  "zh-Hans": JSON.parse(fs.readFileSync(path.join(MESSAGES, "zh-Hans.json"), "utf8")),
});

module.exports = function withAppIntents(config, { app }) {
  const def = appOf(app);
  config = withInfoPlist(config, (cfg) => {
    applyInfoPlist(cfg.modResults, def);
    return cfg;
  });
  return withXcodeProject(config, (cfg) => {
    const { XcodeUtils } = IOSConfig;
    const messages = readMessages();
    const projectName = XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const appDir = path.join(cfg.modRequest.platformProjectRoot, projectName);
    const supporting = path.join(appDir, "Supporting");
    let project = cfg.modResults;

    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "ShortcutIntents.swift"), swiftSource(def, messages));
    project = XcodeUtils.addBuildSourceFileToGroup({ filepath: "ShortcutIntents.swift", groupName: projectName, project });

    for (const lang of LANGS) {
      fs.mkdirSync(path.join(supporting, `${lang}.lproj`), { recursive: true });
      const files = {
        "AppShortcuts.strings": appShortcutsStrings(def, lang),
        "Localizable.strings": localizableStrings(def, lang, messages),
      };
      const groupName = `${projectName}/Supporting/${lang}.lproj`;
      const group = XcodeUtils.ensureGroupRecursively(project, groupName);
      for (const [name, contents] of Object.entries(files)) {
        fs.writeFileSync(path.join(supporting, `${lang}.lproj`, name), contents);
        if (!group?.children.some(({ comment }) => comment === name)) {
          project = XcodeUtils.addResourceFileToGroup({ filepath: `${lang}.lproj/${name}`, groupName, project, isBuildFile: true, verbose: true });
        }
      }
    }
    cfg.modResults = project;
    return cfg;
  });
};
