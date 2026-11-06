/**
 * 锁屏实时进度 (D13): the widget plugin's pure half (plugins/liveActivity.js), the module it pairs with, and the
 * JSON the app sends (liveProgress.ts `nativeState`). The Swift is only compiled by Xcode — what jest can hold is
 * that the two sides name the same fields and that the plugin is registered for the soul app alone.
 */
import fs from "fs";
import path from "path";

import { androidContent, nativeState } from "../liveProgress";
import type { LiveContent } from "../soulRoute";

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
  island: "Giulia Ferri · 地狱九圈",
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

  it("Android: one ongoing notification, its lines from the same content", () => {
    const n = androidContent(CONTENT);
    expect(n).toMatchObject({ title: "灵魂簿 · 实时进度 · 下行", sticky: true, autoDismiss: false });
    expect(n.body).toBe("Giulia Ferri · 地狱九圈 · 第 4 / 4 步\n死亡 → 地狱九圈 → 地狱九圈");
  });
});
