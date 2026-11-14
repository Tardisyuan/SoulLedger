/**
 * The tokens against their sources.
 *
 * Since 2026-11-06 the colours are v4's (定稿 V4Batch07.dc.html; user decision: 一律按 v4),
 * printed as hex / rgba — so they are compared verbatim. The statuses v4 does not print are still
 * the ones 规范 v2 §二 printed; the lamp rows still come from the 灵魂簿 App OKLCH table and are
 * re-converted below.
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  NEUTRAL_CIV,
  NEUTRAL_PLAQUE,
  ON_PLAQUE,
  brand,
  oklchToHex,
  preLoginTheme,
  sealedTheme,
  semantic,
  themeFor,
  v4,
  type CivKey,
  type ColorScheme,
  type Theme,
} from "../theme";

/** [dark OKLCH, light OKLCH], exactly as the 灵魂簿 App handoff's table prints them. */
const DESIGN_OKLCH: { path: (s: ColorScheme) => string; triples: [string, string] }[] = [
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
    // The ink and ground rows (10) left with v3 (2026-10-01), pos with v4 (2026-11-06); lamp, lampBg remain.
    expect(DESIGN_OKLCH).toHaveLength(2);
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

describe("v4 is the palette (user decision 2026-11-06: 一律按 v4)", () => {
  const STATUS = {
    dark: "pos #8AD3A1 · posBg #16261C · neg #F2849B · negStrong #F2849B · onNeg #16171A · negBg #33101A · negInk #FFD3DC · warn #FF9A3C · warnBg #301904 · lamp #F2CC7A · lampBg #241B0C",
    light: "pos #1F6B3F · posBg #EAF6EE · neg #A81E3C · negStrong #A81E3C · onNeg #FFFFFF · negBg #FFECEF · negInk #8A0C33 · warn #9F4A00 · warnBg #FFF1E2 · lamp #6A3E00 · lampBg #FBF1DC",
  };
  const pairs = (line: string) => line.split(" · ").map((p) => p.split(" "));

  it("is the draft's .th-dark / .th-light and [data-civ] blocks, verbatim", () => {
    expect(v4.dark).toEqual({ main: "#111113", card: "#1A1B1E", card2: "#222327", ink: "#F3F3F1", sub: "#B4B6BA", faint: "#7C7F85", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.16)", field: "rgba(255,255,255,0.05)", onSolid: "#FFFFFF", pos: "#8AD3A1", neg: "#F2849B", onNeg: "#16171A" });
    expect(v4.light).toEqual({ main: "#F8F8F6", card: "#FFFFFF", card2: "#F1F1EE", ink: "#16171A", sub: "#54575C", faint: "#8A8D92", line: "rgba(0,0,0,0.08)", line2: "rgba(0,0,0,0.16)", field: "rgba(0,0,0,0.035)", onSolid: "#FFFFFF", pos: "#1F6B3F", neg: "#A81E3C", onNeg: "#FFFFFF" });
    const nine = (c: (typeof CIVS)[number]) => [v4.civ[c].glow, v4.civ[c].tD, v4.civ[c].tL, v4.civ[c].sL, v4.civ[c].sD, v4.civ[c].mD, v4.civ[c].mL, v4.civ[c].sideD, v4.civ[c].sideL].join(" ");
    expect(CIVS.map((c) => [c, nine(c)])).toEqual([
      ["cn", "#C8604F #D98A7A #A04636 #A64A3B #7E362B #C9A35E #8A6A24 #231512 #FFE4DF"],
      ["eu", "#A0709F #A883AE #885A94 #7A4F85 #5A3A63 #B9C2CF #5C6878 #1E1620 #F5E5F8"],
      ["eg", "#5F93C8 #89BCF1 #174A88 #3C69A2 #2B4E79 #D6B25E #86671E #111A24 #DDEDFF"],
      ["gr", "#5F9C94 #8BDDCA #066A5B #37716A #28544F #C98B62 #8F5B36 #0C1D19 #D7F2EB"],
    ]);
    expect(ON_PLAQUE).toBe(v4.dark.onSolid);
    expect(ON_PLAQUE).toBe(v4.light.onSolid);
  });

  it("the neutral plaque is the web's neutral text colour --color-civ-neutral-ink, read from globals.css (dark :root, light .light)", () => {
    const css = readFileSync(join(__dirname, "../../../frontend/app/globals.css"), "utf8");
    // The theme's block, not the brand-token `:root` beside it (Design batch 3: outside the themes).
    const block = (selector: string) =>
      css.split(`${selector} {`).slice(1).map((b) => b.split(/\n {2}\}/)[0]).find((b) => b.includes("--color-civ-neutral-ink")) ?? "";
    // The web writes it as hex or as an OKLCH triple; either is read as hex.
    const neutral = (selector: string) => {
      const v = block(selector).match(/--color-civ-neutral-ink:\s*([^;]+);/)?.[1].trim() ?? "";
      return v.startsWith("#") ? v.toLowerCase() : oklchToHex(v.replace(/^oklch\(|\)$/g, ""));
    };
    // …and the web's neutral main IS that token (no data-civ = neutral).
    expect(block(":root")).toMatch(/--color-main: var\(--color-civ-neutral\);/);
    expect({ light: neutral(".light"), dark: neutral(":root") }).toEqual({
      light: NEUTRAL_PLAQUE.light.toLowerCase(),
      dark: NEUTRAL_PLAQUE.dark.toLowerCase(),
    });
    // Android's notification tint (app.json) is the same neutral, light.
    const app = require("../../app.json") as { expo: { plugins: unknown[] } };
    const notifications = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-notifications") as [string, { color: string }];
    expect(notifications[1].color.toLowerCase()).toBe(NEUTRAL_PLAQUE.light.toLowerCase());
    // v3's neutral (#262925 / #656962) and v2's warm black / warm grey are gone.
    expect(Object.values(NEUTRAL_PLAQUE)).not.toEqual(expect.arrayContaining(["#262925", "#656962", "#2B2724", "#6E665E"]));
  });

  it.each(SCHEMES)("%s: the status colours — v4's pos / neg / onNeg, the rest as 规范 v2 §二 printed them", (scheme) => {
    const printed = Object.fromEntries(pairs(STATUS[scheme]));
    const { scrim: _scrim, ...ours } = semantic[scheme];
    expect(ours).toEqual(printed);
  });

  it.each(SCHEMES)("%s: every skin, every screen, on the same neutrals — no per-civilization ground is left", (scheme) => {
    const n = v4[scheme];
    for (const key of KEYS) {
      const t = skin(key, scheme);
      expect([key, t.s0, t.s1, t.s2, t.hair, t.hair2, t.ink, t.inkMuted, t.inkSubtle, t.faint, t.field]).toEqual([key, n.main, n.card, n.card2, n.line, n.line2, n.ink, n.sub, n.sub, n.faint, n.field]);
    }
  });

  it.each(SCHEMES)("%s: each civilization's slots are its own v4 values; an unknown one borrows no one's", (scheme) => {
    const d = scheme === "dark";
    for (const c of CIVS) {
      const v = v4.civ[c];
      const t = skin(c, scheme);
      expect([c, t.plaque, t.band, t.plaqueFill, t.metal, t.side, t.glow]).toEqual([c, d ? v.tD : v.tL, d ? v.sD : v.sL, d ? v.sD : v.sL, d ? v.mD : v.mL, d ? v.sideD : v.sideL, v.glow]);
    }
    expect(skin("neutral", scheme).plaque).toBe(NEUTRAL_PLAQUE[scheme]);
    expect(skin("neutral", scheme).plaqueFill).toBe(d ? NEUTRAL_CIV.sD : NEUTRAL_CIV.sL);
    expect(themeFor("ATLANTEAN", scheme).plaque).toBe(NEUTRAL_PLAQUE[scheme]);
    const civColours = new Set<string>(CIVS.flatMap((c) => Object.values(v4.civ[c])));
    expect([skin("neutral", scheme).plaque, skin("neutral", scheme).plaqueFill].filter((x) => civColours.has(x))).toEqual([]);
    // The metal is the brand gold (Design 第八批第 5 条), not a civilization's: dark is the mark's own gold. Light
    // #8A6A24 happens to equal 地府's light metal — Design gave it as the brand gold's light value, so it is not
    // held to "no civilization colour" here.
    expect(NEUTRAL_CIV.mD).toBe(brand.mark);
  });

  it("the neutral is Design 第八批第 5 条's (solid, glow, metal, side), and the web's --color-civ-neutral* say the same", () => {
    expect(NEUTRAL_CIV).toEqual({ glow: "#8E939C", tD: "#B4B6BA", tL: "#54575C", sL: "#5A606B", sD: "#55575E", mD: "#ECAA3D", mL: "#8A6A24", sideD: "#0E0F11", sideL: "#F1F1EF" });
    // Absence: the old derived neutral (#16171A solid = the body ink; #38393E) is gone.
    expect(Object.values(NEUTRAL_CIV)).not.toEqual(expect.arrayContaining(["#16171A", "#38393E"]));
  });

  it("the neg and warn hues are not any civilization's colour", () => {
    const colours = new Set(KEYS.flatMap((k) => SCHEMES.flatMap((s) => [skin(k, s).plaque, skin(k, s).band, skin(k, s).plaqueFill, skin(k, s).metal])));
    const status = SCHEMES.flatMap((s) => [semantic[s].neg, semantic[s].negStrong, semantic[s].warn]);
    expect(status.filter((c) => colours.has(c))).toEqual([]);
  });

  it("v3's palette reaches no slot", () => {
    const v3 = ["#EFEFEB", "#FBFBF8", "#181A17", "#646861", "#D1D3CD", "#10120F", "#1A1D19", "#F0F1EA", "#A7ACA4", "#383C35", "#8F3329", "#AD4B40", "#583875", "#80609A", "#294A8A", "#5F7FBE", "#285051", "#5A8480", "#82CB92", "#FF7A93", "#C21D4D", "#197037", "#A8103E"];
    for (const key of KEYS) for (const scheme of SCHEMES) {
      const t = skin(key, scheme) as unknown as Record<string, unknown>;
      expect([key, scheme, Object.keys(t).filter((k) => v3.includes(String(t[k]).toUpperCase()))]).toEqual([key, scheme, []]);
    }
  });
});

describe("filled text (user decision 2026-11-06: 深浅色做到一样好)", () => {
  const cases = KEYS.flatMap((k) => SCHEMES.map((s) => [k, s] as const));

  it.each(cases)("%s / %s: white on the button's fill and on the band ≥ 4.5", (key, scheme) => {
    expect(contrast(ON_PLAQUE, skin(key, scheme).plaqueFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ON_PLAQUE, skin(key, scheme).band)).toBeGreaterThanOrEqual(4.5);
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
      ["faintText", worst(t.faintText, scheme), 4.5],
      ["lamp", worst(s.lamp, scheme), 3],
    ].filter(([, ratio, min]) => (ratio as number) < (min as number));
    expect(low).toEqual([]);
  });

  it.each(SCHEMES)("%s: onNeg on negStrong, negInk and neg on negBg, warn on warnBg ≥ 4.5", (scheme) => {
    const s = semantic[scheme];
    expect(contrast(s.onNeg, s.negStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.neg, s.negBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.negInk, s.negBg)).toBeGreaterThanOrEqual(4.5);
    // 补足 D 组: text on the warning ground is warn itself.
    expect(contrast(s.warn, s.warnBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(KEYS.flatMap((k) => SCHEMES.map((s) => [k, s] as const)))("%s / %s: the civilization's colour is text now (v4 --civT): ≥ 4.5 on every ground; its metal ≥ 3", (key, scheme) => {
    const t = skin(key, scheme);
    expect(worst(t.plaque, scheme)).toBeGreaterThanOrEqual(4.5);
    expect(worst(t.metal, scheme)).toBeGreaterThanOrEqual(3);
  });

  it("why inkSubtle is not v4's --faint: under AA on every light ground (under 3:1 on card2), and in dark on the raised grounds", () => {
    // Measured (r24, 2026-11-06): light 3.13 on --main, 3.33 on --card, 2.94 on --card2; dark 4.70 on --main
    // (passes there), 4.29 on --card, 3.91 on --card2. Third-ink text sits on cards and sheets in both schemes,
    // so --faint fails somewhere in each: inkSubtle stays --sub.
    expect(contrast(v4.light.faint, v4.light.main)).toBeLessThan(4.5);
    expect(contrast(v4.light.faint, v4.light.card2)).toBeLessThan(3);
    expect(contrast(v4.dark.faint, v4.dark.main)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v4.dark.faint, v4.dark.card)).toBeLessThan(4.5);
    expect(contrast(v4.dark.faint, v4.dark.card2)).toBeLessThan(4.5);
    for (const s of SCHEMES) expect(skin("cn", s).inkSubtle).toBe(v4[s].sub);
  });
});

describe("brand (v3 第三批 品牌色令牌): the mark's gold and ground, one value for icon and cold start", () => {
  const src = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
  it("the icon script prints the same two colours", () => {
    // The script reads `--brand-mark` / `--brand-ground` from the web tokens; those must equal these.
    const script = src("../../scripts/build-app-icon.mjs");
    expect(script).toMatch(/export const GOLD = brandToken\("--brand-mark"\)/);
    expect(script).toMatch(/export const INK = brandToken\("--brand-ground"\)/);
    const css = src("../../../frontend/app/globals.css");
    expect(css.match(/--brand-mark:\s*(#[0-9A-F]{6});/i)?.[1]).toBe(brand.mark);
    expect(css.match(/--brand-ground:\s*(#[0-9A-F]{6});/i)?.[1]).toBe(brand.ground);
  });
  it("the cold start takes them from here rather than its own literals", () => {
    const cold = src("../coldStart.tsx");
    expect(cold).toMatch(/const GROUND = brand\.ground;/);
    expect(cold).toMatch(/const GOLD = brand\.mark;/);
    expect(cold).not.toMatch(/#ECAA3D|#10120F/i);
  });
  it("is not a UI colour: no theme carries either value — except the neutral's dark metal, which Design batch 8 made the brand gold", () => {
    for (const civ of [null, "CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"])
      for (const s of ["light", "dark"] as const) {
        const t = themeFor(civ, s) as unknown as Record<string, unknown>;
        const carried = Object.entries(t).filter(([k]) => !(civ === null && s === "dark" && k === "metal")).map(([, v]) => v);
        expect(carried).not.toContain(brand.mark);
      }
    expect(themeFor(null, "dark").metal).toBe(brand.mark);
  });
});

describe("themeFor", () => {
  it("skins by the soul's civilization: its colour, nothing else", () => {
    expect(themeFor("EGYPTIAN", "light").plaque).toBe(v4.civ.eg.tL);
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

describe("preLoginTheme: there is no pre-sign-in canvas since v3 (the parchment left 2026-10-02)", () => {
  it.each(SCHEMES)("%s: is the neutral skin — v4's neutrals, the neutral plaque — slot for slot", (scheme) => {
    expect(preLoginTheme(scheme)).toEqual(themeFor(null, scheme));
    const t = preLoginTheme(scheme);
    expect([t.s0, t.s1, t.ink, t.inkMuted, t.hair, t.plaque]).toEqual([v4[scheme].main, v4[scheme].card, v4[scheme].ink, v4[scheme].sub, v4[scheme].line, NEUTRAL_PLAQUE[scheme]]);
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

// opt-apps2 R1: a new object per call changed ThemeContext's value on every render of the root.
describe("one theme object per (civilization, scheme)", () => {
  it("the same call answers the same object; another civilization or scheme answers another", () => {
    expect(themeFor("CHINESE", "dark")).toBe(themeFor("CHINESE", "dark"));
    expect(themeFor("CHINESE", "dark")).not.toBe(themeFor("CHINESE", "light"));
    expect(themeFor("CHINESE", "dark")).not.toBe(themeFor("EGYPTIAN", "dark"));
    // Unknown and none are both the neutral skin: one object.
    expect(themeFor("ATLANTEAN", "light")).toBe(themeFor(null, "light"));
    expect(preLoginTheme("light")).toBe(themeFor(undefined, "light"));
  });

  it("the shared object cannot be changed by one screen for all the others", () => {
    expect(Object.isFrozen(themeFor("GREEK", "dark"))).toBe(true);
    expect(sealedTheme(themeFor("GREEK", "dark"))).not.toBe(themeFor("GREEK", "dark"));
  });
});
