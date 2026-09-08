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
 * `.light`'s declarations laid over them. It matters wherever a token exists
 * only in `:root` — `--civ-mark` is the live example — and it used to matter
 * for the surface ramp too, back when `--civ-hue` was declared once and the
 * light planes interpolated the dark block's 240. See CHART_CHROME.tooltipBg
 * below, which is still the one entry the ramp's tenant-variability reaches.
 *
 * EVERY LITERAL IN THIS FILE IS AN `oklch()` STRING. It was `hsl()` until the
 * token migration; the colours did not move — the two spellings resolve to the
 * same sRGB, checked over the whole palette in both engines — and
 * `civilizationColourContract` / `chartColourContract` compare these strings
 * against globals.css character for character, so a mirror written in the old
 * spelling now fails rather than drifting.
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
   * degree numbers, not colours. They were interpolated into the surface ramp
   * (`hsl([--civ-hue] 47% 7%)`) until the OKLCH migration and are read by
   * nothing but the contract tests now — either way there is no literal in
   * them to mirror.
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
   * surface-1 used to be one fixed colour for everyone (`240 13% 7%`, in the
   * HSL the file was written in then); Stage 11 made it per tenant — spelled
   * `[--civ-hue] 47% 7%` until the OKLCH migration and
   * `var(--color-civ-surface-1-cn)` and siblings since, the same four colours
   * either way. A tenant-variable token has no single literal
   * mirror, so this value has to answer a design question rather than a copy
   * question, and the answer here is: the tooltip does not follow the tenant.
   * The mirror is the ramp a screen with NO cosmology renders, which since
   * Stage 11 globals.css declares outright under `:root:not([data-civ])` /
   * `.light:not([data-civ])`. Still derived from globals.css, still pinned,
   * just pinned to that branch — chartColourContract resolves this one key
   * through `noCivLiteralOfIn` and every other key through `literalOfIn`.
   *
   * THE VALUES BELOW DID NOT MOVE FOR STAGE 11 AND THE ARGUMENT FOR THEM DID.
   * It used to be "this costs nothing, because at 13% saturation the ramp
   * barely expresses hue — Chinese (12°) and European (232°), 220° apart,
   * differ by about 4/255 at surface-1, so per-tenant and not-per-tenant are
   * the same pixels". That sentence is now false: the tenants' surface-1
   * values are 17/255 apart in dark and 10/255 in light. What replaced it is
   * a decision rather than a coincidence — a tooltip is transient chrome and
   * says nothing about which cosmology you are in — and the cost is now real
   * and accepted, not zero.
   *
   * STAGE 12: IT WAS NEVER ZERO. Both figures above are max-channel counts,
   * which barely register a hue-only difference. That "4/255" pair measures
   * 2.87 ΔE00 even on the old ramp — a visible difference, on the largest
   * flat area a tooltip has. So the old sentence was not made false by Stage
   * 11 retinting the ramp; it was wrong when it was written, and the retint
   * only widened the gap (10.75 ΔE00 dark, 5.96 light) until nobody could
   * argue with it. The DECISION is unaffected and is the right one on its own
   * terms — this note exists because "it costs nothing" and "the cost is
   * accepted" are different claims, and only the second was ever true.
   *
   * The alternative is unchanged: resolving
   * `getComputedStyle(document.documentElement)` at render time would turn a
   * static literal table into a DOM-dependent one (no SSR, every consumer a
   * client component).
   *
   * It is also not re-implementing anything: every tooltip actually on screen
   * lives in src/components/charts/LazyDashboardCharts.tsx and already sets
   * `background: "oklch(var(--color-surface-1))"` inline, which follows the
   * cascade and therefore both the tenant and the theme, for free. This table
   * is the fallback for a Recharts prop that cannot take a custom property.
   */
  CHART_CHROME: Record<ChartChromeKey, string>;
}

/** The `:root` block — what `ThemeProvider` renders with `.dark` on `<html>`. */
const DARK: ChartColors = {
  STATE_COLORS: {
    ALIVE: "oklch(0.710064 0.160036 155.6214)",
    JUDGING: "oklch(0.698166 0.171837 44.2374)",
    DISPOSED: "oklch(0.686063 0.153568 317.1774)",
    REINCARNATING: "oklch(0.751947 0.137031 226.6462)",
    LOST: "oklch(0.650423 0.024804 269.3049)",
    SETTLED: "oklch(0.63759 0.097383 191.473)",
  },
  CIVILIZATION_COLORS: {
    CN_DIYU: "oklch(0.649703 0.124151 35.2992)",
    EU_HEAVEN_HELL: "oklch(0.642606 0.10097 276.6787)",
    EG_DUAT: "oklch(0.727725 0.100218 89.3545)",
    GR_HADES: "oklch(0.721756 0.13753 130.0922)",
  },
  REALM_COLORS: {
    HELL: "oklch(0.647001 0.198706 24.6009)",
    PURGATORY: "oklch(0.656708 0.151485 257.4417)",
    BLISS: "oklch(0.710064 0.160036 155.6214)",
    NEUTRAL: "oklch(0.627711 0.013933 255.5433)",
  },
  CHART_SERIES: {
    balance: "oklch(0.770351 0.164635 70.6613)",
    realm: "oklch(0.770351 0.164635 70.6613)",
    neutral: "oklch(0.627711 0.013933 255.5433)",
  },
  CHART_CHROME: {
    accent: "oklch(0.770351 0.164635 70.6613)",
    grid: "oklch(0.296183 0.010017 260.7091)",
    axis: "oklch(0.296183 0.010017 260.7091)",
    tick: "oklch(0.650852 0.016974 257.2209)",
    tooltipBg: "oklch(0.174911 0.008207 285.5205)",
    tooltipBorder: "oklch(0.296183 0.010017 260.7091)",
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
    ALIVE: "oklch(0.496252 0.108981 156.0004)",
    JUDGING: "oklch(0.530328 0.150617 42.248)",
    DISPOSED: "oklch(0.50637 0.187764 316.1446)",
    REINCARNATING: "oklch(0.512783 0.096631 227.6554)",
    LOST: "oklch(0.510868 0.026414 269.1642)",
    SETTLED: "oklch(0.507045 0.076416 191.4559)",
  },
  CIVILIZATION_COLORS: {
    CN_DIYU: "oklch(0.509043 0.112189 45.2466)",
    EU_HEAVEN_HELL: "oklch(0.451923 0.141689 273.0637)",
    EG_DUAT: "oklch(0.541259 0.089289 88.9271)",
    GR_HADES: "oklch(0.525615 0.111121 130.5085)",
  },
  REALM_COLORS: {
    HELL: "oklch(0.531966 0.205532 27.9789)",
    PURGATORY: "oklch(0.495652 0.167987 258.581)",
    BLISS: "oklch(0.496252 0.108981 156.0004)",
    NEUTRAL: "oklch(0.520424 0.014972 266.5999)",
  },
  CHART_SERIES: {
    balance: "oklch(0.770351 0.164635 70.6613)",
    realm: "oklch(0.770351 0.164635 70.6613)",
    neutral: "oklch(0.520424 0.014972 266.5999)",
  },
  CHART_CHROME: {
    accent: "oklch(0.770351 0.164635 70.6613)",
    grid: "oklch(0.921227 0.0046 258.3254)",
    axis: "oklch(0.921227 0.0046 258.3254)",
    tick: "oklch(0.517183 0.019895 267.6262)",
    tooltipBg: "oklch(0.982679 0.002642 286.3511)",
    tooltipBorder: "oklch(0.921227 0.0046 258.3254)",
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
