/**
 * Chart colours.
 *
 * Recharts props (`fill`, `stroke`, `tick.fill`, …) take concrete colour
 * values and cannot read CSS custom properties, so the semantic tokens in
 * app/globals.css are mirrored here as literals.
 *
 * KEEP IN SYNC with the `:root` block in app/globals.css. These are the dark
 * theme values; charts read them directly rather than through the cascade, so
 * they do not follow the `.light` override.
 */

/** Soul lifecycle states — mirrors --color-status-*. */
export const STATE_COLORS: Record<string, string> = {
  ALIVE: "hsl(160 84% 39%)",
  JUDGING: "hsl(38 92% 50%)",
  DISPOSED: "hsl(220 80% 62%)",
  REINCARNATING: "hsl(217 91% 60%)",
  LOST: "hsl(0 0% 50%)",
  SETTLED: "hsl(178 55% 40%)",
};

/** Civilizations — mirrors --color-civ-*. */
export const CIVILIZATION_COLORS: Record<string, string> = {
  CN_DIYU: "hsl(38 92% 50%)",
  EU_HEAVEN_HELL: "hsl(217 91% 52%)",
  EG_DUAT: "hsl(271 81% 56%)",
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
