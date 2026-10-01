/**
 * The soul app's tokens.
 *
 * Colours are v3's (round-7 prototype; user decision 2026-10-01: v3 fully replaces v2):
 * ONE set of neutrals for every civilization — canvas, surface, ink, muted, line — and
 * each civilization owns one colour (`plaque`). The status colours (`semantic`) and the
 * pre-sign-in parchment are not v3's and stay as they were.
 *
 * Until 2026-10-01 the App had per-civilization grounds and hairlines (灵魂簿 App 1h-一,
 * v2 规范 §一) and a warm onPlaque #FFF4E8; v3 drops both — a page no longer says its
 * civilization by its ground, only by the plaque, the current tab, the seal and the
 * primary button.
 */
import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

export type ColorScheme = "dark" | "light";
export type CivKey = "neutral" | "cn" | "eu" | "eg" | "gr";

/**
 * v3, verbatim. `civ` is the civilization's one colour; it goes to the plaque (the
 * identity band and every title bar), the current tab, the seal and the primary button,
 * and never to an error or a refusal (those are `neg`).
 */
export const v3 = {
  light: { canvas: "#EFEFEB", surface: "#FBFBF8", ink: "#181A17", muted: "#646861", line: "#D1D3CD" },
  dark: { canvas: "#10120F", surface: "#1A1D19", ink: "#F0F1EA", muted: "#A7ACA4", line: "#383C35" },
  civ: {
    cn: { light: "#8F3329", dark: "#AD4B40" },
    eu: { light: "#583875", dark: "#80609A" },
    eg: { light: "#294A8A", dark: "#5F7FBE" },
    gr: { light: "#285051", dark: "#5A8480" },
  },
} as const;

/**
 * v3 has no colour for a soul whose civilization the app does not know (or before
 * sign-in): it keeps v2's neutral plaque, warm black / warm grey, rather than borrowing
 * another civilization's.
 */
export const NEUTRAL_PLAQUE = { light: "#2B2724", dark: "#6E665E" } as const;

/** v3 writes plain white on its civilization colours (#FFF4E8 was 4.30:1 on dark 埃及's band). */
export const ON_PLAQUE = "#FFFFFF";

/**
 * `s2`, the pressed / disabled / skeleton step, which v3 does not print: one step from
 * both grounds toward the line — light: 80% canvas + 20% line (muted on it 4.67:1);
 * dark: surface and line half and half (muted on it 6.06:1). Derived, so they move with
 * the five values above if those move.
 */
export const S2 = { light: "#E9E9E5", dark: "#292D27" } as const;

/** 90% the colour and 10% #111, as v3's `color-mix(accent 90%, #111)` draws the identity band. */
export function v3Band(plaque: string): string {
  const n = parseInt(plaque.slice(1), 16);
  return `#${[16, 8, 0].map((s) => Math.round(((n >> s) & 255) * 0.9 + 0x11 * 0.1).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * `lamp` / `lampBg`: the eternal light's warm gold (朋友圈 handoff 1e), used by that
 * one reaction and nowhere else in the app. The handoff draws dark only
 * (oklch 0.860 0.110 85 on 0.230 0.030 80). Light lamp #6A3E00 on #FBF1DC is
 * Design's (文明气质 1i, confirmed 2026-09-27; 8.13:1). v1's Egyptian ochre accent,
 * which the lamp could not part from in gamut, is gone (第三阶段: 埃及's colour is its
 * lapis plaque); the lamp is still told apart by form too — the one pill, 2px, in its gold.
 *
 * v2 (规范 v2 定稿 §二, global — not per civilization): `neg` is 冷玫红 and every
 * neg* slot moved with it (strong = the solid danger fill under white text, bg /
 * negInk = a notice's ground and the text on it); `warn` is new, 橙, the same value
 * as the web. `pos`, `lamp` and `lampBg` are unchanged. neg is always drawn with ✕
 * and words, never by colour alone: its hue is close to 地府's plaque.
 */
export const semantic = {
  dark: { pos: "#82CB92", neg: "#FF7A93", negStrong: "#C21D4D", negInk: "#FFD3DC", negBg: "#33101A", warn: "#FF9A3C", warnBg: "#301904", lamp: "#F2CC7A", lampBg: "#241B0C", scrim: "rgba(0,0,0,0.62)" },
  light: { pos: "#197037", neg: "#A8103E", negStrong: "#A8103E", negInk: "#8A0C33", negBg: "#FFECEF", warn: "#9F4A00", warnBg: "#FFF1E2", lamp: "#6A3E00", lampBg: "#FBF1DC", scrim: "rgba(21,19,18,0.42)" },
} as const;
// `warnBg` (补足 D 组 警示底): the ground of a warning box; the text on it is `warn` itself.
// `scrim` rides along here because it is global too (补足 A2 阴影与遮罩): one use —
// under a dialog or a sheet — and one value per scheme, 0.42 light / 0.62 dark.

/**
 * pt. v2 补足 A2: multiples of 4. The v1 steps merged to the nearest — 7→8,
 * 10→12, 14→16, 26→24, 34→32 — so `space[0..4]` keep their index. 20 is not a
 * step but stays the screen gutter (A2: "20 不变"; `layoutFor` narrows it to 16).
 */
export const space = [2, 4, 8, 12, 16, 24, 32, 48] as const;
export const GUTTER_PT = 20;
/**
 * A2: corners are 0. The exceptions are the pill (the lamp, a drawer handle) and
 * the circle (a radio, an avatar) — both drawn with `pill`. The focus ring follows
 * the element's shape, so it is square too.
 */
export const radius = { none: 0, pill: 999 } as const;
/**
 * ms; reduce-motion sets every one to 0 (holds excepted, `useReducedMotionDurations`).
 * Opacity and translate only — the one scale is the seal's press (交互与动效 第 2 轮 §一
 * 「属性」: 「压实」允许缩放 60ms,减少动态效果时不缩放).
 *
 *   stampDrop / stampPress   a seal falls in (ease.drop), then presses 1.04 → 0.98 → 1
 *   stampBloom               from the press on, the edge scan soaks in: opacity 0 → 0.95 → 0.8
 *                            (补足 C18 印泥 120–320; 第 2 轮 §一 晕开)
 *   coldStart*               补足 C18: JS takes over from the native splash; the home is
 *                            usable from 480 and the splash layer is gone at 720
 *   sheetIn / sheetOut       a bottom sheet opens (dur.base) / closes (dur.fast; 第 2 轮 原型 06)
 *   sectionIn / sectionOut   a section's body appears (base, 4px down) / goes (fast) — 第 2 轮 4b
 */
export const motion = {
  fade: 120,
  toast: 160,
  toastHold: 1900,
  breath: 1600,
  welcomeIn: 600,
  welcomeHold: 1200,
  welcomeOut: 240,
  stampDrop: 120,
  stampPress: 60,
  stampBloom: 200,
  coldStartInteractive: 480,
  coldStart: 720,
  sheetIn: 200,
  sheetOut: 120,
  sectionIn: 200,
  sectionOut: 120,
  // v3 MotionSpec, App rows (round 7): a tab's content cross-fades; a ledger row's body
  // grows (height and opacity); 问一问's drawer rises; the life band compacts.
  tabFade: 180,
  sectionGrow: 220,
  drawerIn: 280,
  drawerOut: 200,
  bandCompact: 200,
  offlineBar: 200,
} as const;

export interface Theme {
  scheme: ColorScheme;
  civ: CivKey;
  s0: string;
  s1: string;
  s2: string;
  hair: string;
  hair2: string;
  /** The civilization's colour (see `v3`): rules, emblems, the seal, a mark. Never under text. */
  plaque: string;
  /**
   * The plaque under text — the title bars and the identity band: `v3Band(plaque)`, as v3
   * draws the band, in both schemes.
   */
  band: string;
  /**
   * A filled control's ground (the primary button, send, follow …): the plaque in light;
   * in dark the band, because white on dark 埃及 / 希腊 is 3.99 / 4.16:1 and on their band
   * 4.66 / 4.82 (user decision 2026-10-01). The colour values themselves are unchanged.
   */
  plaqueFill: string;
  onPlaque: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  pos: string;
  neg: string;
  negStrong: string;
  negInk: string;
  negBg: string;
  warn: string;
  warnBg: string;
  scrim: string;
  lamp: string;
  lampBg: string;
}

export function civKeyOf(civilization: string | null | undefined): CivKey {
  const code = civilization ? CIVILIZATION_SHORT_CODES[civilization] : undefined;
  return code === "cn" || code === "eu" || code === "eg" || code === "gr" ? code : "neutral";
}

/**
 * A soul's theme. Before sign-in the caller passes `null` and gets the neutral
 * ground; an unknown civilization also gets neutral rather than borrowing
 * another civilization's colours.
 */
export function themeFor(civilization: string | null | undefined, scheme: ColorScheme): Theme {
  const key = civKeyOf(civilization);
  const n = v3[scheme];
  const plaque = key === "neutral" ? NEUTRAL_PLAQUE[scheme] : v3.civ[key][scheme];
  return {
    scheme,
    civ: key,
    s0: n.canvas,
    s1: n.surface,
    s2: S2[scheme],
    // v3 prints one line and one muted ink; the second hairline and the third ink are those.
    hair: n.line,
    hair2: n.line,
    ink: n.ink,
    inkMuted: n.muted,
    inkSubtle: n.muted,
    ...plaqueSlots(plaque, scheme),
    ...semantic[scheme],
  };
}

function plaqueSlots(plaque: string, scheme: ColorScheme) {
  return { plaque, band: v3Band(plaque), plaqueFill: scheme === "dark" ? v3Band(plaque) : plaque, onPlaque: ON_PLAQUE };
}

/**
 * The pre-sign-in palette (第三类 F 组 canvas, "App 调色板"): parchment, not a
 * civilization's ground — before sign-in there is no soul to skin by. Copied
 * verbatim except light ink3: the canvas's #77705f was 4.29:1 on bg, so it is
 * darkened (same OKLCH hue) to #6d6655, AA on bg and bg2. `preLoginTheme` maps
 * it onto the Theme slots.
 */
export const parchment = {
  light: { bg: "#f4efe4", bg2: "#ebe4d3", ink: "#1e1a14", ink2: "#5a5145", ink3: "#6d6655", line: "#cfc6b4", line2: "#8f8672", acc: "#a8281e", merit: "#2f6b3a", demerit: "#a8281e", warnBg: "#efe0bf" },
  dark: { bg: "#15130f", bg2: "#1f1c16", ink: "#ede5d3", ink2: "#b8ad98", ink3: "#8f8572", line: "#332e26", line2: "#6a6252", acc: "#d8503f", merit: "#7fc48a", demerit: "#e0685a", warnBg: "#2a2213" },
} as const;

/**
 * Every screen before sign-in: booting, login, forgot-password, the forced
 * password change. The canvas fills primary buttons with INK and keeps focus
 * rings and radios ink — the canvas's accent is the seal red, the same value as
 * the error colour — so its red (`acc` / `demerit`) reaches no slot here.
 *
 * v2: the status colours are global (规范 v2 §二), so pos / neg* / warn / lamp come
 * from `semantic`, not the canvas's merit / demerit / warnBg; the plaque is the
 * neutral one (a soul not yet signed in has no civilization).
 */
export function preLoginTheme(scheme: ColorScheme): Theme {
  const p = parchment[scheme];
  return {
    ...semantic[scheme],
    ...plaqueSlots(NEUTRAL_PLAQUE[scheme], scheme),
    scheme,
    civ: "neutral",
    s0: p.bg,
    s1: p.bg,
    s2: p.bg2,
    hair: p.line,
    hair2: p.line2,
    ink: p.ink,
    inkMuted: p.ink2,
    inkSubtle: p.ink3,
  };
}

/**
 * A sealed (past-life) record: ink steps down one level. Everything else —
 * grounds, hairlines — is the same theme.
 */
export function sealedTheme(t: Theme): Theme {
  return { ...t, ink: t.inkMuted, inkMuted: t.inkSubtle };
}

/** OKLCH (Björn Ottosson's matrices) → sRGB hex, clamped to gamut. Used by the token test. */
export function oklchToHex(triple: string): string {
  const [L, C, h] = triple.split(/\s+/).map(Number);
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    "#" +
    linear
      .map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
      .map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}
