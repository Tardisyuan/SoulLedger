/**
 * Chart colours.
 *
 * Recharts props (`fill`, `stroke`, `tick.fill`, …) take concrete colour
 * values and cannot read CSS custom properties, so the semantic tokens in
 * app/globals.css are mirrored here as literals.
 *
 * app/globals.css is the authority; this file is its mirror, not a second
 * palette. These are the dark-theme values — charts read them directly rather
 * than through the cascade, so they do not follow the `.light` override.
 *
 * A "KEEP IN SYNC" comment was the only thing holding the two ends together
 * and it failed twice in a row unnoticed: STATE_COLORS.JUDGING still carried
 * the accent amber a whole restyle had moved it off, DISPOSED and
 * REINCARNATING were both still the near-identical blue they had before that
 * pair was split apart, and CIVILIZATION_COLORS was keyed off a
 * `--color-civ-*` token set that no longer exists. A comment cannot fail, so
 * src/__tests__/civilizationColourContract.test.ts now parses globals.css and
 * compares both maps against it in both directions.
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

/**
 * Soul lifecycle states — mirrors `--color-status-<state>` from the `:root`
 * block, one entry per member of the `Soul.current_state` union in
 * lib/api/souls.ts — the states the payload can actually carry.
 */
export const STATE_COLORS: Record<string, string> = {
  ALIVE: "hsl(150 62% 46%)",
  JUDGING: "hsl(20 88% 58%)",
  DISPOSED: "hsl(285 55% 66%)",
  REINCARNATING: "hsl(195 88% 55%)",
  LOST: "hsl(225 10% 58%)",
  SETTLED: "hsl(178 55% 40%)",
};

/**
 * Civilizations — mirrors `--color-civ-mark-<prefix>` from the `:root` block.
 *
 * Keyed by TENANT CODE, not civilization name, because that is what the
 * dashboard has in hand (`stats.tenants[i].tenant_code`). The CSS side is
 * keyed by the tenant code's prefix — the same `code.split("_")[0]` rule
 * TenantContext uses to stamp `[data-civ]`.
 *
 * `--color-civ-mark-*`, not `--color-civ-hue-*`: the hue tokens are bare
 * degree numbers that only make sense interpolated into the surface ramp
 * (`hsl(var(--civ-hue) 13% 7%)`), so they cannot be mirrored as literals here.
 */
export const CIVILIZATION_COLORS: Record<string, string> = {
  CN_DIYU: "hsl(12 55% 58%)",
  EU_HEAVEN_HELL: "hsl(232 42% 64%)",
  EG_DUAT: "hsl(44 45% 55%)",
  GR_HADES: "hsl(88 40% 52%)",
};

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
 * sentenced to it". Twice more the same file rejects NEUTRAL for a row on the
 * grounds that it "would file [this] alongside the ferry crossing as another
 * waypoint" (EU_EARTHLY_PARADISE, EG_ANNIHILATION). So a NEUTRAL realm is a
 * place a soul passes through, and there is no verdict that sends anyone
 * there — there is nothing in the verdict palette for it to mirror.
 *
 * --color-status-lost is the other tempting answer and it is wrong twice
 * over. It is a *lifecycle* token (LOST 迷失 — the soul went missing), and
 * Stage 1's colorGroups split keeps "Verdict & karma" and "Lifecycle state"
 * apart even where a hue is shared; borrowing it here would draw the Acheron
 * crossing and the meadow at the parting of the ways in the colour that means
 * a soul was lost. The old value — a flat `hsl(0 0% 50%)` — was wrong for a
 * third reason globals.css had already written down on that very token: "grey
 * reads as disabled". --color-ink-tertiary is the authored dimmest legible
 * neutral (215°, measured 4.91:1 on surface-1), which is what "passed through,
 * nothing decided" should look like.
 */
export const REALM_COLORS: Record<string, string> = {
  HELL: "hsl(0 84% 62%)",
  PURGATORY: "hsl(215 80% 62%)",
  BLISS: "hsl(150 62% 46%)",
  NEUTRAL: "hsl(215 6% 52%)",
};

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
 * spoken for. The `--color-status-*` feedback set is documented "never a row,
 * a badge or a chart"; verdict and karma would assert an outcome for every
 * bucket; `--color-civ-mark-*` is tenant identity; the ink ramp is text. The
 * two keys stay separate because a call site should name what it charts, and
 * because the day one of them acquires a meaning it moves on its own.
 * (LazyBarChart and LazyAdminBarChart already default `fill` to `#f59e0b`,
 * which is this same accent written as raw hex.)
 *
 * `neutral` is --color-ink-tertiary, not --color-status-lost: it is the
 * colour of a state the mirror could not identify, and an unrecognised state
 * rendering identically to LOST would be the wrong value sitting where the
 * right one belongs. Its call sites include a `<span style={{ color }}>`, so
 * the token's measured 4.91:1 on surface-1 is load-bearing, not decorative.
 */
export const CHART_SERIES = {
  balance: "hsl(38 92% 50%)",
  realm: "hsl(38 92% 50%)",
  neutral: "hsl(215 6% 52%)",
} as const;

/**
 * Chart chrome: grid lines, axis ticks, tooltip surfaces.
 *
 * accent/grid/axis/tick/tooltipBorder mirror --color-accent, --color-hairline
 * (×3) and --color-ink-subtle, and always did — this table was written after
 * the token system, unlike the two above.
 *
 * tooltipBg IS THE ONE ENTRY WHOSE TOKEN STOPPED BEING A LITERAL. --color-
 * surface-1 used to be a fixed `240 13% 7%`; it is now `var(--civ-hue) 13% 7%`
 * and changes per tenant. A tenant-variable token has no single literal
 * mirror, so this value has to answer a design question rather than a copy
 * question, and the answer here is: the tooltip does not follow the tenant.
 * The mirror is surface-1 composed with the NEUTRAL fallback `--civ-hue: 240`
 * that `:root` declares for logged-out screens — still derived from
 * globals.css, still pinned, just pinned to the fallback branch.
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
 * cascade and therefore the tenant, for free. This table is the fallback for
 * a Recharts prop that cannot take a custom property.
 */
export const CHART_CHROME = {
  accent: "hsl(38 92% 50%)",
  grid: "hsl(220 8% 18%)",
  axis: "hsl(220 8% 18%)",
  tick: "hsl(215 8% 57%)",
  tooltipBg: "hsl(240 13% 7%)",
  tooltipBorder: "hsl(220 8% 18%)",
} as const;
