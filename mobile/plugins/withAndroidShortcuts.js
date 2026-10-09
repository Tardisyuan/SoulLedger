/**
 * Android launcher shortcuts (long-press the icon): static, each a deep link into the app
 * (`scheme` in app.json makes MainActivity answer it). Shared by both apps:
 *
 *   ["../mobile/plugins/withAndroidShortcuts", { "app": "officer" }]
 *
 * The entries are voiceEntries.js's. Each `label` is a key in packages/core/messages; the English
 * text goes to res/values, the Chinese to res/values-zh, so the labels are the in-app words and
 * cannot drift from them. Shortcuts only open pages.
 */
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const { addShortcutsMeta, shortcutsXml, stringsXml } = require("./androidShortcuts");
const { appOf } = require("./voiceEntries");

/* global __dirname */
const MESSAGES = path.join(__dirname, "../../packages/core/messages");
const read = (lang) => JSON.parse(fs.readFileSync(path.join(MESSAGES, `${lang}.json`), "utf8"));

module.exports = function withAndroidShortcuts(config, { app }) {
  const { scheme, entries } = appOf(app);
  const shortcuts = entries.map((e) => ({ id: e.id, url: `${scheme}://${e.path}`, label: e.label }));
  if (!config.android?.package) throw new Error("withAndroidShortcuts: android.package is not set.");
  config = withAndroidManifest(config, (cfg) => {
    addShortcutsMeta(cfg.modResults);
    return cfg;
  });
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res");
      const write = (file, contents) => {
        fs.mkdirSync(path.dirname(path.join(res, file)), { recursive: true });
        fs.writeFileSync(path.join(res, file), contents);
      };
      write("xml/shortcuts.xml", shortcutsXml({ packageName: config.android.package, shortcuts }));
      write("values/strings_shortcuts.xml", stringsXml(shortcuts, read("en")));
      // values-zh covers every Chinese device; b+zh+Hans is the same file under the BCP-47 name Expo's own locales use for app_name.
      for (const dir of ["values-zh", "values-b+zh+Hans"]) write(`${dir}/strings_shortcuts.xml`, stringsXml(shortcuts, read("zh-Hans")));
      return cfg;
    },
  ]);
};
