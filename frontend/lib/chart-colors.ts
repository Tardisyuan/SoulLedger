/**
 * Chart colours, in both themes.
 *
 * Recharts props (`fill`, `stroke`, `tick.fill`, …) take concrete colour
 * values and cannot read CSS custom properties, so the semantic tokens in
 * app/globals.css are mirrored here as literals.
 *
 * app/globals.css is the authority; this file is its mirror, not a second
 * palette.
 *
 * WHY THERE ARE NOW TWO OF EVERY TABLE. Because the literals do not follow the
 * cascade, they did not follow `.light` either — every chart in the app drew
 * dark-theme colours on a light-theme page. BRIEF §4.5 recorded that; `0b4f8fb`
 * made it visible by pinning all five tables to real tokens, at which point the
 * two themes stopped being the same numbers. `--color-status-alive` is
 * `150 62% 46%` in `:root` and `150 62% 28%` under `.light`, and the light
 * values are not a lazy darkening: `5e580e3` re-measured them against the 10%
 * badge tint until they cleared 4.5:1 (see src/__tests__/dataGridToneContract
 * .test.ts). Rendering the dark value on white was an AA failure, not a
 * preference.
 *
 * `.light` is an OVERRIDE block, so the light table is the `:root` values with
 * `.light`'s declarations laid over them. That matters in exactly one place:
 * `--civ-hue` is declared only in `:root`, so the light surface ramp
 * interpolates the same neutral 240 — see CHART_CHROME.tooltipBg below.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO is resolve
 * `getComputedStyle(document.documentElement)` at render time. That is the
 * obvious way to make one table follow the theme, and it turns a static literal
 * table into a DOM-dependent one: no SSR, every consumer a client component,
 * and nothing left for a file-reading test to compare. Two tables and a
 * `theme` argument keep the mirror static and keep both halves pinned.
 * `src/hooks/useChartColors.ts` is where the current theme picks one.
 *
 * A "KEEP IN SYNC" comment was the only thing holding the two ends together
 * and it failed twice in a row unnoticed: STATE_COLORS.JUDGING still carried
 * the accent amber a whole restyle had moved it off, DISPOSED and
 * REINCARNATING were both still the near-identical blue they had before that
 * pair was split apart, and CIVILIZATION_COLORS was keyed off a
 * `--color-civ-*` token set that no longer exists. A comment cannot fail, so
 * src/__tests__/civilizationColourContract.test.ts now parses globals.css and
 * compares both maps against it in both directions, in both themes.
 *
 * THE OTHER THREE TABLES WERE NEVER MIRRORS AT ALL, WHICH IS WORSE THAN DRIFT.
 * REALM_COLORS and CHART_SERIES were the stock Tailwind palette this file was
 * born with, sitting under a docstring that said they mirrored tokens:
 * `hsl(0 84% 60%)` is red-500 `#ef4444`, `hsl(217 91% 60%)` is blue-500
 * `#3b82f6`, `hsl(142 76% 36%)` is green-600 `#16a34a`, `hsl(271 81% 56%)` is
 * purple-600 `#9333ea`. Two of them landed a couple of degrees from a live
 * token — `217 91% 60%` sits 2° off `--color-verdict-purgatory` — which is the
 * failure mode that survives review, because a near-miss reads as the token.
 * All five tables are now pinned to globals.css in both directions by that
 * same test, and the entries that mirror something *outside* the family their
 * table is named for are listed there by name with the reason.
 */

/** The two themes, spelled as `src/contexts/ThemeContext.tsx` spells them. */
export type ChartTheme = "dark" | "light";

export type ChartSeriesKey = "balance" | "realm" | "neutral";
export type ChartChromeKey =
  | "accent"
  | "grid"
  | "axis"
  | "tick"
  | "tooltipBg"
  | "tooltipBorder";

export interface ChartColors {
  /**
   * Soul lifecycle states — mirrors `--color-status-<state>`, one entry per
   * member of the `Soul.current_state` union in packages/core/src/api/souls.ts — the states
   * the payload can actually carry.
   */
  STATE_COLORS: Record<string, string>;
  /**
   * Civilizations — mirrors `--color-civ-mark-<prefix>`.
   *
   * Keyed by TENANT CODE, not civilization name, because that is what the
   * dashboard has in hand (`stats.tenants[i].tenant_code`). The CSS side is
   * keyed by the tenant code's prefix — the same `code.split("_")[0]` rule
   * TenantContext uses to stamp `[data-civ]`.
   *
   * `--color-civ-mark-*`, not `--color-civ-hue-*`: the hue tokens are bare
   * degree numbers that only make sense interpolated into the surface ramp
   * (`hsl(var(--civ-hue) 13% 7%)`), so they cannot be mirrored as literals
   * here.
   */
  CIVILIZATION_COLORS: Record<string, string>;
  /**
   * Destination realms — one entry per `realms.types` member in the message
   * bundles, which is the enumeration the UI renders labels from and matches
   * `RealmType` in backend/apps/realms/models.py.
   *
   * Three of the four reuse the verdict palette:
   *   HELL      -> --color-verdict-failed
   *   PURGATORY -> --color-verdict-purgatory
   *   BLISS     -> --color-verdict-passed
   *
   * NEUTRAL IS PINNED OUTSIDE THAT PALETTE, DELIBERATELY, AND NOT ON
   * --color-status-lost. `RealmType.NEUTRAL` is "Neutral / Between", and
   * backend/apps/actors/mythology/realms.py says in as many words what that
   * means: EU_ACHERON is "Not a destination: nobody is sentenced here", and
   * EU_PLATO_MEADOW is "reachable without being a destination … nobody is
   * sentenced to it". Twice more the same file rejects NEUTRAL for a row on
   * the grounds that it "would file [this] alongside the ferry crossing as
   * another waypoint" (EU_EARTHLY_PARADISE, EG_ANNIHILATION). So a NEUTRAL
   * realm is a place a soul passes through, and there is no verdict that sends
   * anyone there — there is nothing in the verdict palette for it to mirror.
   *
   * --color-status-lost is the other tempting answer and it is wrong twice
   * over. It is a *lifecycle* token (LOST 迷失 — the soul went missing), and
   * Stage 1's colorGroups split keeps "Verdict & karma" and "Lifecycle state"
   * apart even where a hue is shared; borrowing it here would draw the Acheron
   * crossing and the meadow at the parting of the ways in the colour that
   * means a soul was lost. The old value — a flat `hsl(0 0% 50%)` — was wrong
   * for a third reason globals.css had already written down on that very
   * token: "grey reads as disabled". --color-ink-tertiary is the authored
   * dimmest legible neutral (215°, measured 4.91:1 on surface-1), which is
   * what "passed through, nothing decided" should look like.
   *
   * The same four pins hold in light mode; `app/realms/page.tsx` uses this
   * table's tokens for its badges through the cascade rather than these
   * literals, so the two ends of the realm palette agree by construction.
   */
  REALM_COLORS: Record<string, string>;
  /**
   * Fills for series that carry no semantic meaning of their own (balance
   * buckets, per-realm counts). Named by what they chart so call sites stop
   * reaching for raw hex, and `neutral` covers the `STATE_COLORS[x] || …`
   * fallbacks.
   *
   * `balance` and `realm` resolve to the SAME token, and that is the finding
   * rather than a copy-paste. Both are single-series histograms — one fill for
   * every bar — so neither has anything to encode, and globals.css authors
   * exactly one fill for that case: --color-accent. Every other family is
   * spoken for. The `--color-status-*` feedback set is documented "never a
   * row, a badge or a chart"; verdict and karma would assert an outcome for
   * every bucket; `--color-civ-mark-*` is tenant identity; the ink ramp is
   * text. The two keys stay separate because a call site should name what it
   * charts, and because the day one of them acquires a meaning it moves on its
   * own. (LazyBarChart and LazyAdminBarChart already default `fill` to
   * `#f59e0b`, which is this same accent written as raw hex.)
   *
   * `neutral` is --color-ink-tertiary, not --color-status-lost: it is the
   * colour of a state the mirror could not identify, and an unrecognised state
   * rendering identically to LOST would be the wrong value sitting where the
   * right one belongs. Its call sites include a `<span style={{ color }}>`, so
   * the token's measured 4.91:1 on surface-1 is load-bearing, not decorative —
   * and that measurement is per theme, which is the other half of why this
   * table now has a light twin.
   */
  CHART_SERIES: Record<ChartSeriesKey, string>;
  /**
   * Chart chrome: grid lines, axis ticks, tooltip surfaces.
   *
   * accent/grid/axis/tick/tooltipBorder mirror --color-accent, --color-hairline
   * (×3) and --color-ink-subtle, and always did — this table was written after
   * the token system, unlike the two above.
   *
   * tooltipBg IS THE ONE ENTRY WHOSE TOKEN STOPPED BEING A LITERAL. --color-
   * surface-1 used to be a fixed `240 13% 7%`; it is now `var(--civ-hue) 13%
   * 7%` and changes per tenant. A tenant-variable token has no single literal
   * mirror, so this value has to answer a design question rather than a copy
   * question, and the answer here is: the tooltip does not follow the tenant.
   * The mirror is surface-1 composed with the NEUTRAL fallback `--civ-hue: 240`
   * that `:root` declares for logged-out screens — still derived from
   * globals.css, still pinned, just pinned to the fallback branch. `.light`
   * never redeclares `--civ-hue`, so the light entry is that same 240 through
   * `.light`'s own surface ramp.
   *
   * Why that costs nothing: the surface ramp barely expresses hue at all. 13%
   * saturation at 7% lightness cannot carry a hue, so Chinese (12°) and
   * European (232°) — 220° apart — differ by about 4/255 per channel at
   * surface-1. Independently measured in the f62fdaa review. So "deliberately
   * not per-tenant" and "per-tenant" are the same pixels here, and the
   * alternative — resolving `getComputedStyle(document.documentElement)` at
   * render time — would turn a static literal table into a DOM-dependent one
   * (no SSR, every consumer a client component) to buy that 4/255.
   *
   * It is also not re-implementing anything: every tooltip actually on screen
   * lives in src/components/charts/LazyDashboardCharts.tsx and already sets
   * `background: "hsl(var(--color-surface-1))"` inline, which follows the
   * cascade and therefore both the tenant and the theme, for free. This table
   * is the fallback for a Recharts prop that cannot take a custom property.
   */
  CHART_CHROME: Record<ChartChromeKey, string>;
}

/** The `:root` block — what `ThemeProvider` renders with `.dark` on `<html>`. */
const DARK: ChartColors = {
  STATE_COLORS: {
    ALIVE: "hsl(150 62% 46%)",
    JUDGING: "hsl(20 88% 58%)",
    DISPOSED: "hsl(285 55% 66%)",
    REINCARNATING: "hsl(195 88% 55%)",
    LOST: "hsl(225 10% 58%)",
    SETTLED: "hsl(178 55% 40%)",
  },
  CIVILIZATION_COLORS: {
    CN_DIYU: "hsl(12 55% 58%)",
    EU_HEAVEN_HELL: "hsl(232 42% 64%)",
    EG_DUAT: "hsl(44 45% 55%)",
    GR_HADES: "hsl(88 40% 52%)",
  },
  REALM_COLORS: {
    HELL: "hsl(0 84% 62%)",
    PURGATORY: "hsl(215 80% 62%)",
    BLISS: "hsl(150 62% 46%)",
    NEUTRAL: "hsl(215 6% 54%)",
  },
  CHART_SERIES: {
    balance: "hsl(38 92% 50%)",
    realm: "hsl(38 92% 50%)",
    neutral: "hsl(215 6% 54%)",
  },
  CHART_CHROME: {
    accent: "hsl(38 92% 50%)",
    grid: "hsl(220 8% 18%)",
    axis: "hsl(220 8% 18%)",
    tick: "hsl(215 8% 57%)",
    tooltipBg: "hsl(240 13% 7%)",
    tooltipBorder: "hsl(220 8% 18%)",
  },
};

/**
 * The `.light` block laid over `:root`, entry for entry.
 *
 * Every value here is the same TOKEN as its dark twin above, read from the
 * other side of globals.css — not a hand-lightened version of the dark
 * literal. Where the two differ by more than lightness (`--color-verdict-failed`
 * drops 84%→78% saturation as well, `--color-ink-tertiary` moves 215°→220°)
 * that is the stylesheet's own re-measurement against the light canvas, and
 * copying the dark hue "because it is close" would undo it.
 *
 * `--color-accent` is identical in both themes, so CHART_SERIES.balance /
 * .realm and CHART_CHROME.accent repeat. That is globals.css's decision, not a
 * missed entry: the accent is the brand colour and holds across themes, which
 * is why globals.css authors a SEPARATE `--color-accent-ink` for the text case
 * where the shared value fails AA on white.
 */
const LIGHT: ChartColors = {
  STATE_COLORS: {
    ALIVE: "hsl(150 62% 28%)",
    JUDGING: "hsl(20 82% 38%)",
    DISPOSED: "hsl(285 52% 44%)",
    REINCARNATING: "hsl(195 85% 31%)",
    LOST: "hsl(225 10% 42%)",
    SETTLED: "hsl(178 55% 29%)",
  },
  CIVILIZATION_COLORS: {
    CN_DIYU: "hsl(12 58% 38%)",
    EU_HEAVEN_HELL: "hsl(232 45% 44%)",
    EG_DUAT: "hsl(44 52% 34%)",
    GR_HADES: "hsl(88 46% 32%)",
  },
  REALM_COLORS: {
    HELL: "hsl(0 78% 44%)",
    PURGATORY: "hsl(215 78% 42%)",
    BLISS: "hsl(150 62% 28%)",
    NEUTRAL: "hsl(220 6% 42%)",
  },
  CHART_SERIES: {
    balance: "hsl(38 92% 50%)",
    realm: "hsl(38 92% 50%)",
    neutral: "hsl(220 6% 42%)",
  },
  CHART_CHROME: {
    accent: "hsl(38 92% 50%)",
    grid: "hsl(220 10% 90%)",
    axis: "hsl(220 10% 90%)",
    tick: "hsl(220 8% 42%)",
    tooltipBg: "hsl(240 14% 98%)",
    tooltipBorder: "hsl(220 10% 90%)",
  },
};

/**
 * Both mirrors, keyed by theme. Exported as a map rather than as two bundles so
 * the contract tests can iterate the themes instead of naming them, which is
 * what keeps a third theme from arriving with only one half pinned.
 */
export const CHART_COLORS: Record<ChartTheme, ChartColors> = {
  dark: DARK,
  light: LIGHT,
};

/**
 * The mirror for one theme.
 *
 * There is deliberately no bare `STATE_COLORS` export any more. A flat export
 * beside a themed one is an invitation to import the dark table into a
 * light-mode screen — which is precisely the bug this file exists to close, and
 * it would look correct at every call site.
 */
export function chartColors(theme: ChartTheme): ChartColors {
  return CHART_COLORS[theme];
}
