/**
 * The Android shortcut and iOS App Intents plugins' pure rewrites (plugins/androidShortcuts.js,
 * plugins/appIntents.js) and the entry list both read (plugins/voiceEntries.js). Like the
 * scene-lifecycle plugin, each fails loudly when its input is not what it expects.
 */
import { parseSoulLink } from "../links";

/* eslint-disable @typescript-eslint/no-require-imports */
const { addShortcutsMeta, labelOf, shortcutsXml, stringsXml } = require("../../plugins/androidShortcuts");
const { LANGS, appShortcutsStrings, applyInfoPlist, checkEntries, swiftSource, titleOf } = require("../../plugins/appIntents");
const { APPS, appOf } = require("../../plugins/voiceEntries");
const en = require("@soulledger/core/messages/en.json");
const zh = require("@soulledger/core/messages/zh-Hans.json");
/* eslint-enable @typescript-eslint/no-require-imports */

const MESSAGES = { en, "zh-Hans": zh };

describe("voiceEntries", () => {
  it("lists two entries per app, and the soul ones are links the soul app understands", () => {
    for (const app of Object.values(APPS) as { entries: unknown[] }[]) expect(app.entries).toHaveLength(2);
    for (const e of APPS.soul.entries) expect(parseSoulLink(`${APPS.soul.scheme}://${e.path}`)).toEqual({ page: e.path });
  });

  it("every label exists in both languages, and every phrase carries the app name", () => {
    for (const app of Object.values(APPS) as { entries: { id: string; label: string }[] }[]) {
      checkEntries(app.entries);
      for (const e of app.entries) for (const lang of LANGS) expect(titleOf(e, lang, MESSAGES).length).toBeGreaterThan(3);
    }
  });

  it("rejects an unknown app", () => {
    expect(() => appOf("nope")).toThrow("unknown app");
  });
});

describe("withAndroidShortcuts", () => {
  const shortcuts = [{ id: "todo", url: "soulledger-officer://todo", label: "officer_app.tabs.todo" }];

  it("writes one VIEW shortcut per entry, aimed at the app's own MainActivity", () => {
    const xml: string = shortcutsXml({ packageName: "com.soulledger.officer", shortcuts });
    expect(xml).toContain('android:shortcutId="todo"');
    expect(xml).toContain('android:data="soulledger-officer://todo"');
    expect(xml).toContain('android:targetClass="com.soulledger.officer.MainActivity"');
    expect(xml).toContain("@string/shortcut_todo");
  });

  it("takes the label from the messages, per language, and fails on a missing key", () => {
    expect(stringsXml(shortcuts, zh)).toContain('<string name="shortcut_todo">待办</string>');
    expect(stringsXml(shortcuts, en)).toContain('<string name="shortcut_todo">To do</string>');
    expect(() => labelOf(en, "officer_app.tabs.nope")).toThrow("no message");
  });

  it("escapes what XML and Android resources need escaped", () => {
    expect(stringsXml([{ id: "a", url: "x", label: "k" }], { k: `It's <b> & "c"` })).toContain(`It\\'s &lt;b&gt; &amp; &quot;c&quot;`);
  });

  const manifest = () => ({ manifest: { application: [{ activity: [{ $: { "android:name": ".MainActivity" } }] }] } });

  it("adds the meta-data to MainActivity once", () => {
    const m = addShortcutsMeta(addShortcutsMeta(manifest()));
    expect(m.manifest.application[0].activity[0]["meta-data"]).toEqual([
      { $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/shortcuts" } },
    ]);
  });

  it("fails loudly when the template has no MainActivity", () => {
    expect(() => addShortcutsMeta({ manifest: { application: [{ activity: [{ $: { "android:name": ".Other" } }] }] } })).toThrow("MainActivity");
  });
});

describe("withAppIntents", () => {
  const officer = appOf("officer");

  it("generates intents that open the page and a provider with the phrases", () => {
    const swift: string = swiftSource(officer, MESSAGES);
    expect(swift).toContain("struct OpenTodoIntent: AppIntent");
    expect(swift).toContain("static let openAppWhenRun: Bool = true");
    expect(swift).toContain('URL(string: "soulledger-officer://todo")');
    expect(swift).toContain('URL(string: "soulledger-officer://queue")');
    expect(swift).toContain("struct OfficerShortcuts: AppShortcutsProvider");
    expect(swift).toContain('"Open \\(.applicationName) to do"');
    // The Swift never decides anything.
    expect(swift.replace(/^\/\/.*$/gm, "")).not.toMatch(/approve|reject|submit/i);
  });

  it("writes the Chinese phrases the user says, keyed by the Swift phrases", () => {
    const strings: string = appShortcutsStrings(officer, "zh-Hans");
    expect(strings).toContain('"Open ${applicationName} to do" = "用${applicationName}打开待办";');
    expect(strings).toContain('"Open ${applicationName} judgments" = "用${applicationName}打开审判";');
    expect(appShortcutsStrings(appOf("soul"), "zh-Hans")).toContain("打开${applicationName}的本世");
  });

  it("refuses a phrase without the app name, or with it twice, or a language that does not pair up", () => {
    const entry = (phrases: object) => [{ id: "x", phrases }];
    expect(() => checkEntries(entry({ en: ["Open it"], "zh-Hans": ["打开"] }))).toThrow("exactly once");
    expect(() => checkEntries(entry({ en: ["${applicationName} ${applicationName}"], "zh-Hans": ["${applicationName}"] }))).toThrow("exactly once");
    expect(() => checkEntries(entry({ en: ["a ${applicationName}", "b ${applicationName}"], "zh-Hans": ["${applicationName}"] }))).toThrow("as many");
    expect(() => checkEntries(entry({ en: ["a ${applicationName}"] }))).toThrow("no zh-Hans phrase");
  });

  it("puts the languages and the alternative app name in Info.plist, keeping what was there", () => {
    const plist = applyInfoPlist({ CFBundleLocalizations: ["fr"] }, officer);
    expect(plist.CFBundleLocalizations).toEqual(["fr", "en", "zh-Hans"]);
    expect(plist.INAlternativeAppNames).toEqual([{ INAlternativeAppName: "灵魂簿官员" }]);
  });
});
