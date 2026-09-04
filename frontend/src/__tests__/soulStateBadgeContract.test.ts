/**
 * Every soul lifecycle state gets its OWN colour, and it is the colour named
 * after it.
 *
 * WHY THIS FILE EXISTS. `app/souls/page.tsx` and `app/souls/[id]/page.tsx` each
 * carried a `STATE_COLORS` map; `diff` of the two ranges exited 0. Both painted
 * DISPOSED and LOST with the identical `--color-surface-3` / `--color-ink-muted`
 * pair, so two of six states were indistinguishable from each other and from a
 * state the UI does not recognise — while `--color-status-disposed` and
 * `--color-status-lost` sat declared in globals.css and used by neither page.
 * `app/ledger/page.tsx::STATE_DOT` had the same defect, was fixed, and the fix
 * reached neither copy.
 *
 * The distinctness assertion is the one that would have caught it, and it is
 * the one a value-by-value review keeps missing: nothing looks wrong about a
 * line that holds a valid class string.
 *
 * NO CLASS NAME IS WRITTEN OUT IN THIS FILE. tailwind.config.js scans
 * `./src/**` — tests included — so a utility spelled here becomes a real CSS
 * rule. The utilities are parsed apart instead, the way
 * `statusTokenLayering.test.ts` does it and for the same reason.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SOUL_STATE_BADGE_CLASSES,
  UNKNOWN_SOUL_STATE_BADGE_CLASS,
  soulStateBadgeClass,
} from "@/src/lib/soulStateBadge";
import { ROOT_TOKENS, readSoulStates } from "./support/globalsCssTokens";

/** `{utility: [token, alpha]}` for every `x-[hsl(var(--t)/a)]` in a class string. */
function utilities(classes: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const m of classes.matchAll(/(\w[\w-]*)-\[hsl\(var\((--[\w-]+)\)(?:\/([\d.]+))?\)\]/g)) {
    out[m[1]] = [m[2], m[3] ?? "1"];
  }
  return out;
}

const STATES = readSoulStates();

describe("the table covers the states the API can actually send", () => {
  it("has exactly the `Soul.current_state` union as its keys", () => {
    // Read out of packages/core/src/api/souls.ts rather than listed here: a
    // seventh state added to the contract has to be given a colour, not
    // silently fall to the unknown-state fill.
    expect(Object.keys(SOUL_STATE_BADGE_CLASSES).sort()).toEqual([...STATES].sort());
    expect(STATES.length).toBe(6);
  });
});

describe("no two states share a colour", () => {
  it("gives all six distinct classes", () => {
    // THE DEFECT. DISPOSED and LOST held the same string in both copies of this
    // table, so 已处置 and 迷失 rendered identically.
    const values = Object.values(SOUL_STATE_BADGE_CLASSES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives all six distinct tokens, not just distinct strings", () => {
    // The stronger half: two states could differ only in tint depth while
    // naming one token, which is the same defect wearing different arithmetic.
    const inks = Object.values(SOUL_STATE_BADGE_CLASSES).map((c) => utilities(c).text[0]);
    expect(new Set(inks).size).toBe(inks.length);
  });
});

describe("each state wears the token named after it", () => {
  it.each(readSoulStates())("%s", (state) => {
    const token = `--color-status-${state.toLowerCase()}`;
    // Declared in globals.css, read through the one parser. An undefined
    // custom property drops the whole declaration with no error anywhere.
    expect(ROOT_TOKENS[token]).toBeDefined();

    const found = utilities(SOUL_STATE_BADGE_CLASSES[state as keyof typeof SOUL_STATE_BADGE_CLASSES]);
    // Equality, not "contains": "the right token is present" stays true while
    // the wrong one sits beside it.
    expect(found.bg).toEqual([token, "0.1"]);
    expect(found.text).toEqual([token, "1"]);
    expect(Object.keys(found).sort()).toEqual(["bg", "text"]);
  });
});

describe("the unknown-state fill is not one of the six", () => {
  it("names neither a lifecycle token nor any state's colour", () => {
    expect(Object.values(SOUL_STATE_BADGE_CLASSES)).not.toContain(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    for (const [, [token]] of Object.entries(utilities(UNKNOWN_SOUL_STATE_BADGE_CLASS))) {
      expect(ROOT_TOKENS[token]).toBeDefined();
      expect(token.startsWith("--color-status-")).toBe(false);
    }
  });

  it("is what an absent or unrecognised state resolves to", () => {
    // The detail page used to fall back to `"ALIVE"`, so a soul that failed to
    // load wore a living soul's green beside the words for 「未记录」.
    expect(soulStateBadgeClass(undefined)).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    expect(soulStateBadgeClass(null)).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    expect(soulStateBadgeClass("ASCENDED")).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
    expect(soulStateBadgeClass("alive")).toBe(UNKNOWN_SOUL_STATE_BADGE_CLASS);
  });

  it("still resolves every real state to that state's classes", () => {
    for (const state of STATES) {
      expect(soulStateBadgeClass(state)).toBe(
        SOUL_STATE_BADGE_CLASSES[state as keyof typeof SOUL_STATE_BADGE_CLASSES]
      );
    }
  });
});

describe("the two pages read this table rather than carrying their own", () => {
  it.each(["app/souls/page.tsx", "app/souls/[id]/page.tsx"])("%s declares no state colour map", (file) => {
    // The merge is the thing that made the collapse visible; a copy growing
    // back would hide it again, and neither page would fail anything.
    const source = readFileSync(path.join(__dirname, "..", "..", file), "utf8");
    expect(source).not.toMatch(/^const STATE_COLORS\b/m);
    expect(source).toContain("soulStateBadgeClass");
  });
});
