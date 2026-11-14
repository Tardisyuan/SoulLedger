/**
 * 锁屏实时进度 (D13): the widget plugin's pure half (plugins/liveActivity.js), the module it pairs with, and the
 * JSON the app sends (liveProgress.ts `nativeState`). The Swift is only compiled by Xcode — what jest can hold is
 * that the two sides name the same fields and that the plugin is registered for the soul app alone.
 */
import fs from "fs";
import path from "path";

import * as Notifications from "expo-notifications";

import { LIVE_ASKED_KEY, LIVE_CHANNEL, LIVE_NOTIFICATION, LOCK_GROUND, androidContent, endLiveProgress, liveAccent, liveChannel, liveTint, nativeState, showLiveProgress } from "../liveProgress";
import { installMobilePlatform, persistentStore } from "../platform";
import { PRIMER_SEEN_KEY } from "../push";
import { contrastRatio, seal, themeOf } from "../theme";
import type { LiveContent } from "@soulledger/core/domain/soulRoute";

// The local module: absent (null) unless a test installs one, as in jest and Expo Go.
let mockNative: Record<string, jest.Mock> | null = null;
jest.mock("expo", () => ({ ...jest.requireActual("expo"), requireOptionalNativeModule: () => mockNative }));

/* eslint-disable @typescript-eslint/no-require-imports */
const live = require("../../plugins/liveActivity");
/* eslint-enable @typescript-eslint/no-require-imports */

const ROOT = path.join(__dirname, "../..");
const attributes = fs.readFileSync(path.join(ROOT, "modules/soulledger-live/ios", live.ATTRIBUTES_FILE), "utf8");
const CONTENT: LiveContent = {
  title: "灵魂簿 · 实时进度",
  tag: "下行",
  headline: "Giulia Ferri · 地狱九圈",
  count: "第 4 / 4 步",
  compact: "4/4",
  place: "地狱九圈",
  island: "Giulia Ferri",
  first: "死亡",
  current: "地狱九圈",
  last: "地狱九圈",
  progress: 1,
  ended: false,
};

describe("the Live Activity's two halves", () => {
  it("the JSON the app sends has exactly the fields ContentState decodes", () => {
    const sent = Object.keys(JSON.parse(nativeState(CONTENT))).sort();
    const state = attributes.slice(attributes.indexOf("struct ContentState"), attributes.indexOf("public var title"));
    const declared = [...state.matchAll(/public var (\w+):/g)].map((m) => m[1]).sort();
    expect(declared.length).toBeGreaterThan(5);
    expect(sent).toEqual(declared);
    // title and tint are the activity's attributes, not its state.
    expect(sent).not.toContain("title");
  });

  it("the widget is a WidgetKit extension with a lock-screen and a Dynamic Island layout, and imports nothing from the app", () => {
    const swift: string = live.widgetSwift();
    expect(swift).toContain("ActivityConfiguration(for: SoulLedgerLiveAttributes.self)");
    for (const part of ["compactLeading", "compactTrailing", "minimal", "DynamicIslandExpandedRegion(.bottom)"]) expect(swift).toContain(part);
    expect(swift).not.toMatch(/import (ExpoModulesCore|React)/);
    expect(live.widgetInfoPlist()).toContain("<string>com.apple.widgetkit-extension</string>");
  });

  it("Design 第五十一批: one neutral card per scheme — the ground tinted, fixed text colours, a drawn track; the bar and mark per scheme", () => {
    const swift: string = live.widgetSwift();
    const lock = swift.slice(swift.indexOf("private struct LockScreenLive"), swift.indexOf("struct SoulLedgerLiveWidget"));
    expect(lock.length).toBeGreaterThan(500);
    expect(lock).toContain(".activityBackgroundTint(card.ground)");
    expect(lock).toContain("let card = Card.of(scheme)");
    expect(lock).toContain("Mark(tint: tints.mark(scheme))");
    expect(lock).toContain("Bar(progress: state.ended ? 1 : state.progress, fill: tints.bar(scheme), track: card.track)");
    expect(lock).toContain(".background(card.tag)");
    expect(lock).toContain(".font(.system(size: 15, weight: .semibold))");
    expect(lock).toContain(".font(.system(size: 13, weight: .medium).monospacedDigit())");
    // The system's vibrant colours, fill and progress view are gone: they follow the wallpaper, not our ground.
    // A bare `.primary` / `.secondary` (not `card.secondary`): the system's semantic style.
    expect(lock.match(/(?<![\w)])\.(primary|secondary)\b/g)).toBeNull();
    for (const gone of ["tertiarySystemFill", "ProgressView"]) expect(lock).not.toContain(gone);
    expect(swift.match(/(?<![\w)])\.(primary|secondary)\b/g)).toBeNull();
    // The two grounds and every neutral are generated from CARD, and the widget's ground is the one liveTint checks.
    for (const scheme of ["light", "dark"] as const) {
      for (const hex of Object.values(live.CARD[scheme] as Record<string, string>)) expect(swift).toContain(`Color(hex: "${hex}")`);
      expect(live.CARD[scheme].ground).toBe(LOCK_GROUND[scheme]);
    }
    // The island's ground is the system's black: the dark column.
    expect(swift).toContain("Tints(context.attributes.tint).mark(.dark)");
    expect(swift).toContain("let card = Card.dark");
    // The tag does not take the civilization's colour.
    expect(swift).not.toMatch(/tint\.opacity|tints\.\w+\.opacity/);
  });

  it("Design 第五十二批 E1: an ended road is full in civT; only the tag's words take --neg; the end's name is bold", () => {
    const swift: string = live.widgetSwift();
    const lock = swift.slice(swift.indexOf("private struct LockScreenLive"), swift.indexOf("struct SoulLedgerLiveWidget"));
    // The pale red is gone from the bar and from the widget altogether: no `Color.ended`, no fixed #F2849B outside CARD.
    expect(swift).not.toContain("Color.ended");
    expect(swift).not.toMatch(/0xF2 \/ 255/);
    expect(lock).not.toMatch(/fill: state\.ended/);
    expect(lock).toContain(".foregroundStyle(state.ended ? card.neg : card.main)");
    expect(lock).toContain("Text(state.last).fontWeight(state.ended ? .semibold : .regular).foregroundStyle(state.ended ? card.main : card.secondary)");
    expect([live.CARD.light.neg, live.CARD.dark.neg]).toEqual(["#A81E3C", "#F2849B"]);
    // The tag's words in --neg clear 4.5:1 on the tag's ground and on the card's (Design: 5.97 / 5.44, 6.77 / 6.86).
    for (const scheme of ["light", "dark"] as const) {
      expect(contrastRatio(live.CARD[scheme].neg, live.CARD[scheme].tag)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(live.CARD[scheme].neg, live.CARD[scheme].ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the widget still reads the older tints: 第四十九批's mark;barLight;barDark and a single colour", () => {
    const swift: string = live.widgetSwift();
    const tints = swift.slice(swift.indexOf("private struct Tints"), swift.indexOf("private struct Mark"));
    expect(tints).toContain("markDark = four ? parts[1] : first");
    expect(tints).toContain("barLight = four ? parts[2] : parts.count == 3 ? parts[1] : first");
    expect(tints).toContain("barDark = four ? parts[3] : parts.count == 3 ? parts[2] : first");
  });

  const CIVS = ["cn", "eu", "eg", "gr"] as const;

  it("liveTint: markLight;markDark;barLight;barDark — the seal and civT of each scheme", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21);
    for (const civ of CIVS) {
      const [markL, markD, barL, barD] = liveTint(civ).split(";");
      expect([markL, markD]).toEqual([seal[civ].light, seal[civ].dark]);
      // Design 第五十一批: every civT clears 3:1 on both card grounds, so the bar keeps the civilization's colour.
      expect([barL, barD]).toEqual([themeOf(civ, "light").plaque, themeOf(civ, "dark").plaque]);
    }
    // neutral has no seal: its mark is its bar.
    const [markL, markD, barL, barD] = liveTint("neutral").split(";");
    expect([markL, markD]).toEqual([barL, barD]);
  });

  it("Design 第五十一批: every civilization's bar and mark hold 3:1 on both card grounds", () => {
    for (const civ of CIVS) {
      const [markL, markD, barL, barD] = liveTint(civ).split(";");
      for (const [colour, scheme] of [[markL, "light"], [barL, "light"], [markD, "dark"], [barD, "dark"]] as const)
        expect([civ, scheme, colour, contrastRatio(colour, LOCK_GROUND[scheme]) >= 3]).toEqual([civ, scheme, colour, true]);
    }
  });

  it("liveTint: a scheme where civT falls under 3:1 draws the bar in that scheme's ink, the other keeps civT", () => {
    const saved = LOCK_GROUND.light;
    LOCK_GROUND.light = themeOf("cn", "light").plaque; // 1:1
    try {
      const [markL, , light, dark] = liveTint("cn").split(";");
      expect(markL).toBe(seal.cn.light);
      expect(light).toBe(themeOf("cn", "light").ink);
      expect(light).not.toBe(themeOf("cn", "light").plaque);
      expect(dark).toBe(themeOf("cn", "dark").plaque);
    } finally {
      LOCK_GROUND.light = saved;
    }
  });

  it("liveAccent: Android's accent is the walked bar of the system's scheme; older tints read as the widget reads them", () => {
    const tint = liveTint("eg");
    expect(liveAccent(tint, "light")).toBe(themeOf("eg", "light").plaque);
    expect(liveAccent(tint, "dark")).toBe(themeOf("eg", "dark").plaque);
    expect(liveAccent("#111111;#222222;#333333", "dark")).toBe("#333333");
    expect(liveAccent("#111111", "dark")).toBe("#111111");
  });

  it("the extension's bundle id hangs off the app's, its versions are the app's, and the app opts in to Live Activities", () => {
    expect(live.widgetBundleId("com.soulledger.soul")).toBe("com.soulledger.soul.live");
    expect(() => live.widgetBundleId(undefined)).toThrow("bundleIdentifier");
    const s = live.widgetBuildSettings({ bundleId: "a.b.live", version: "0.1.0", build: "7", team: undefined, tablet: false });
    expect([s.MARKETING_VERSION, s.CURRENT_PROJECT_VERSION, s.TARGETED_DEVICE_FAMILY, s.IPHONEOS_DEPLOYMENT_TARGET]).toEqual(['"0.1.0"', '"7"', '"1"', live.DEPLOYMENT_TARGET]);
    expect(s).not.toHaveProperty("DEVELOPMENT_TEAM");
    expect(live.applyInfoPlist({}).NSSupportsLiveActivities).toBe(true);
  });

  it("registered in the soul app only (the officer app has no live progress)", () => {
    const has = (file: string) =>
      JSON.parse(fs.readFileSync(file, "utf8")).expo.plugins.some((p: unknown) => (Array.isArray(p) ? p[0] : p) === "./plugins/withLiveActivity");
    expect(has(path.join(ROOT, "app.json"))).toBe(true);
    expect(has(path.join(ROOT, "../mobile-officer/app.json"))).toBe(false);
  });

  it("the lock screen shows the content (用户 2026-11-06 决定: A9 does not apply to live progress); every other channel keeps A9", () => {
    const { AndroidNotificationVisibility } = jest.requireMock("expo-notifications") as { AndroidNotificationVisibility: Record<string, number> };
    expect(liveChannel("x").lockscreenVisibility).toBe(AndroidNotificationVisibility.PUBLIC);
    // pushCore's channel (书信 and every server push) stays PRIVATE.
    const pushCore = fs.readFileSync(path.join(ROOT, "src/pushCore.ts"), "utf8");
    expect(pushCore).toContain("lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE");
    expect(pushCore).not.toContain("AndroidNotificationVisibility.PUBLIC");
  });

  it("Android: one ongoing notification, its lines from the same content", () => {
    const n = androidContent(CONTENT);
    expect(n).toMatchObject({ title: "灵魂簿 · 实时进度 · 下行", sticky: true, autoDismiss: false });
    expect(n.body).toBe("Giulia Ferri · 地狱九圈 · 第 4 / 4 步\n死亡 → 地狱九圈 → 地狱九圈");
  });
});

/**
 * 华为 TAS-AL00 (2026-11-06): nothing asked for POST_NOTIFICATIONS, so the ongoing notification never showed. The
 * first live progress asks once (the push path's own request); a refusal is final — no second dialog, no error.
 */
describe("Android: the notification permission, asked once by the first live progress", () => {
  const system = (Notifications as unknown as { __state: { status: string; answer: string; requests: number; canAskAgain?: boolean } }).__state;
  const { Platform } = jest.requireActual<typeof import("react-native")>("react-native");
  const os = Platform.OS;
  const version = Platform.Version;
  let scheduled: jest.SpyInstance;

  beforeEach(() => {
    installMobilePlatform();
    persistentStore.remove(LIVE_ASKED_KEY);
    persistentStore.remove(PRIMER_SEEN_KEY);
    Object.assign(system, { status: "undetermined", answer: "granted", requests: 0, canAskAgain: undefined });
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    // Android 13+: the system has a dialog to show.
    Object.defineProperty(Platform, "Version", { value: 34, configurable: true });
    scheduled = jest.spyOn(Notifications, "scheduleNotificationAsync");
  });
  afterEach(() => {
    scheduled.mockRestore();
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
    Object.defineProperty(Platform, "Version", { value: version, configurable: true });
  });

  it("not yet granted: asks once, shows on a grant, and does not ask again on the next update", async () => {
    await Promise.all([showLiveProgress(CONTENT, "#C8604F"), showLiveProgress(CONTENT, "#C8604F")]);
    expect(system.requests).toBe(1);
    expect(scheduled).toHaveBeenCalledWith(expect.objectContaining({ identifier: LIVE_NOTIFICATION }));
    // The push primer will not put the same system dialog up a second time.
    expect(persistentStore.get(PRIMER_SEEN_KEY)).toBeTruthy();
    await showLiveProgress(CONTENT, "#C8604F");
    expect(system.requests).toBe(1);
  });

  it("refused: nothing shown, no error, and never asked again — even where Android would allow a second ask", async () => {
    system.answer = "denied";
    await expect(showLiveProgress(CONTENT, "#C8604F")).resolves.toBeUndefined();
    expect(system.requests).toBe(1);
    expect(scheduled).not.toHaveBeenCalled();
    // Android 13 lets an app ask twice: the system reports "can ask again", and the app still does not.
    Object.assign(system, { status: "denied", canAskAgain: true });
    await showLiveProgress(CONTENT, "#C8604F");
    expect(system.requests).toBe(1);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it("already granted (the push path asked first): no dialog, just the notification", async () => {
    system.status = "granted";
    await showLiveProgress(CONTENT, "#C8604F");
    expect(system.requests).toBe(0);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("iOS: the Live Activity needs no notification permission — nothing is asked", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    await showLiveProgress(CONTENT, "#C8604F");
    expect(system.requests).toBe(0);
  });
});

/**
 * 华为 TAS-AL00 (2026-11-08): the notification expo posted never reached the lock screen — expo never sets
 * Notification.visibility (vis=PRIVATE), Android reset the channel's PUBLIC to NO_OVERRIDE, and the LOW channel was
 * "silent". The Kotlin side (modules/soulledger-live/android) posts it PUBLIC on a DEFAULT, silenced channel.
 */
describe("Android: the native module posts the live progress", () => {
  const system = (Notifications as unknown as { __state: { status: string } }).__state;
  const { Platform } = jest.requireActual<typeof import("react-native")>("react-native");
  const os = Platform.OS;
  const ROOT_MODULE = path.join(ROOT, "modules/soulledger-live");
  const kotlin = fs.readFileSync(path.join(ROOT_MODULE, "android/src/main/java/expo/modules/soulledgerlive/SoulLedgerLiveModule.kt"), "utf8");

  beforeEach(() => {
    installMobilePlatform();
    system.status = "granted";
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    mockNative = { notify: jest.fn(async () => true), end: jest.fn(async () => {}), show: jest.fn() };
  });
  afterEach(() => {
    mockNative = null;
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  });

  it("show goes to the module with the same lines and progress, not to expo-notifications", async () => {
    const scheduled = jest.spyOn(Notifications, "scheduleNotificationAsync");
    await showLiveProgress(CONTENT, "#C8604F");
    const n = androidContent(CONTENT);
    // A single-colour tint is its own accent in either scheme.
    expect(mockNative!.notify).toHaveBeenCalledWith(CONTENT.title, n.title, n.body, 1, "#C8604F");
    expect(mockNative!.show).not.toHaveBeenCalled();
    expect(scheduled).not.toHaveBeenCalled();
    scheduled.mockRestore();
  });

  it("end cancels through the module", async () => {
    const dismissed = jest.spyOn(Notifications, "dismissNotificationAsync");
    await endLiveProgress();
    expect(mockNative!.end).toHaveBeenCalledTimes(1);
    expect(dismissed).not.toHaveBeenCalled();
    dismissed.mockRestore();
  });

  it("the Kotlin side: the v2 channel at DEFAULT importance, silenced, the old channel deleted, the notification PUBLIC", () => {
    expect(LIVE_CHANNEL).toBe("live-progress-v2");
    expect(kotlin).toContain(`const val CHANNEL = "${LIVE_CHANNEL}"`);
    expect(kotlin).toContain('const val OLD_CHANNEL = "live-progress"');
    expect(kotlin).toContain("deleteNotificationChannel(OLD_CHANNEL)");
    expect(kotlin).toContain("NotificationManager.IMPORTANCE_DEFAULT");
    expect(kotlin).not.toContain("IMPORTANCE_LOW");
    for (const part of ["setVisibility(NotificationCompat.VISIBILITY_PUBLIC)", "setOngoing(true)", "setOnlyAlertOnce(true)", "setSilent(true)", "setSound(null, null)", "enableVibration(false)", "setShowBadge(false)"])
      expect(kotlin).toContain(part);
    // Tapping opens 本世 through the app's own link.
    expect(kotlin).toContain('"soulledger://life"');
    expect(kotlin).toContain("cancel(TAG, ID)");
    // Design 第五十一批: the accent the app sends wins over the manifest's colour; it is optional for older callers.
    expect(kotlin).toContain("progress: Double, accent: String? ->");
    expect(kotlin).toContain("(parse(accent) ?: color(ctx))?.let { setColor(it) }");
    const config = JSON.parse(fs.readFileSync(path.join(ROOT_MODULE, "expo-module.config.json"), "utf8"));
    expect(config.platforms).toEqual(expect.arrayContaining(["apple", "android"]));
    expect(config.android.modules).toEqual(["expo.modules.soulledgerlive.SoulLedgerLiveModule"]);
    // The officer app has no live progress: still excluded from its autolinking.
    const officer = JSON.parse(fs.readFileSync(path.join(ROOT, "../mobile-officer/package.json"), "utf8"));
    expect(officer.expo.autolinking.exclude).toContain("soulledger-live");
  });
});
