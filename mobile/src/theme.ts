/**
 * The soul app's tokens.
 *
 * SOURCE: the Claude Design handoff "灵魂簿 App", section 1h-五 ("React Native
 * 结构示例"). Its hex values are the sRGB conversions of the OKLCH table in
 * 1h-一; `__tests__/theme.test.ts` re-converts that OKLCH table and fails if a
 * hex here drifts from it, and checks the contrast ratios the design claims.
 *
 * This REPLACES the earlier copy of `frontend/app/globals.css`. The two agree on
 * ink, surface-1/2, accent and mark within rounding (the design took them from
 * the web), and differ where the design is new: `hair`/`hair2` are tinted per
 * civilization, `canvas` (s0) is darker, and the semantic `pos`/`neg*` inks are
 * lighter in dark mode. The differences are listed in the round's report.
 *
 * `s0` is the one ground the handoff's token block leaves out — its prototype
 * paints every screen with `--s0` but the RN block starts at `s1`. The values
 * below are the prototype's `--s0` OKLCH, converted; for eu/eg/gr light the
 * prototype has none, so they follow the cn/neutral light rule
 * (L 0.995, C 0.006, surface-1's hue).
 */
import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

export type ColorScheme = "dark" | "light";
export type CivKey = "neutral" | "cn" | "eu" | "eg" | "gr";

/**
 * `plaque` is v2「朱印」's 匾色 (规范 v2 定稿 §三, 2026-09-29): the one colour a
 * civilization owns, and it goes to five places only — the plaque, the pillar's
 * current item, the seal, the "mine to handle" row mark and the primary button.
 * Never to an error or a refusal (those are `neg`). Text on it is `onPlaque`.
 * v1's `accent` / `mark` (and `onAccent`) are gone (第三阶段): a solid action is the
 * plaque, a selection or a link is ink, a decoration ink3. 埃及's ochre accent went with
 * them — its actions are now its lapis plaque.
 * The grounds s0–s2 are the App's own per-civilization grounds, kept by product
 * decision (v2 memory: "App 保留各文明底色微调"); §一 lists them unchanged.
 */
type Ground = { s0: string; s1: string; s2: string; hair: string; hair2: string; plaque: string };

/** 匾上题字 · 元数据 (§一 onMain): one warm white for all ten plaques. */
export const ON_PLAQUE = "#FFF4E8";

export const ink = {
  dark: { ink: "#F4F5F6", inkMuted: "#C4CBD4", inkSubtle: "#89909A" },
  light: { ink: "#16181D", inkMuted: "#505662", inkSubtle: "#636874" },
} as const;

export const civ: Record<CivKey, Record<ColorScheme, Ground>> = {
  neutral: {
    dark: { s0: "#0B0B0E", s1: "#101014", s2: "#14141A", hair: "#26262E", hair2: "#33333D", plaque: "#6E665E" },
    light: { s0: "#FDFDFF", s1: "#F9F9FB", s2: "#F3F3F6", hair: "#E4E4EA", hair2: "#CFCFD8", plaque: "#2B2724" },
  },
  cn: {
    dark: { s0: "#100704", s1: "#1A0D09", s2: "#1F120E", hair: "#362B27", hair2: "#4B3F3C", plaque: "#B3402C" },
    light: { s0: "#FFFDFA", s1: "#FFF8F3", s2: "#FDF1E7", hair: "#DED6D0", hair2: "#C6BCB4", plaque: "#9A2F1F" },
  },
  eu: {
    dark: { s0: "#040611", s1: "#090C1A", s2: "#0E111F", hair: "#242838", hair2: "#333952", plaque: "#7A52A6" },
    light: { s0: "#FDFDFF", s1: "#F5F6FF", s2: "#ECEEFB", hair: "#DCDFF0", hair2: "#C3C7E0", plaque: "#4A2A6A" },
  },
  eg: {
    dark: { s0: "#120F05", s1: "#1A1609", s2: "#1F1B0E", hair: "#312B1B", hair2: "#453D28", plaque: "#3E62B8" },
    light: { s0: "#FFFDF9", s1: "#FFFCF5", s2: "#FBF7EC", hair: "#E6DFCC", hair2: "#CFC5AC", plaque: "#1F3F8A" },
  },
  gr: {
    dark: { s0: "#0B1205", s1: "#121A09", s2: "#181F0E", hair: "#242E1A", hair2: "#374426", plaque: "#3F7076" },
    light: { s0: "#FCFEFA", s1: "#FAFFF5", s2: "#F4FBEC", hair: "#DBE6CC", hair2: "#C0D1AC", plaque: "#1F3B3E" },
  },
};

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
} as const;

export interface Theme {
  scheme: ColorScheme;
  civ: CivKey;
  s0: string;
  s1: string;
  s2: string;
  hair: string;
  hair2: string;
  /** 匾色: see `Ground`. The primary button's fill. */
  plaque: string;
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
  const ground = civ[key][scheme];
  return { scheme, civ: key, ...ground, onPlaque: ON_PLAQUE, ...ink[scheme], ...semantic[scheme] };
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
    plaque: civ.neutral[scheme].plaque,
    onPlaque: ON_PLAQUE,
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
