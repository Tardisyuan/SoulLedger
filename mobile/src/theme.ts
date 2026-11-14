/**
 * The soul app's tokens — and the officer app's: `mobile-officer/src/shared.ts` re-exports this file.
 *
 * Colours are v4's (定稿 `SoulLedger v4/V4Batch07.dc.html`, its `.th-dark` / `.th-light` and
 * `[data-civ]` blocks; user decision 2026-11-06: 一律按 v4, 深浅色做到一样好). The slot names are the
 * ones every screen already reads; only their values moved, as v3 did in `4f6a74db`:
 *
 *   s0 ← --main   s1 ← --card   s2 ← --card2   hair ← --line   hair2 ← --line2
 *   ink ← --ink   inkMuted ← --sub   inkSubtle ← --sub (see `faint` in Theme)   faint ← --faint
 *   plaque ← --civT (the civilization's colour as text and as a mark)
 *   band, plaqueFill ← --solid (a filled ground under --onSolid)   onPlaque ← --onSolid
 *   glow ← --glow   metal ← --metal   side ← --side   field ← --field   pos, neg, onNeg ← the same
 *
 * v4 has no colour for a soul of no known civilization; `NEUTRAL_CIV` is ours (see there). The
 * statuses v4 does not print (negInk / negBg / warn / warnBg / lamp / lampBg / scrim) keep their values.
 */
import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

import * as generated from "./theme.generated";

export type ColorScheme = "dark" | "light";
export type CivKey = "neutral" | "cn" | "eu" | "eg" | "gr";

/** One civilization's nine, as v4 names them: `tD`/`tL` text, `sD`/`sL` solid, `mD`/`mL` metal, `sideD`/`sideL`. */
export interface CivPalette {
  glow: string;
  tD: string;
  tL: string;
  sL: string;
  sD: string;
  mD: string;
  mL: string;
  sideD: string;
  sideL: string;
}

/**
 * v4, verbatim (`line` / `line2` / `field` are v4's rgba, not composited). The values live in
 * `packages/core/tokens/*.tokens.json`, the same source as the web's globals.css; `theme.generated.ts`
 * is written from it by `scripts/build-tokens.mjs`. Edit the JSON, not the generated file.
 */
export const v4 = generated.v4;

/**
 * Before sign-in, and a civilization the app does not know: v4 drew none until Design 第八批第 5 条
 * (2026-11-06), whose values these are — text / mark `--sub` (confirmed), solid #55575E dark / #5A606B light
 * (white 7.21 / 6.32:1; the light one used to be #16171A, the body ink, so the primary button read as text),
 * glow #8E939C, metal the brand gold (dark = `brand.mark`; light #8A6A24, which is also 地府's light metal —
 * Design's choice, see theme.test), side #0E0F11 / #F1F1EF. The web's `--color-civ-neutral*` carry the
 * same values (theme.test reads the text colour; ledgerPaletteContract holds the rest). 印 = the brand balance.
 */
export const NEUTRAL_CIV: CivPalette = generated.NEUTRAL_CIV;

/** The neutral's mark colour; Android's notification tint (app.json) is its light value. */
export const NEUTRAL_PLAQUE = { light: NEUTRAL_CIV.tL, dark: NEUTRAL_CIV.tD } as const;

/** v4's `--onSolid`, the same in both schemes. */
export const ON_PLAQUE = "#FFFFFF";

/**
 * v4 第八批 `--faint-text`: text lighter than `--sub` that must still be read — a count beside a label,
 * a group heading, a map station number. ≥ 4.5:1 on main / card / card2 in both schemes (Design: dark
 * 5.97 / 5.45 / 4.97, light 5.03 / 5.35 / 4.73). `--faint` stays for what is not read (a rule, disabled).
 * The web's `--color-faint-text` is the same pair.
 */
export const FAINT_TEXT = generated.FAINT_TEXT;

/**
 * `lamp` / `lampBg`: the eternal light's warm gold (朋友圈 handoff 1e), used by that
 * one reaction and nowhere else in the app. The handoff draws dark only
 * (oklch 0.860 0.110 85 on 0.230 0.030 80). Light lamp #6A3E00 on #FBF1DC is
 * Design's (文明气质 1i, confirmed 2026-09-27; 8.13:1). Told apart by form too —
 * the one pill, 2px, in its gold.
 *
 * `pos`, `neg`, `onNeg` are v4's. v4 has one danger colour: `negStrong` (a danger fill, a refusal's
 * rule) is `neg` itself, and the text on that fill is `onNeg` — dark ink on dark's pink, white on
 * light's crimson. neg is always drawn with ✕ and words, never by colour alone.
 */
export const semantic = generated.semantic;
// `posBg`: 第三十批 the pos tag's tint (`--pos-tint`); a neg / warn tag sits on `negBg` / `warnBg`.
// `warnBg` (补足 D 组 警示底): the ground of a warning box; the text on it is `warn` itself.
// `scrim` rides along here because it is global too (补足 A2 阴影与遮罩): one use —
// under a dialog or a sheet — and one value per scheme, 0.42 light / 0.62 dark.

/**
 * The seal's fill per scheme (第三十批 `--seal`): 地府 vermilion, 欧洲 civT, 埃及 / 希腊 their metal — the web's
 * `--color-civ-*-seal`, from the same JSON. `dossierMarks.tsx` reads it.
 */
export const seal = generated.seal;

/**
 * pt. v2 补足 A2: multiples of 4. The v1 steps merged to the nearest — 7→8,
 * 10→12, 14→16, 26→24, 34→32 — so `space[0..4]` keep their index. 20 is not a
 * step but stays the screen gutter (A2: "20 不变"; `layoutFor` narrows it to 16).
 */
export const space = [2, 4, 8, 12, 16, 24, 32, 48] as const;
export const GUTTER_PT = 20;

/**
 * 第三十批「卷宗」 step 1, the touch sizes — the web's tokens of the same names, same values:
 *   controlSm / Md / Lg   --control-h-sm 44 · --control-h-md 48 · --control-h-lg 56
 *   tag                   a status tag on a touch screen (the web's 22 on a desk)
 *   topline               --topline, the 2px civilization line across the top of a page
 *   toastBar              --toast-bar, a toast's 3px semantic rule on its left
 */
export const touch = { controlSm: 44, controlMd: 48, controlLg: 56, tag: 28, topline: 2, toastBar: 3 } as const;
/**
 * v4 (user decision 2026-11-06): controls 4 — inputs, buttons, tags / badges; panels, dialogs and
 * sheets 6 (a sheet rounds its top corners only; v3's 8 became 6). The pill (the lamp, a drawer
 * handle) and the circle (a radio, an avatar) are `pill`. `none` is left for what is still square
 * (a rule, a table cell). The focus ring follows its element's shape.
 */
export const radius = { none: 0, control: 4, dialog: 6, pill: 999 } as const;
/**
 * ms; reduce-motion sets every one to 0 (holds excepted, `useReducedMotionDurations`).
 * Opacity and translate only — the one scale is the cold start's mark receding (0.96),
 * which does not play under reduce motion at all.
 *
 *   coldStart*               补足 C18: JS takes over from the native splash and writes the mark
 *                            (Draw), lets it stand (Hold), then it recedes: counted from there,
 *                            the home is usable from 480 and the splash layer is gone at 720
 *   sheetIn / sheetOut       a bottom sheet opens / closes: v3 --duration-layout 240, and 180 out
 *                            (v3 B2 改派弹层「240ms 进入 … 180ms 退出」; until 2026-10-03 200 / 120)
 *   toastHold                v3 B2 Toast「停留 4s」 (until 2026-10-03 1.9s) — a success; `toastInfoHold` 6s a notice
 *   sectionIn / sectionOut   a section's body appears (base, 4px down) / goes (fast) — 第 2 轮 4b
 */
export const motion = {
  fade: 120,
  toast: 160,
  toastHold: 4000,
  // 第三十批: a plain notice stays 6s; a success 4s (`toastHold`); a failure until it is closed.
  toastInfoHold: 6000,
  breath: 1600,
  welcomeIn: 600,
  welcomeHold: 1200,
  welcomeOut: 240,
  coldStartDraw: 600,
  coldStartHold: 300,
  coldStartInteractive: 480,
  coldStart: 720,
  sheetIn: 240,
  sheetOut: 180,
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
  // v3 B2 App「下拉刷新」: released, the content goes back (or to the 56 hold) over 200.
  pullRelease: 200,
  // The 56 hold with ↻ stays at least this long, even when the reload answers in 40ms (a local
  // backend does): shorter, the hold is a one-frame flash and reads as "did not refresh" (真机 2026-10-03).
  pullMinHold: 600,
  // One turn of the ↻ while it refreshes (user 2026-10-03).
  pullSpin: 900,
} as const;

/**
 * The brand mark's two colours (v3 第三批 品牌色令牌): the gold balance on the deep canvas. For
 * the app icon (scripts/build-app-icon.mjs) and the cold start (coldStart.tsx) only — never a UI
 * colour, so it sits outside both schemes and `Theme`. v4 leaves the mark alone, so these stay
 * (`ground` was v3's dark canvas; v4's is #111113) and neither the icons nor the splash move.
 */
export const brand = { mark: "#ECAA3D", ground: "#10120F" } as const;

export interface Theme {
  scheme: ColorScheme;
  civ: CivKey;
  s0: string;
  s1: string;
  s2: string;
  hair: string;
  hair2: string;
  /**
   * The civilization's colour, v4 `--civT`: rules, emblems, the seal, a mark — and, since v4, text
   * (a tag, a current tab, a text button): it holds 4.5:1 on every ground of its scheme.
   */
  plaque: string;
  /** The civilization's colour under white text — the title bars and the identity band: v4 `--solid`. */
  band: string;
  /** A filled control's ground (the primary button, send, follow …): v4 `--solid`, as `band`. */
  plaqueFill: string;
  onPlaque: string;
  /** v4 `--glow`: the header glow and the tinted grounds (`color-mix` of it). Never text. */
  glow: string;
  /** v4 `--metal`: the civilization's metal — the seal's gold / silver, a corner, the current item's rule. */
  metal: string;
  /** v4 `--side`: the side rail's ground, a tint of the civilization. */
  side: string;
  /** v4 `--field`: an input's / a neutral tag's ground (translucent). */
  field: string;
  ink: string;
  inkMuted: string;
  /**
   * The third ink. v4 prints `--faint` for it, but light `--faint` is 3.13:1 on `--main` and 2.94 on `--card2`,
   * and dark `--faint`, 4.70 on `--main`, is 4.29 on `--card` and 3.91 on `--card2` — under AA for text where it sits; so this stays `--sub`, as v3 kept it equal to the second ink, and `faint`
   * carries v4's value for what is not read as text (a count beside a label, a divider glyph).
   */
  inkSubtle: string;
  /** v4 `--faint`, verbatim. Not for text that must be read: see `inkSubtle`. */
  faint: string;
  /** v4 第八批 `--faint-text`: readable text lighter than `--sub` (counts, group headings). See `FAINT_TEXT`. */
  faintText: string;
  pos: string;
  /** 第三十批 `--pos-tint`: a pos tag's ground. */
  posBg: string;
  neg: string;
  negStrong: string;
  /** Text on a `negStrong` fill (v4 `--onNeg`). */
  onNeg: string;
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
 * skin; an unknown civilization also gets neutral rather than borrowing
 * another civilization's colours.
 */
export function themeFor(civilization: string | null | undefined, scheme: ColorScheme): Theme {
  const key = civKeyOf(civilization);
  // One frozen object per (civ, scheme). A new one on every call changed ThemeContext's value on each
  // foreground / profile answer and redrew every consumer in the app (opt-apps2 R1, 2026-10-30).
  const id = `${key}:${scheme}`;
  let theme = themes.get(id);
  if (!theme) themes.set(id, (theme = Object.freeze(buildTheme(key, scheme))));
  return theme;
}

const themes = new Map<string, Theme>();

function buildTheme(key: CivKey, scheme: ColorScheme): Theme {
  const n = v4[scheme];
  const c = key === "neutral" ? NEUTRAL_CIV : v4.civ[key];
  const dark = scheme === "dark";
  const solid = dark ? c.sD : c.sL;
  return {
    scheme,
    civ: key,
    s0: n.main,
    s1: n.card,
    s2: n.card2,
    hair: n.line,
    hair2: n.line2,
    ink: n.ink,
    inkMuted: n.sub,
    inkSubtle: n.sub,
    faint: n.faint,
    faintText: FAINT_TEXT[scheme],
    plaque: dark ? c.tD : c.tL,
    band: solid,
    plaqueFill: solid,
    onPlaque: ON_PLAQUE,
    glow: c.glow,
    metal: dark ? c.mD : c.mL,
    side: dark ? c.sideD : c.sideL,
    field: n.field,
    ...semantic[scheme],
  };
}

/**
 * Every screen before sign-in: booting, login, forgot-password, the forced password
 * change. Until 2026-10-02 these had their own parchment canvas (第三类 F 组); since v3
 * there is none, so they are the neutral skin — the neutrals and `NEUTRAL_CIV`, the
 * same theme as a signed-in soul of unknown civilization.
 */
export function preLoginTheme(scheme: ColorScheme): Theme {
  return themeFor(null, scheme);
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
