/**
 * The tokens against the design handoff they were copied from.
 *
 * This test used to re-read `frontend/app/globals.css`. The soul app now follows
 * the Claude Design handoff "灵魂簿 App" instead (its tokens differ from the
 * web's in hairlines, canvas and the semantic inks), and the handoff is not in
 * the repository — so its OKLCH table (section 1h-一, the stated source of
 * truth: "OKLCH 为准，hex 为 sRGB 换算值") is transcribed below and every hex in
 * `theme.ts` must be its conversion within rounding. A mistyped hex, or one
 * copied into the wrong civilization, is red here.
 */
import {
  ON_PLAQUE,
  civ,
  ink,
  oklchToHex,
  parchment,
  preLoginTheme,
  sealedTheme,
  semantic,
  themeFor,
  type CivKey,
  type ColorScheme,
  type Theme,
} from "../theme";

/** [dark OKLCH, light OKLCH], exactly as the handoff's table prints them. */
const DESIGN_OKLCH: { path: (s: ColorScheme) => string; triples: [string, string] }[] = [
  { path: (s) => ink[s].ink, triples: ["0.970 0.002 248", "0.209 0.010 268"] },
  { path: (s) => ink[s].inkMuted, triples: ["0.839 0.015 255", "0.452 0.021 264"] },
  { path: (s) => ink[s].inkSubtle, triples: ["0.651 0.017 257", "0.517 0.020 268"] },
  { path: (s) => civ.neutral[s].s1, triples: ["0.175 0.008 286", "0.983 0.003 286"] },
  { path: (s) => civ.neutral[s].s2, triples: ["0.194 0.012 285", "0.965 0.004 286"] },
  { path: (s) => civ.neutral[s].accent, triples: ["0.651 0.017 257", "0.529 0.018 257"] },
  { path: (s) => civ.cn[s].s1, triples: ["0.176 0.024 38", "0.983 0.010 58"] },
  { path: (s) => civ.cn[s].s2, triples: ["0.199 0.023 38", "0.965 0.019 62"] },
  { path: (s) => civ.cn[s].accent, triples: ["0.713 0.098 35", "0.462 0.100 46"] },
  { path: (s) => civ.cn[s].mark, triples: ["0.650 0.124 35", "0.509 0.112 45"] },
  { path: (s) => civ.eu[s].s1, triples: ["0.159 0.030 273", "0.975 0.012 281"] },
  { path: (s) => civ.eu[s].accent, triples: ["0.713 0.079 278", "0.452 0.142 273"] },
  { path: (s) => civ.eu[s].mark, triples: ["0.643 0.101 277", "0.452 0.142 273"] },
  { path: (s) => civ.eg[s].s1, triples: ["0.201 0.024 93", "0.991 0.010 87"] },
  { path: (s) => civ.eg[s].accent, triples: ["0.733 0.099 90", "0.461 0.075 89"] },
  { path: (s) => civ.eg[s].mark, triples: ["0.728 0.100 89", "0.541 0.089 89"] },
  { path: (s) => civ.gr[s].s1, triples: ["0.204 0.034 130", "0.994 0.014 129"] },
  { path: (s) => civ.gr[s].accent, triples: ["0.722 0.138 130", "0.443 0.091 130"] },
  { path: (s) => civ.gr[s].mark, triples: ["0.722 0.138 130", "0.526 0.111 131"] },
  { path: (s) => semantic[s].pos, triples: ["0.780 0.110 150", "0.480 0.120 150"] },
  // neg / negStrong / negInk / negBg left this table in v2: 规范 v2 §二 gives them as hex (below).
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

describe("tokens are the design's OKLCH table, converted", () => {
  it.each(SCHEMES)("%s", (scheme) => {
    const off = DESIGN_OKLCH.map(({ path, triples }) => {
      const triple = triples[scheme === "dark" ? 0 : 1];
      return { triple, token: path(scheme), converted: oklchToHex(triple) };
    }).filter(({ token, converted }) => !near(token, converted));
    expect(off).toEqual([]);
  });

  it("the transcription covers every row of the table (a short list checks nothing)", () => {
    expect(DESIGN_OKLCH).toHaveLength(22); // 20 from 灵魂簿 App 1h (its 4 neg rows replaced by v2), 2 lamp rows from 朋友圈 1e
  });
});

/**
 * v2「朱印」, 规范 v2 定稿 (design-cache/v2/spec-final.dc.html, not in the repo):
 * §二 status colours, global — the page prints them as hex, so they are compared
 * as hex; §三 the plaque (匾色) per civilization; §一 onMain. Transcribed as printed.
 */
describe("v2 tokens are the spec's (规范 v2 §一–§三)", () => {
  const STATUS = {
    dark: "pos #82CB92 · neg #FF7A93 · negStrong #C21D4D · negBg #33101A · negInk #FFD3DC · warn #FF9A3C · lamp #F2CC7A · lampBg #241B0C",
    light: "pos #197037 · neg #A8103E · negStrong #A8103E · negBg #FFECEF · negInk #8A0C33 · warn #A65000 · lamp #6A3E00 · lampBg #FBF1DC",
  };
  const PLAQUE = "neutral #2b2724 #6e665e · cn #9a2f1f #b3402c · eu #4a2a6a #7a52a6 · eg #1f3f8a #3e62b8 · gr #1f3b3e #3f7076";
  const APP_INK = { dark: ["#F4F5F6", "#C4CBD4", "#89909A"], light: ["#16181D", "#505662", "#636874"] };
  const APP_GROUNDS = {
    dark: "neutral #0B0B0E #101014 #14141A · cn #100704 #1A0D09 #1F120E · eu #040611 #090C1A #0E111F · eg #120F05 #1A1609 #1F1B0E · gr #0B1205 #121A09 #181F0E",
    light: "neutral #FDFDFF #F9F9FB #F3F3F6 · cn #FFFDFA #FFF8F3 #FDF1E7 · eu #FDFDFF #F5F6FF #ECEEFB · eg #FFFDF9 #FFFCF5 #FBF7EC · gr #FCFEFA #FAFFF5 #F4FBEC",
  };
  const pairs = (line: string) => line.split(" · ").map((p) => p.split(" "));

  it.each(SCHEMES)("%s: the eight status colours", (scheme) => {
    const printed = Object.fromEntries(pairs(STATUS[scheme]));
    const { scrim: _scrim, ...ours } = semantic[scheme];
    expect(ours).toEqual(printed);
  });

  it.each(SCHEMES)("%s: the plaque of each civilization, and one onPlaque for all", (scheme) => {
    for (const [key, light, dark] of pairs(PLAQUE)) {
      const t = themeFor({ neutral: null, cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" }[key as CivKey], scheme);
      expect([key, t.plaque.toLowerCase(), t.onPlaque]).toEqual([key, scheme === "light" ? light : dark, ON_PLAQUE]);
    }
    expect(ON_PLAQUE).toBe("#FFF4E8");
  });

  it.each(SCHEMES)("%s: App ink and the per-civilization grounds are kept as §一 lists them", (scheme) => {
    expect([ink[scheme].ink, ink[scheme].inkMuted, ink[scheme].inkSubtle]).toEqual(APP_INK[scheme]);
    for (const [key, s0, s1, s2] of pairs(APP_GROUNDS[scheme])) {
      const g = civ[key as CivKey][scheme];
      expect([key, g.s0, g.s1, g.s2]).toEqual([key, s0, s1, s2]);
    }
  });

  it("the neg and warn hues are not the plaque's: none of them equals any plaque", () => {
    const plaques = new Set(KEYS.flatMap((k) => SCHEMES.map((s) => civ[k][s].plaque)));
    const status = SCHEMES.flatMap((s) => [semantic[s].neg, semantic[s].negStrong, semantic[s].warn]);
    expect(status.filter((c) => plaques.has(c))).toEqual([]);
  });
});

/**
 * 规范 v2 §一/§二 thresholds, each taken at the WORST of the fifteen App grounds
 * of the scheme (five skins × s0/s1/s2): text 4.5 (AA), the plaque against s0 3
 * (a large fill), the lamp 3 (a solid block, "appLamp").
 */
describe("v2 contrast, at the worst App ground", () => {
  const grounds = (scheme: ColorScheme) => KEYS.flatMap((k) => [civ[k][scheme].s0, civ[k][scheme].s1, civ[k][scheme].s2]);
  const worst = (fg: string, scheme: ColorScheme) => Math.min(...grounds(scheme).map((g) => contrast(fg, g)));

  it.each(SCHEMES)("%s: pos, neg, warn ≥ 4.5 and lamp ≥ 3 on every ground", (scheme) => {
    const s = semantic[scheme];
    const low = [
      ["pos", worst(s.pos, scheme), 4.5],
      ["neg", worst(s.neg, scheme), 4.5],
      ["warn", worst(s.warn, scheme), 4.5],
      ["lamp", worst(s.lamp, scheme), 3],
    ].filter(([, ratio, min]) => (ratio as number) < (min as number));
    expect(low).toEqual([]);
  });

  it.each(SCHEMES)("%s: white on negStrong, negInk on negBg ≥ 4.5", (scheme) => {
    const s = semantic[scheme];
    expect(contrast("#FFFFFF", s.negStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.negInk, s.negBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(KEYS.flatMap((k) => SCHEMES.map((s) => [k, s] as const)))("%s / %s: onPlaque on the plaque ≥ 4.5; the plaque on s0 ≥ 3", (key, scheme) => {
    const g = civ[key][scheme];
    expect(contrast(ON_PLAQUE, g.plaque)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(g.plaque, g.s0)).toBeGreaterThanOrEqual(3);
  });

  it.each(KEYS.flatMap((k) => SCHEMES.map((s) => [k, s] as const)))("%s / %s: ink on s1, ink2 and ink3 on s2 ≥ 4.5 (§一's App columns)", (key, scheme) => {
    const g = civ[key][scheme];
    const i = ink[scheme];
    expect([contrast(i.ink, g.s1), contrast(i.inkMuted, g.s2), contrast(i.inkSubtle, g.s2)].every((r) => r >= 4.5)).toBe(true);
  });
});

describe("contrast holds in all ten skins (the handoff claims ≥ 4.6:1; WCAG AA is 4.5)", () => {
  const pairs: [keyof Theme, keyof Theme][] = [
    ["ink", "s0"],
    ["ink", "s2"],
    ["inkMuted", "s1"],
    ["inkSubtle", "s0"],
    ["inkSubtle", "s1"],
    ["accent", "s0"],
    ["accent", "s1"],
    ["onAccent", "accent"],
    ["neg", "s0"],
    ["pos", "s0"],
    ["negInk", "negBg"],
    ["lamp", "lampBg"],
    ["lamp", "s0"],
  ];
  const cases = KEYS.flatMap((key) =>
    SCHEMES.map((scheme) => [key, scheme] as const)
  );
  it.each(cases)("%s / %s", (key, scheme) => {
    const t = themeFor({ neutral: null, cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" }[key], scheme);
    expect(t.civ).toBe(key);
    const low = pairs
      .map(([fg, bg]) => ({ fg, bg, ratio: Math.round(contrast(t[fg] as string, t[bg] as string) * 100) / 100 }))
      .filter(({ ratio }) => ratio < 4.5);
    expect(low).toEqual([]);
  });
});

describe("themeFor", () => {
  it("skins by the soul's civilization", () => {
    expect(themeFor("CHINESE", "dark").s1).toBe(civ.cn.dark.s1);
    expect(themeFor("EGYPTIAN", "light").accent).toBe(civ.eg.light.accent);
    expect(themeFor("GREEK", "dark").civ).toBe("gr");
    expect(themeFor("EUROPEAN", "dark").mark).toBe(civ.eu.dark.mark);
  });

  it("four different grounds, none of them the neutral one", () => {
    const grounds = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((c) => themeFor(c, "dark").s1);
    expect(new Set(grounds).size).toBe(4);
    expect(grounds).not.toContain(themeFor(null, "dark").s1);
  });

  it("before sign-in and for an unknown civilization: neutral, not another civilization's", () => {
    expect(themeFor(null, "light").civ).toBe("neutral");
    const unknown = themeFor("ATLANTEAN", "dark");
    expect(unknown.civ).toBe("neutral");
    expect(unknown.s0).toBe(civ.neutral.dark.s0);
    expect(unknown.mark).toBe(civ.neutral.dark.mark);
  });

  it("the ground steps s0 → s1 → s2 in the direction of the scheme", () => {
    const l = (hex: string) => rgb(hex).reduce((a, b) => a + b, 0);
    for (const key of KEYS) {
      const [d, li] = [civ[key].dark, civ[key].light];
      expect([key, l(d.s0) < l(d.s1) && l(d.s1) < l(d.s2)]).toEqual([key, true]);
      expect([key, l(li.s0) >= l(li.s1) && l(li.s1) > l(li.s2)]).toEqual([key, true]);
    }
  });
});

describe("preLoginTheme (第三类 F 组 canvas, parchment)", () => {
  /** The canvas's "App 调色板", as printed — except light ink3, darkened for AA (was #77705f). */
  const CANVAS = {
    light: "bg #f4efe4 · bg2 #ebe4d3 · ink #1e1a14 · ink2 #5a5145 · ink3 #6d6655 · line #cfc6b4 · line2 #8f8672 · acc #a8281e · merit #2f6b3a · demerit #a8281e · warnBg #efe0bf",
    dark: "bg #15130f · bg2 #1f1c16 · ink #ede5d3 · ink2 #b8ad98 · ink3 #8f8572 · line #332e26 · line2 #6a6252 · acc #d8503f · merit #7fc48a · demerit #e0685a · warnBg #2a2213",
  };
  const parse = (line: string) => Object.fromEntries(line.split(" · ").map((pair) => pair.split(" ")));

  it.each(SCHEMES)("%s: the tokens are the canvas's, all eleven", (scheme) => {
    expect(parchment[scheme]).toEqual(parse(CANVAS[scheme]));
  });

  it.each(SCHEMES)("%s: parchment grounds and ink; the neutral plaque; the global status colours (v2 §二), not the canvas's red", (scheme) => {
    const p = parchment[scheme];
    const t = preLoginTheme(scheme);
    expect([t.s0, t.accent, t.onAccent, t.mark]).toEqual([p.bg, p.ink, p.bg, p.ink]);
    expect([t.ink, t.inkMuted, t.inkSubtle, t.hair, t.hair2, t.s2]).toEqual([p.ink, p.ink2, p.ink3, p.line, p.line2, p.bg2]);
    expect([t.plaque, t.onPlaque]).toEqual([civ.neutral[scheme].plaque, ON_PLAQUE]);
    const { pos, neg, negStrong, negInk, negBg, warn, lamp, lampBg, scrim } = t;
    expect({ pos, neg, negStrong, negInk, negBg, warn, lamp, lampBg, scrim }).toEqual(semantic[scheme]);
    // …and the canvas's own red / merit / warnBg reach no slot at all.
    const canvasOnly = new Set<string>([p.acc, p.demerit, p.merit, p.warnBg]);
    expect((Object.keys(t) as (keyof Theme)[]).filter((k) => canvasOnly.has(t[k] as string))).toEqual([]);
  });

  it.each(SCHEMES)("%s: every text token reaches AA on both grounds", (scheme) => {
    const t = preLoginTheme(scheme);
    // Every slot drawn as text, on bg (s0) and bg2 (s2). negStrong is borders only.
    // Unrounded: light ink3 sits at 4.5004 on bg2, and rounding would hide a 4.495.
    const text: (keyof Theme)[] = ["ink", "inkMuted", "inkSubtle", "neg", "pos"];
    const pairs: [keyof Theme, keyof Theme][] = [
      ...text.flatMap((fg) => [[fg, "s0"], [fg, "s2"]] as [keyof Theme, keyof Theme][]),
      ["onAccent", "accent"],
      ["negInk", "negBg"],
    ];
    const low = pairs
      .map(([fg, bg]) => ({ fg, bg, ratio: contrast(t[fg] as string, t[bg] as string) }))
      .filter(({ ratio }) => ratio < 4.5);
    // The canvas printed light ink3 as #77705f (4.29:1 on bg, 3.88 on bg2). The product
    // owner had it darkened, same OKLCH hue (88°), to the nearest value clearing 4.5 on both.
    expect(low).toEqual([]);
  });

  it("is not any civilization's ground — a signed-in soul never gets it", () => {
    for (const scheme of SCHEMES) {
      const grounds = KEYS.map((key) => civ[key][scheme].s0);
      expect(grounds).not.toContain(preLoginTheme(scheme).s0);
      expect(themeFor(null, scheme).s0).toBe(civ.neutral[scheme].s0);
    }
  });
});

describe("sealedTheme (a past life)", () => {
  it("steps ink down one level and turns accent subtle, keeping the ground", () => {
    const t = themeFor("CHINESE", "dark");
    const sealed = sealedTheme(t);
    expect([sealed.ink, sealed.inkMuted, sealed.accent]).toEqual([t.inkMuted, t.inkSubtle, t.inkSubtle]);
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
