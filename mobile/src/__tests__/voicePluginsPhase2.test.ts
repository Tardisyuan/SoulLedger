/**
 * Phase 2 of the voice plan (docs/PLAN-voice-assistants.md §6): the iOS intents that SPEAK a cached
 * number, the ask intent that carries a question, and the App Group both ride on. Pure rewrites
 * only (plugins/appIntents.js, plugins/voiceEntries.js), like voicePlugins.test.ts.
 */
import { parseSoulLink } from "../links";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const {
  ASK_MAX,
  GROUP_KEY,
  appGroupOf,
  appShortcutsStrings,
  applyEntitlements,
  applyInfoPlist,
  checkSpoken,
  localizableStrings,
  swiftSource,
} = require("../../plugins/appIntents");
const { appOf } = require("../../plugins/voiceEntries");
const { ASK_MAX_LENGTH } = require("../links");
const en = require("@soulledger/core/messages/en.json");
const zh = require("@soulledger/core/messages/zh-Hans.json");
/* eslint-enable @typescript-eslint/no-require-imports */

const MESSAGES = { en, "zh-Hans": zh };
const soul = appOf("soul");
const officer = appOf("officer");
const code = (swift: string) => swift.replace(/^\s*\/\/.*$/gm, "");
const moduleSwift = () => fs.readFileSync(path.join(__dirname, "../../modules/soulledger-voice/ios/SoulLedgerVoiceModule.swift"), "utf8");

describe("the generated Swift", () => {
  it("the officer speaks the to-do total behind an unlock, from the cache, and has no ask", () => {
    const swift: string = swiftSource(officer, MESSAGES);
    expect(swift).toContain("struct SpeakTodoCountIntent: AppIntent");
    expect(swift).toContain("static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication");
    expect(swift).toContain('key: "todo"');
    expect(swift).toContain('NSLocalizedString("voice.todoCount.line"');
    expect(swift).toContain('"\\(.applicationName) to do count"');
    expect(swift).toContain("SpeakTodoCountIntent()");
    expect(swift).not.toContain("AskIntent");
  });

  it("the soul speaks the cooldown days; the ask intent takes a String and opens the app on ?q=", () => {
    const swift: string = swiftSource(soul, MESSAGES);
    expect(swift).toContain("struct SpeakCooldownDaysIntent: AppIntent");
    expect(swift).toContain('key: "cooldown"');
    expect(swift).toContain("struct AskIntent: AppIntent");
    expect(swift).toContain("@Parameter(");
    // Explicit resources in the Localizable table: bare literals stayed English on a zh-Hans device.
    expect(swift).toContain('title: LocalizedStringResource("Question", table: "Localizable")');
    expect(swift).toContain('requestValueDialog: IntentDialog(LocalizedStringResource("What would you like to ask?", table: "Localizable"))');
    expect(localizableStrings(soul, "zh-Hans", MESSAGES)).toContain('"Question" = "问题";');
    expect(swift).toContain("var question: String");
    expect(swift).toContain(`.prefix(${ASK_MAX})`);
    expect(swift).toContain('URL(string: "soulledger://ask" + (encoded.isEmpty ? "" : "?q=" + encoded))');
    // An empty answer still opens the drawer: the link is never skipped on an empty question.
    expect(swift).not.toContain("if !text.isEmpty");
    expect(swift).toContain("addingPercentEncoding(withAllowedCharacters: .alphanumerics)");
    expect(swift).toContain("AskIntent()");
    expect(ASK_MAX).toBe(ASK_MAX_LENGTH);
    expect(parseSoulLink("soulledger://ask?q=x")).toEqual({ page: "ask", question: "x" });
  });

  it("no native code decides anything, reaches the network, or touches a credential", () => {
    for (const def of [soul, officer]) {
      const swift = code(swiftSource(def, MESSAGES));
      expect(swift).not.toMatch(/approve|reject|submit/i);
      expect(swift).not.toMatch(/URLSession|URLRequest|Keychain|SecItem|token|password/i);
    }
    expect(code(moduleSwift())).not.toMatch(/URLSession|URLRequest|Keychain|SecItem|token|password/i);
  });

  it("the intents and the native module agree on the App Group key and the cache key format", () => {
    const intents: string = swiftSource(soul, MESSAGES);
    expect(moduleSwift()).toContain(`"${GROUP_KEY}"`);
    expect(intents).toContain(`"${GROUP_KEY}"`);
    expect(moduleSwift()).toContain('prefix = "voice."');
    expect(moduleSwift()).toContain('"\\(Self.prefix)\\(key)"');
    expect(moduleSwift()).toContain('"\\(Self.prefix)\\(key).at"');
    expect(intents).toContain('forKey: "voice.\\(key)"');
    expect(intents).toContain('forKey: "voice.\\(key).at"');
  });

  it("every cache key a readout reads is one the JS side can publish", () => {
    for (const def of [soul, officer]) for (const r of def.readouts) expect(["todo", "cooldown"]).toContain(r.cache);
  });
});

describe("the spoken strings", () => {
  it("come in both languages, the time first and the number second, with a neutral line when empty", () => {
    const zhStrings: string = localizableStrings(soul, "zh-Hans", MESSAGES);
    expect(zhStrings).toContain('"voice.cooldownDays.line" = "截至 %@，冷却还剩 %lld 天。";');
    expect(zhStrings).toContain('"voice.cooldownDays.empty" = "还没有数据。请先打开 App 看一眼，再来问我。";');
    expect(zhStrings).toContain('"What would you like to ask?" = "你想问什么？";');
    expect(localizableStrings(officer, "en", MESSAGES)).toContain('"voice.todoCount.line" = "As of %@, %lld items are waiting for you.";');
    expect(appShortcutsStrings(soul, "zh-Hans")).toContain('"Check my cooldown in ${applicationName}" = "用${applicationName}查冷却";');
    expect(appShortcutsStrings(soul, "zh-Hans")).toContain("向${applicationName}提问");
  });

  it("are refused when they would speak the wrong thing", () => {
    const base = soul.readouts[0];
    const withPart = (part: string, value: object) => ({ readouts: [{ ...base, [part]: value }], asks: [] });
    expect(() => checkSpoken({ readouts: soul.readouts, asks: soul.asks })).not.toThrow();
    expect(() => checkSpoken(withPart("line", { en: "N is %lld", "zh-Hans": "%@ %lld" }))).toThrow("needs %@ exactly once");
    expect(() => checkSpoken(withPart("line", { en: "%@ only", "zh-Hans": "%@ %lld" }))).toThrow("needs %lld");
    expect(() => checkSpoken(withPart("line", { en: "%lld at %@", "zh-Hans": "%@ %lld" }))).toThrow("before %lld");
    expect(() => checkSpoken(withPart("zero", { en: "none at %@" }))).toThrow("no zh-Hans zero");
    expect(() => checkSpoken(withPart("empty", { en: "got %lld", "zh-Hans": "无" }))).toThrow("takes no number");
    expect(() => checkSpoken({ readouts: [], asks: [{ ...soul.asks[0], path: "a/b" }] })).toThrow("plain letters");
  });
});

describe("the App Group", () => {
  it("is derived per app from its bundle id and added to the entitlements once", () => {
    expect(appGroupOf("com.soulledger.officer")).toBe("group.com.soulledger.officer");
    expect(appGroupOf("com.soulledger.soul")).not.toBe(appGroupOf("com.soulledger.officer"));
    expect(() => appGroupOf(undefined)).toThrow("not usable");
    expect(() => appGroupOf("a b")).toThrow("not usable");
    const once = applyEntitlements({ "com.apple.security.application-groups": ["group.other"] }, "group.x");
    expect(once["com.apple.security.application-groups"]).toEqual(["group.other", "group.x"]);
    expect(applyEntitlements(once, "group.x")["com.apple.security.application-groups"]).toEqual(["group.other", "group.x"]);
    expect(applyInfoPlist({}, officer, "group.x")[GROUP_KEY]).toBe("group.x");
  });

  it("both apps declare a bundle id and the intents plugin for their own entry list", () => {
    const apps: [string, string][] = [
      ["../../app.json", "soul"],
      ["../../../mobile-officer/app.json", "officer"],
    ];
    for (const [file, app] of apps) {
      const json = JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
      expect(appGroupOf(json.expo.ios.bundleIdentifier)).toBe(`group.${json.expo.ios.bundleIdentifier}`);
      expect(json.expo.plugins.some((p: unknown) => Array.isArray(p) && /withAppIntents$/.test(p[0]) && p[1].app === app)).toBe(true);
    }
  });

  it("the officer app finds the shared native module", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../mobile-officer/package.json"), "utf8"));
    const dir = path.resolve(__dirname, "../../../mobile-officer", pkg.expo.autolinking.nativeModulesDir);
    expect(fs.existsSync(path.join(dir, "soulledger-voice/expo-module.config.json"))).toBe(true);
  });
});
