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

/** Destination realms — reuses the verdict palette. */
export const REALM_COLORS: Record<string, string> = {
  HELL: "hsl(0 84% 60%)",
  PURGATORY: "hsl(217 91% 60%)",
  BLISS: "hsl(142 76% 36%)",
  NEUTRAL: "hsl(0 0% 50%)",
};

/**
 * Fills for series that carry no semantic meaning of their own (balance
 * buckets, per-realm counts). Named by what they chart so call sites stop
 * reaching for raw hex, and `neutral` covers the `STATE_COLORS[x] || …`
 * fallbacks.
 */
export const CHART_SERIES = {
  balance: "hsl(271 81% 56%)",
  realm: "hsl(217 91% 60%)",
  neutral: "hsl(220 6% 55%)",
} as const;

/** Chart chrome: grid lines, axis ticks, tooltip surfaces. */
export const CHART_CHROME = {
  accent: "hsl(38 92% 50%)",
  grid: "hsl(220 8% 18%)",
  axis: "hsl(220 8% 18%)",
  tick: "hsl(215 8% 57%)",
  tooltipBg: "hsl(240 13% 7%)",
  tooltipBorder: "hsl(220 8% 18%)",
} as const;
