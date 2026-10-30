/**
 * plugins/withBuildTuning.js, the gradle.properties half (B1, 2026-10-30): Android release builds get R8 and
 * resource shrinking and arm only; the worker cap stays. The Expo template reads the two shrink flags inside
 * `buildTypes.release`, so a debug dev client is unchanged — that, and that R8 keeps what the native modules
 * need, only a real release build on a phone can show.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
// The pure half: withBuildTuning.js itself pulls in @expo/config-plugins, which jest cannot load here.
const { GRADLE, tuneGradleProperties } = require("../../plugins/buildTuning");
const soulApp = require("../../app.json");
const officerApp = require("../../../mobile-officer/app.json");
/* eslint-enable @typescript-eslint/no-require-imports */

type Prop = { type: "property"; key: string; value: string } | { type: "comment"; value: string } | { type: "empty" };

/** What `expo prebuild` writes before the plugin runs (the template's gradle.properties, cut down). */
const TEMPLATE: Prop[] = [
  { type: "comment", value: " Use this property to specify which architecture you want to build." },
  { type: "property", key: "reactNativeArchitectures", value: "armeabi-v7a,arm64-v8a,x86,x86_64" },
  { type: "empty" },
  { type: "property", key: "newArchEnabled", value: "true" },
  { type: "property", key: "org.gradle.workers.max", value: "8" },
];

const valueOf = (props: Prop[], key: string) => props.filter((p): p is Extract<Prop, { type: "property" }> => p.type === "property" && p.key === key).map((p) => p.value);

describe("withBuildTuning: gradle.properties", () => {
  const tuned: Prop[] = tuneGradleProperties(TEMPLATE);

  it("turns on R8 and resource shrinking for release builds", () => {
    expect(valueOf(tuned, "android.enableMinifyInReleaseBuilds")).toEqual(["true"]);
    expect(valueOf(tuned, "android.enableShrinkResourcesInReleaseBuilds")).toEqual(["true"]);
  });

  it("builds arm only — the template's x86 and x86_64 are gone, each key appears once", () => {
    expect(valueOf(tuned, "reactNativeArchitectures")).toEqual(["armeabi-v7a,arm64-v8a"]);
    expect(valueOf(tuned, "reactNativeArchitectures")[0]).not.toMatch(/x86/);
    expect(valueOf(tuned, "org.gradle.workers.max")).toEqual(["4"]);
    for (const key of Object.keys(GRADLE)) expect(valueOf(tuned, key)).toHaveLength(1);
  });

  it("leaves everything else as the template wrote it, and running twice changes nothing more", () => {
    expect(valueOf(tuned, "newArchEnabled")).toEqual(["true"]);
    expect(tuned.filter((p) => p.type !== "property")).toEqual(TEMPLATE.filter((p) => p.type !== "property"));
    expect(tuneGradleProperties(tuned)).toEqual(tuned);
  });

  it("touches no debug-only switch: nothing it sets names debug or the dev client", () => {
    expect(Object.keys(GRADLE).filter((k) => /debug|devclient/i.test(k))).toEqual([]);
  });

  it("the plugin applies exactly this rewrite to gradle.properties", () => {
    const fs = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
    const source: string = fs.readFileSync(require.resolve("../../plugins/withBuildTuning"), "utf8");
    expect(source).toContain('require("./buildTuning")');
    expect(source).toMatch(/withGradleProperties\([\s\S]*cfg\.modResults = tuneGradleProperties\(cfg\.modResults\)/);
  });

  it("both apps run it", () => {
    for (const app of [soulApp, officerApp]) {
      expect(app.expo.plugins.some((p: unknown) => (Array.isArray(p) ? p[0] : p).toString().endsWith("plugins/withBuildTuning"))).toBe(true);
    }
  });
});
