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

type Ground = { s0: string; s1: string; s2: string; accent: string; mark: string; hair: string; hair2: string };

export const ink = {
  dark: { ink: "#F4F5F6", inkMuted: "#C4CBD4", inkSubtle: "#89909A" },
  light: { ink: "#16181D", inkMuted: "#505662", inkSubtle: "#636874" },
} as const;

export const civ: Record<CivKey, Record<ColorScheme, Ground>> = {
  neutral: {
    dark: { s0: "#0B0B0E", s1: "#101014", s2: "#14141A", accent: "#89909A", mark: "#89909A", hair: "#26262E", hair2: "#33333D" },
    light: { s0: "#FDFDFF", s1: "#F9F9FB", s2: "#F3F3F6", accent: "#656C76", mark: "#656C76", hair: "#E4E4EA", hair2: "#CFCFD8" },
  },
  cn: {
    dark: { s0: "#100704", s1: "#1A0D09", s2: "#1F120E", accent: "#D88C79", mark: "#CF715A", hair: "#362B27", hair2: "#4B3F3C" },
    light: { s0: "#FFFDFA", s1: "#FFF8F3", s2: "#FDF1E7", accent: "#854423", mark: "#994E29", hair: "#DED6D0", hair2: "#C6BCB4" },
  },
  eu: {
    dark: { s0: "#040611", s1: "#090C1A", s2: "#0E111F", accent: "#969ED4", mark: "#7D87CA", hair: "#242838", hair2: "#333952" },
    light: { s0: "#FDFDFF", s1: "#F5F6FF", s2: "#ECEEFB", accent: "#3E4BA3", mark: "#3E4BA3", hair: "#DCDFF0", hair2: "#C3C7E0" },
  },
  eg: {
    dark: { s0: "#120F05", s1: "#1A1609", s2: "#1F1B0E", accent: "#C1A65C", mark: "#C0A459", hair: "#312B1B", hair2: "#453D28" },
    light: { s0: "#FFFDF9", s1: "#FFFCF5", s2: "#FBF7EC", accent: "#695621", mark: "#846C2A", hair: "#E6DFCC", hair2: "#CFC5AC" },
  },
  gr: {
    dark: { s0: "#0B1205", s1: "#121A09", s2: "#181F0E", accent: "#88B654", mark: "#88B654", hair: "#242E1A", hair2: "#374426" },
    light: { s0: "#FCFEFA", s1: "#FAFFF5", s2: "#F4FBEC", accent: "#425D22", mark: "#53772D", hair: "#DBE6CC", hair2: "#C0D1AC" },
  },
};

export const semantic = {
  dark: { pos: "#82CB92", neg: "#F4928A", negStrong: "#C25D58", negInk: "#FED2CD", negBg: "#301715" },
  light: { pos: "#197037", neg: "#AC3031", negStrong: "#C13C3B", negInk: "#94151D", negBg: "#FFEDEB" },
} as const;

/** pt. `space[5]` (20) is the screen gutter. */
export const space = [2, 4, 7, 10, 14, 20, 26, 34] as const;
export const radius = { none: 0, pill: 999, focus: 2 } as const;
/** ms. The only motion is opacity; reduce-motion sets every duration to 0. */
export const motion = { fade: 120, toast: 160, toastHold: 1900 } as const;

export interface Theme {
  scheme: ColorScheme;
  civ: CivKey;
  s0: string;
  s1: string;
  s2: string;
  accent: string;
  mark: string;
  hair: string;
  hair2: string;
  /** Text on an accent fill: the screen ground, as in the prototype. */
  onAccent: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  pos: string;
  neg: string;
  negStrong: string;
  negInk: string;
  negBg: string;
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
  return { scheme, civ: key, ...ground, onAccent: ground.s0, ...ink[scheme], ...semantic[scheme] };
}

/**
 * A sealed (past-life) record: ink steps down one level and accent becomes
 * subtle. Everything else — grounds, hairlines — is the same theme.
 */
export function sealedTheme(t: Theme): Theme {
  return { ...t, ink: t.inkMuted, inkMuted: t.inkSubtle, accent: t.inkSubtle };
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
