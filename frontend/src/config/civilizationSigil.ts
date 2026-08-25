// How each civilization numbers its own articles.
//
// WHY THIS IS TYPESCRIPT AND NOT CSS. The design note that produced this asked
// for a custom property, `--civ-sigil-style`, alongside the four `--color-civ-*`
// tokens. A stylesheet cannot produce any of the four strings below: `§ 27 / 42`
// needs a denominator that is a fact about the corpus, `卷`-style Han numerals
// need base-ten decomposition, roman numerals need subtractive notation, and a
// Stephanus page is not derivable from anything — it is transcribed. This is
// formatting logic wearing a style's clothes, so it lives with the other
// civilization facts instead.
//
// WHY IT IS HERE AND NOT IN THE COMPONENTS. The diagnosis behind that design
// note was right even though the address was wrong: a numbering rule spelled out
// at the point of render becomes four `civ === "GREEK" ? … : …` branches in four
// files, which is the exact shape `civilizations.ts` was written to end —
// "`WorkflowEditor` and `Modal` each wrote their own literal union". So the
// table below is keyed off `CIVILIZATION_SHORT_CODES` rather than off a fresh
// list of civilizations, and a civilization on one side and not the other shows
// up in `CIVILIZATIONS_WITH_NO_SIGIL` / `SIGILS_FOR_NO_CIVILIZATION`, which
// `civilizationSigilContract` holds at zero.
//
// THE TYPE ANNOTATION IS NOT WHAT HOLDS THAT, and this is worth saying because
// the annotation looks like it does. `tsconfig.json` sets `isolatedModules`, so
// ts-jest 29 transpiles without diagnostics: a deliberate `const x: number =
// "forty-two"` inserted into this file ran the whole suite to completion with
// only the value assertions failing. Whatever `Record<CivilizationOption, …>`
// below catches, it is caught by `npx tsc --noEmit` and by nothing the test run
// does. The runtime lists exist because a green suite is not a type check here.

import {
  CIVILIZATION_SHORT_CODES,
  type CivilizationOption,
} from "./civilizations";

/**
 * The Forty-Two. Not a display constant — the denominator is the doctrine.
 *
 * The Negative Confession is answered in full or it is not answered: the soul
 * declares innocence to each of the forty-two assessors, and forty-one
 * declarations is not a partial pass, it is no declaration. So the Egyptian
 * sigil prints `§ 27 / 42` and never `§ 27`. The number on the right is what
 * says the article is one of a closed set that must be completed, which is a
 * thing the other three systems do not claim about their own articles: an
 * Inferno circle is a place, a 功過格 門 is a heading, a Stephanus page is a
 * location in a book. Only this one is a tally against a required total.
 */
export const NEGATIVE_CONFESSION_TOTAL = 42;

/**
 * The parts of a `Statute` a sigil can be built from.
 *
 * Every field is optional because every field is optional in the payload it
 * comes from: `Statute.payload_json` is `Record<string, unknown>` on the wire
 * and each corpus fills a different subset of it. A formatter that cannot find
 * what its own system needs returns `null` rather than substituting something
 * that renders — see `formatSigil`.
 */
export interface StatuteRef {
  /** `Statute.ordinal`. Continuous within a corpus, 1-based. */
  readonly ordinal?: number;
  /**
   * `payload_json.gate` — the 門 a 功過格 article sits under (救濟門, 不仁門, …).
   *
   * NOT a 卷. 《太微仙君功過格》 has no scroll division; its two levels are the
   * 門 and the article's place within it, and the 門 arrives already written in
   * Chinese, so it is passed through rather than numbered.
   */
  readonly division?: string;
  /** `payload_json.circle` — the Inferno circle, 1–9. Absent on the seven terraces. */
  readonly circle?: number;
  /**
   * `payload_json.stephanus` — `"523a-b"`, `"614b"`. Transcribed, never derived.
   *
   * `backend/tests/test_greek_corpora.py` raises rather than skips when a Greek
   * article carries none, and this module refuses to fall back to `ordinal` for
   * the same reason: Plato is cited by page, and a Greek article's ordinal is an
   * artefact of the seeder's insertion order. Printing `22` where `621b` belongs
   * would be a number in the right place meaning nothing.
   */
  readonly stephanus?: string;
}

/** One civilization's numbering system. */
export interface SigilSpec {
  /** What the system is called, for a tooltip or an `aria-label`. */
  readonly system: string;
  /**
   * Whether this civilization's corpus names offences at all.
   *
   * `false` for GREEK alone, and it is a fact about Plato rather than about
   * seeding: twenty of the twenty-two Greek articles are `PROCEDURE`, because
   * neither the Gorgias myth nor the Myth of Er contains a code of offences.
   * They describe who judges, when, naked of the body, and what happens after —
   * court rules, not charges. A statute table for GREEK therefore carries one
   * column fewer than the other three, and this is the flag that says so.
   */
  readonly namesOffences: boolean;
  /** Build the sigil, or `null` when this ref lacks what the system requires. */
  readonly format: (ref: StatuteRef) => string | null;
}

const HAN_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 1–99 in Han numerals: 十七, 二十, 七十三.
 *
 * NINETY-NINE IS THE CEILING, on purpose and not by accident of the loop. The
 * corpus this serves is 《太微仙君功過格》 at 73 articles, whose largest 門 is
 * 不仁門 at 十五條; nothing in it reaches three digits. Writing the 百/千 forms
 * would mean writing the 零 placement rules (一百零五 against 一百五十) with no
 * data that exercises either, which is code that looks correct because nothing
 * ever asked it. Above 99 this returns `null` and the caller renders a miss,
 * the same as any other ref it cannot build — and `civilizationSigilContract`
 * pins 99 and 100 either side of the line so the bound stays a decision.
 */
export function toHanNumeral(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  if (n < 10) return HAN_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 1 ? "十" : `${HAN_DIGITS[tens]}十`;
  return `${tensPart}${HAN_DIGITS[ones]}`;
}

const ROMAN_TABLE = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
] as const;

/** 1–3999 in roman numerals, subtractive: IX, XXVI, MMMCMXCIX. */
export function toRomanNumeral(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
  let rest = n;
  let out = "";
  for (const [value, glyph] of ROMAN_TABLE) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

/** Both two-level systems join their levels the same way, so they say it once. */
const LEVEL_SEPARATOR = " · ";

/**
 * The four systems, written out.
 *
 * Typed `Record<CivilizationOption, SigilSpec>` rather than `Record<string, …>`
 * so that `npx tsc --noEmit` has something to say about a fifth civilization
 * added to `CIVILIZATION_OPTIONS` and never numbered here. That is a belt over
 * the braces and NOT the guard — see the note at the top of this file: the jest
 * run does not type-check, so nothing about this annotation was verified by the
 * green suite that accompanied it.
 *
 * The guard is `CIVILIZATIONS_WITH_NO_SIGIL` and `SIGILS_FOR_NO_CIVILIZATION`
 * below, which are computed from this table against `CIVILIZATION_SHORT_CODES`
 * at import and asserted empty in `civilizationSigilContract`. They are checked
 * against the short-code map rather than against `CivilizationOption` on
 * purpose: `civilizations.ts` holds three separate enumerations of the same four
 * members — `CIVILIZATION_OPTIONS`, `CIVILIZATION_CODES` and the map derived
 * from it — and a rule that reads only the one it is typed against cannot notice
 * those drifting apart from each other.
 */
const SIGIL_SPECS: Record<CivilizationOption, SigilSpec> = {
  /** 門 · 條, in Han numerals: 救濟門 · 十七. The 門 arrives already in Chinese. */
  CHINESE: {
    system: "功過格 門條",
    namesOffences: true,
    format: ({ ordinal, division }) => {
      if (ordinal === undefined) return null;
      const numeral = toHanNumeral(ordinal);
      if (numeral === null) return null;
      const gate = division?.trim();
      return gate ? `${gate}${LEVEL_SEPARATOR}${numeral}` : numeral;
    },
  },

  /**
   * Roman, circle first: `IX · XXVI` in the Inferno, bare `VII` on a terrace.
   *
   * The circle leads because it is the coarser division and because Dante's
   * own citation habit is by canto and circle, not by a running count. It is
   * absent on the seven terraces of Purgatorio, which are a different structure
   * — joining the nine circles to the seven terraces makes a chart that exists
   * nowhere in the poem — so a bare numeral is the correct output there, not a
   * degraded one.
   */
  EUROPEAN: {
    system: "Roman, circle first",
    namesOffences: true,
    format: ({ ordinal, circle }) => {
      if (ordinal === undefined) return null;
      const numeral = toRomanNumeral(ordinal);
      if (numeral === null) return null;
      if (circle === undefined) return numeral;
      const circleNumeral = toRomanNumeral(circle);
      if (circleNumeral === null) return null;
      return `${circleNumeral}${LEVEL_SEPARATOR}${numeral}`;
    },
  },

  /** `§ 27 / 42`. The denominator is required — see NEGATIVE_CONFESSION_TOTAL. */
  EGYPTIAN: {
    system: "§ n / 42",
    namesOffences: true,
    format: ({ ordinal }) => {
      if (ordinal === undefined) return null;
      if (!Number.isInteger(ordinal) || ordinal < 1) return null;
      if (ordinal > NEGATIVE_CONFESSION_TOTAL) return null;
      return `§ ${ordinal} / ${NEGATIVE_CONFESSION_TOTAL}`;
    },
  },

  /** The Stephanus page, verbatim. Never the ordinal — see `StatuteRef.stephanus`. */
  GREEK: {
    system: "Stephanus",
    namesOffences: false,
    format: ({ stephanus }) => {
      const page = stephanus?.trim();
      return page ? page : null;
    },
  },
};

/**
 * The same four specs, keyed off the civilization list rather than off itself.
 *
 * This is the runtime half of the same-source rule. `Object.keys` of
 * `CIVILIZATION_SHORT_CODES` is the enumeration; a spec that is not there does
 * not get an entry, and a civilization with no spec gets an entry whose value is
 * `undefined`. Neither is allowed to be discovered by a reader looking at a
 * blank badge, so `formatSigil` throws on the miss rather than returning
 * something printable, and `civilizationSigilContract` asserts the key sets
 * match in both directions before any of that can happen in production.
 */
export const CIVILIZATION_SIGILS: Record<string, SigilSpec> = Object.fromEntries(
  Object.keys(CIVILIZATION_SHORT_CODES).map((civilization) => [
    civilization,
    SIGIL_SPECS[civilization as CivilizationOption],
  ])
);

/**
 * The two ways the spec table and the civilization list can disagree, computed
 * rather than asserted, so that `civilizationSigilContract` can assert both are
 * empty and so the module itself carries the answer.
 *
 * WHY NOT JUST COMPARE `Object.keys(CIVILIZATION_SIGILS)` IN THE TEST. That
 * comparison cannot fail. `CIVILIZATION_SIGILS` is built by mapping over
 * `CIVILIZATION_SHORT_CODES`, so its key set is that key set by construction —
 * a spec written for a civilization nobody has heard of never appears in it,
 * and a civilization with no spec appears in it with the value `undefined`. The
 * derived record is the wrong witness for its own derivation. These two look at
 * the hand-written table directly, which is the thing that can actually drift.
 */
export const SIGILS_FOR_NO_CIVILIZATION: readonly string[] = Object.keys(
  SIGIL_SPECS
).filter((civilization) => !(civilization in CIVILIZATION_SHORT_CODES));

/** The other direction: a civilization the spec table has no numbering for. */
export const CIVILIZATIONS_WITH_NO_SIGIL: readonly string[] = Object.keys(
  CIVILIZATION_SHORT_CODES
).filter(
  (civilization) => SIGIL_SPECS[civilization as CivilizationOption] === undefined
);

function specFor(civilization: string): SigilSpec {
  const spec = CIVILIZATION_SIGILS[civilization];
  if (spec === undefined) {
    throw new Error(
      `No numbering system for civilization "${civilization}". Every ` +
        `civilization in CIVILIZATION_OPTIONS needs an entry in SIGIL_SPECS ` +
        `(src/config/civilizationSigil.ts) — a numbering rule cannot be ` +
        `defaulted, because each of the four is a claim about a different ` +
        `document.`
    );
  }
  return spec;
}

/**
 * Render one article's sigil in its own civilization's numbering.
 *
 * Returns `null` when this ref does not carry what the system needs — a Greek
 * article with no transcribed Stephanus page, a 功過格 ordinal past 99, an
 * Egyptian ordinal outside the Forty-Two. `null` means "there is no sigil for
 * this", which callers render as a miss; it never means "use the ordinal
 * instead", because three of the four systems do not number by ordinal at all.
 *
 * Throws for a civilization with no numbering system at all, which is a
 * programming error rather than missing data.
 */
export function formatSigil(civilization: string, ref: StatuteRef): string | null {
  return specFor(civilization).format(ref);
}

/** What to call this civilization's numbering, for a label or a tooltip. */
export function sigilSystemName(civilization: string): string {
  return specFor(civilization).system;
}

/**
 * Does this civilization's corpus name offences?
 *
 * `false` for GREEK, which is why its statute table has one column fewer. Ask
 * this rather than testing `civilization === "GREEK"` at the call site: the
 * question is about what a corpus contains, and a fifth civilization that also
 * happens not to enumerate offences would silently get the wrong table under an
 * identity check.
 */
export function civilizationNamesOffences(civilization: string): boolean {
  return specFor(civilization).namesOffences;
}
