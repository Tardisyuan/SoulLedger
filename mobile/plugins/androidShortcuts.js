/** The pure parts of withAndroidShortcuts.js; dependency-free so jest can load them. */

const META = "android.app.shortcuts";

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Looks `a.b.c` up in a messages object; throws (fails the prebuild) when the key is gone. */
function labelOf(messages, key) {
  const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), messages);
  if (typeof value !== "string" || value === "") throw new Error(`withAndroidShortcuts: no message "${key}".`);
  return value;
}

/** res/xml/shortcuts.xml: one static shortcut per entry, each a VIEW intent on the app's own deep link. */
function shortcutsXml({ packageName, shortcuts }) {
  const items = shortcuts
    .map(
      (s) => `  <shortcut android:shortcutId="${s.id}" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/shortcut_${s.id}">
    <intent android:action="android.intent.action.VIEW" android:data="${escapeXml(s.url)}" android:targetPackage="${packageName}" android:targetClass="${packageName}.MainActivity" />
  </shortcut>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">\n${items}\n</shortcuts>\n`;
}

/** res/values[-zh][-b+zh+Hans]/strings_shortcuts.xml. A file of its own, so Expo's strings.xml is never touched. */
function stringsXml(shortcuts, messages) {
  const items = shortcuts.map((s) => `  <string name="shortcut_${s.id}">${escapeXml(labelOf(messages, s.label)).replace(/'/g, "\\'")}</string>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${items}\n</resources>\n`;
}

/** Adds <meta-data android.app.shortcuts> to MainActivity; idempotent, throws if the template has no MainActivity. */
function addShortcutsMeta(manifest) {
  const app = manifest.manifest?.application?.[0];
  const main = app?.activity?.find((a) => a.$?.["android:name"] === ".MainActivity");
  if (!main) throw new Error("withAndroidShortcuts: AndroidManifest.xml no longer has .MainActivity; update the plugin.");
  const meta = (main["meta-data"] ??= []);
  if (!meta.some((m) => m.$?.["android:name"] === META)) {
    meta.push({ $: { "android:name": META, "android:resource": "@xml/shortcuts" } });
  }
  return manifest;
}

module.exports = { addShortcutsMeta, labelOf, shortcutsXml, stringsXml };
