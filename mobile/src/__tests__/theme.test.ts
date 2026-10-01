/**
 * The tokens against their sources.
 *
 * Since 2026-10-01 the colours are v3's (user decision: v3 fully replaces v2), printed as
 * hex — so they are compared as hex, verbatim. The status colours are still the ones
 * 规范 v2 §二 printed, and two of them (pos, lamp) still come from the 灵魂簿 App OKLCH
 * table; those rows are re-converted below.
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  NEUTRAL_PLAQUE,
  ON_PLAQUE,
  S2,
  oklchToHex,
  preLoginTheme,
  sealedTheme,
  semantic,
  themeFor,
  v3,
  v3Band,
  type CivKey,
  type ColorScheme,
  type Theme,
} from "../theme";

/** [dark OKLCH, light OKLCH], exactly as the 灵魂簿 App handoff's table prints them. */
const DESIGN_OKLCH: { path: (s: ColorScheme) => string; triples: [string, string] }[] = [
  { path: (s) => semantic[s].pos, triples: ["0.780 0.110 150", "0.480 0.120 150"] },
  // 朋友圈 handoff 1e draws the lamp dark only. Light lamp: 文明气质 1i gives #6A3E00 (confirmed 2026-09-27) —
  // the triple is that hex's OKLCH; lampBg light is still ours.
  { path: (s) => semantic[s].lamp, triples: ["0.860 0.110 85", "0.408 0.091 66"] },
  { path: (s) => semantic[s].lampBg, triples: ["0.230 0.030 80", "0.960 0.030 85"] },
];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The handoff rounds its OKLCH to three decimals, so its hex can sit a step or two off an exact conversion. */
function near(a: string, b: string): boolean {
  const [x, y] = [rgb(a), rgb(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= 2);
}

function contrast(a: string, b: string): number {
  const lum = (hex: string) =>
    rgb(hex)
      .map((c) => c / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const SCHEMES: ColorScheme[] = ["dark", "light"];
const KEYS: CivKey[] = ["neutral", "cn", "eu", "eg", "gr"];
const CIVS = ["cn", "eu", "eg", "gr"] as const;
const NAME: Record<CivKey, string | null> = { neutral: null, cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" };
const skin = (key: CivKey, scheme: ColorScheme) => themeFor(NAME[key], scheme);

describe("the status colours that still come from the OKLCH table", () => {
  it.each(SCHEMES)("%s", (scheme) => {
    const off = DESIGN_OKLCH.map(({ path, triples }) => {
      const triple = triples[scheme === "dark" ? 0 : 1];
      return { triple, token: path(scheme), converted: oklchToHex(triple) };
    }).filter(({ token, converted }) => !near(token, converted));
    expect(off).toEqual([]);
  });

  it("the transcription covers every row still taken from the table (a short list checks nothing)", () => {
    // The ink and ground rows (10) left with v3 (2026-10-01); pos, lamp, lampBg remain.
    expect(DESIGN_OKLCH).toHaveLength(3);
  });
});

describe("v1's accent and mark are gone (第三阶段)", () => {
  it("no theme carries them, so no screen can reach for them", () => {
    for (const key of KEYS) for (const scheme of SCHEMES) {
      const t = skin(key, scheme) as unknown as Record<string, unknown>;
      expect([key, scheme, "accent" in t, "mark" in t, "onAccent" in t]).toEqual([key, scheme, false, false, false]);
    }
    expect(Object.keys(preLoginTheme("light")).filter((k) => ["accent", "mark", "onAccent"].includes(k))).toEqual([]);
  });
});

describe("v3 is the palette (user decision 2026-10-01: v3 fully replaces v2)", () => {
  const STATUS = {
    dark: "pos #82CB92 · neg #FF7A93 · negStrong #C21D4D · negBg #33101A · negInk #FFD3DC · warn #FF9A3C · warnBg #301904 · lamp #F2CC7A · lampBg #241B0C",
    light: "pos #197037 · neg #A8103E · negStrong #A8103E · negBg #FFECEF · negInk #8A0C33 · warn #9F4A00 · warnBg #FFF1E2 · lamp #6A3E00 · lampBg #FBF1DC",
  };
  const pairs = (line: string) => line.split(" · ").map((p) => p.split(" "));

  it("is the user's palette, verbatim", () => {
    expect(v3.light).toEqual({ canvas: "#EFEFEB", surface: "#FBFBF8", ink: "#181A17", muted: "#646861", line: "#D1D3CD" });
    expect(v3.dark).toEqual({ canvas: "#10120F", surface: "#1A1D19", ink: "#F0F1EA", muted: "#A7ACA4", line: "#383C35" });
    expect(CIVS.map((c) => [c, v3.civ[c].light, v3.civ[c].dark])).toEqual([
      ["cn", "#8F3329", "#AD4B40"],
      ["eu", "#583875", "#80609A"],
      ["eg", "#294A8A", "#5F7FBE"],
      ["gr", "#285051", "#5A8480"],
    ]);
    expect(ON_PLAQUE).toBe("#FFFFFF");
  });

  it("the neutral plaque is the web's neutral --color-main, read from globals.css (dark :root, light .light)", () => {
    const css = readFileSync(join(__dirname, "../../../frontend/app/globals.css"), "utf8");
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split(/\n {2}\}/)[0];
    const neutral = (selector: string) => block(selector).match(/--color-civ-neutral:\s*([\d.\s]+);/)?.[1];
    // …and the web's neutral main IS that token (no data-civ = neutral).
    expect(block(":root")).toMatch(/--color-main: var\(--color-civ-neutral\);/);
    expect({ light: oklchToHex(neutral(".light") ?? ""), dark: oklchToHex(neutral(":root") ?? "") }).toEqual({
      light: NEUTRAL_PLAQUE.light.toLowerCase(),
      dark: NEUTRAL_PLAQUE.dark.toLowerCase(),
    });
    // Android's notification tint (app.json) is the same neutral, light.
    const app = require("../../app.json") as { expo: { plugins: unknown[] } };
    const notifications = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-notifications") as [string, { color: string }];
    expect(notifications[1].color.toLowerCase()).toBe(NEUTRAL_PLAQUE.light.toLowerCase());
    // v2's warm black / warm grey are gone.
    expect(Object.values(NEUTRAL_PLAQUE)).not.toEqual(expect.arrayContaining(["#2B2724"]));
    expect(Object.values(NEUTRAL_PLAQUE)).not.toEqual(expect.arrayContaining(["#6E665E"]));
  });

  it.each(SCHEMES)("%s: the nine status colours (规范 v2 §二) are untouched", (scheme) => {
    const printed = Object.fromEntries(pairs(STATUS[scheme]));
    const { scrim: _scrim, ...ours } = semantic[scheme];
    expect(ours).toEqual(printed);
  });

  it.each(SCHEMES)("%s: every skin, every screen, on the same neutrals — no per-civilization ground is left", (scheme) => {
    const n = v3[scheme];
    for (const key of KEYS) {
      const t = skin(key, scheme);
      expect([key, t.s0, t.s1, t.s2, t.hair, t.hair2, t.ink, t.inkMuted, t.inkSubtle]).toEqual([key, n.canvas, n.surface, S2[scheme], n.line, n.line, n.ink, n.muted, n.muted]);
    }
  });

  it.each(SCHEMES)("%s: the civilization is its colour alone; an unknown one borrows no one's", (scheme) => {
    for (const c of CIVS) expect([c, skin(c, scheme).plaque]).toEqual([c, v3.civ[c][scheme]]);
    expect(skin("neutral", scheme).plaque).toBe(NEUTRAL_PLAQUE[scheme]);
    expect(themeFor("ATLANTEAN", scheme).plaque).toBe(NEUTRAL_PLAQUE[scheme]);
  });

  it("s2 is derived from the five: light 80% canvas + 20% line, dark surface and line half and half", () => {
    const mix = (a: string, b: string, w: number) =>
      `#${rgb(a).map((x, i) => Math.round(x * w + rgb(b)[i] * (1 - w)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    expect(S2.light).toBe(mix(v3.light.canvas, v3.light.line, 0.8));
    expect(S2.dark).toBe(mix(v3.dark.surface, v3.dark.line, 0.5));
  });

  it("v3Band is 90% the colour and 10% #111, as color-mix() draws it; it is every skin's band", () => {
    expect(v3Band("#FFFFFF")).toBe("#e7e7e7");
    expect(v3Band("#000000")).toBe("#020202");
    expect(v3Band(v3.civ.cn.light)).toBe("#823027");
    for (const key of KEYS) for (const scheme of SCHEMES) expect(skin(key, scheme).band).toBe(v3Band(skin(key, scheme).plaque));
  });

  it("the neg and warn hues are not any civilization's colour", () => {
    const colours = new Set(KEYS.flatMap((k) => SCHEMES.flatMap((s) => [skin(k, s).plaque, skin(k, s).band, skin(k, s).plaqueFill])));
    const status = SCHEMES.flatMap((s) => [semantic[s].neg, semantic[s].negStrong, semantic[s].warn]);
    expect(status.filter((c) => colours.has(c))).toEqual([]);
  });
});

describe("primary-button text (user decision 2026-10-01: dark 埃及 / 希腊 must reach AA)", () => {
  const cases = CIVS.flatMap((c) => SCHEMES.map((s) => [c, s] as const));

  it.each(cases)("%s / %s: white on the button's fill ≥ 4.5", (c, scheme) => {
    expect(contrast(ON_PLAQUE, skin(c, scheme).plaqueFill)).toBeGreaterThanOrEqual(4.5);
  });

  it("the fill is the colour itself in light and the band (10% #111) in dark — the colour values are not changed", () => {
    for (const c of CIVS) {
      expect(skin(c, "light").plaqueFill).toBe(v3.civ[c].light);
      expect(skin(c, "dark").plaqueFill).toBe(v3Band(v3.civ[c].dark));
      expect(skin(c, "dark").plaque).toBe(v3.civ[c].dark);
    }
  });

  it("why the mix: white on the raw dark 埃及 / 希腊 colour is under AA", () => {
    expect(contrast(ON_PLAQUE, v3.civ.eg.dark)).toBeLessThan(4.5);
    expect(contrast(ON_PLAQUE, v3.civ.gr.dark)).toBeLessThan(4.5);
  });
});

/**
 * Thresholds, each at the WORST ground of the scheme (s0 / s1 / s2): text 4.5 (AA), the
 * plaque against s0 3 (a graphic: the tab rule, an emblem), the lamp 3 (a solid block).
 */
describe("contrast, at the worst App ground", () => {
  const grounds = (scheme: ColorScheme) => KEYS.flatMap((k) => [skin(k, scheme).s0, skin(k, scheme).s1, skin(k, scheme).s2]);
  const worst = (fg: string, scheme: ColorScheme) => Math.min(...grounds(scheme).map((g) => contrast(fg, g)));

  it.each(SCHEMES)("%s: pos, neg, warn, ink, ink2, ink3 ≥ 4.5 and lamp ≥ 3 on every ground", (scheme) => {
    const s = semantic[scheme];
    const t = skin("neutral", scheme);
    const low = [
      ["pos", worst(s.pos, scheme), 4.5],
      ["neg", worst(s.neg, scheme), 4.5],
      ["warn", worst(s.warn, scheme), 4.5],
      ["ink", worst(t.ink, scheme), 4.5],
      ["inkMuted", worst(t.inkMuted, scheme), 4.5],
      ["inkSubtle", worst(t.inkSubtle, scheme), 4.5],
      ["lamp", worst(s.lamp, scheme), 3],
    ].filter(([, ratio, min]) => (ratio as number) < (min as number));
    expect(low).toEqual([]);
  });

  it.each(SCHEMES)("%s: white on negStrong, negInk on negBg, warn on warnBg ≥ 4.5", (scheme) => {
    const s = semantic[scheme];
    expect(contrast("#FFFFFF", s.negStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.negInk, s.negBg)).toBeGreaterThanOrEqual(4.5);
    // 补足 D 组: text on the warning ground is warn itself.
    expect(contrast(s.warn, s.warnBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(KEYS.flatMap((k) => SCHEMES.map((s) => [k, s] as const)))("%s / %s: onPlaque on the band and on the fill ≥ 4.5; the colour on s0 ≥ 3", (key, scheme) => {
    const t = skin(key, scheme);
    expect(contrast(t.onPlaque, t.band)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.onPlaque, t.plaqueFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.plaque, t.s0)).toBeGreaterThanOrEqual(3);
  });

  it("why the current tab's label stays ink: as text every dark v3 colour fails AA on the dark surface", () => {
    for (const c of CIVS) expect(contrast(v3.civ[c].dark, v3.dark.surface)).toBeLessThan(4.5);
    // …while as a graphic (the emblem, the 2pt rule) each clears 3:1.
    for (const c of CIVS) expect(contrast(v3.civ[c].dark, v3.dark.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("themeFor", () => {
  it("skins by the soul's civilization: its colour, nothing else", () => {
    expect(themeFor("EGYPTIAN", "light").plaque).toBe(v3.civ.eg.light);
    expect(themeFor("GREEK", "dark").civ).toBe("gr");
    expect(new Set(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((c) => themeFor(c, "dark").plaque)).size).toBe(4);
    expect(new Set(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK", null].map((c) => themeFor(c, "dark").s1)).size).toBe(1);
  });

  it("before sign-in and for an unknown civilization: neutral", () => {
    expect(themeFor(null, "light").civ).toBe("neutral");
    const unknown = themeFor("ATLANTEAN", "dark");
    expect([unknown.civ, unknown.plaque]).toEqual(["neutral", NEUTRAL_PLAQUE.dark]);
  });

  it("the grounds: dark steps canvas → surface → s2 up; light has the surface brightest and s2 below the canvas", () => {
    const l = (hex: string) => rgb(hex).reduce((a, b) => a + b, 0);
    const [d, li] = [themeFor(null, "dark"), themeFor(null, "light")];
    expect(l(d.s0) < l(d.s1) && l(d.s1) < l(d.s2)).toBe(true);
    expect(l(li.s1) > l(li.s0) && l(li.s0) > l(li.s2)).toBe(true);
  });
});

describe("preLoginTheme: v3 has no pre-sign-in canvas (the parchment left 2026-10-02)", () => {
  it.each(SCHEMES)("%s: is the neutral skin — v3's neutrals, the neutral plaque — slot for slot", (scheme) => {
    expect(preLoginTheme(scheme)).toEqual(themeFor(null, scheme));
    const t = preLoginTheme(scheme);
    expect([t.s0, t.s1, t.ink, t.inkMuted, t.hair, t.plaque]).toEqual([v3[scheme].canvas, v3[scheme].surface, v3[scheme].ink, v3[scheme].muted, v3[scheme].line, NEUTRAL_PLAQUE[scheme]]);
    // v2's parchment grounds reach no slot.
    const parchment = new Set(["#f4efe4", "#ebe4d3", "#15130f", "#1f1c16"]);
    expect((Object.keys(t) as (keyof Theme)[]).filter((k) => parchment.has(t[k] as string))).toEqual([]);
  });
});

describe("sealedTheme (a past life)", () => {
  it("steps ink down one level, keeping the ground", () => {
    const t = themeFor("CHINESE", "dark");
    const sealed = sealedTheme(t);
    expect([sealed.ink, sealed.inkMuted]).toEqual([t.inkMuted, t.inkSubtle]);
    expect([sealed.s0, sealed.s1, sealed.hair]).toEqual([t.s0, t.s1, t.hair]);
  });
});

describe("oklchToHex", () => {
  it("hits the fixed points", () => {
    expect(oklchToHex("1 0 0")).toBe("#ffffff");
    expect(oklchToHex("0 0 0")).toBe("#000000");
    // CSS Color 4 reference: oklch(0.627955 0.257683 29.2339) is sRGB red.
    expect(oklchToHex("0.627955 0.257683 29.2339")).toBe("#ff0000");
  });
});
