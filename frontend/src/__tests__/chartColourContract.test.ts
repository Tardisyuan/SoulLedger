/**
 * `app/globals.css` is the authority for colour; `lib/chart-colors.ts` mirrors
 * it as literals because Recharts cannot read custom properties. This holds the
 * mirror to the stylesheet in BOTH themes and in BOTH directions:
 *
 * - every entry equals the value of the token `CHART_TOKENS` names for it, per
 *   theme (a hand-typed near-miss is how the old tables drifted off the palette);
 * - STATE_COLORS covers exactly `Soul.current_state`, REALM_COLORS exactly
 *   `realms.types` — a state the API can send but no chart can colour is red,
 *   and so is an entry for a state that no longer exists.
 */
import { CHART_COLORS, CHART_TOKENS, type ChartColors } from "@/lib/chart-colors";

import { THEMES, literalOfIn, readRealmTypes, readSoulStates } from "./support/globalsCssTokens";

const TABLES = Object.keys(CHART_TOKENS) as (keyof ChartColors)[];

describe("chart colours mirror globals.css", () => {
  const rows = THEMES.flatMap((theme) =>
    TABLES.flatMap((table) => Object.keys(CHART_TOKENS[table]).map((key) => [theme, table, key] as const))
  );

  it("the pin list is not empty (a scanner that finds nothing passes everything)", () => {
    expect(rows.length).toBeGreaterThan(30);
  });

  it.each(rows)("%s %s.%s is its token's literal", (theme, table, key) => {
    const token = CHART_TOKENS[table][key];
    expect((CHART_COLORS[theme][table] as Record<string, string>)[key]).toBe(literalOfIn(theme, token));
  });

  it.each(THEMES)("%s: every table has exactly the keys CHART_TOKENS names", (theme) => {
    for (const table of TABLES) {
      expect(Object.keys(CHART_COLORS[theme][table]).sort()).toEqual(Object.keys(CHART_TOKENS[table]).sort());
    }
  });

  it("STATE_COLORS covers exactly the soul states the API can send", () => {
    expect(Object.keys(CHART_TOKENS.STATE_COLORS).sort()).toEqual([...readSoulStates()].sort());
  });

  it("REALM_COLORS covers exactly the realm types the UI renders", () => {
    expect(Object.keys(CHART_TOKENS.REALM_COLORS).sort()).toEqual([...readRealmTypes()].sort());
  });

  it("no series is bound to a civilization (规范 v1 §1.8)", () => {
    expect(TABLES).not.toContain("CIVILIZATION_COLORS");
  });
});
