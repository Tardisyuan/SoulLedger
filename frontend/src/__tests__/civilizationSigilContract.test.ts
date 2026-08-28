import {
  CIVILIZATION_SHORT_CODES,
  CIVILIZATION_OPTIONS,
} from "@/src/config/civilizations";
import {
  CIVILIZATIONS_WITH_NO_SIGIL,
  CIVILIZATION_SIGILS,
  NEGATIVE_CONFESSION_TOTAL,
  SIGILS_FOR_NO_CIVILIZATION,
  civilizationNamesOffences,
  formatSigil,
  sigilSystemName,
  toHanNumeral,
  toRomanNumeral,
} from "@/src/config/civilizationSigil";

/**
 * Each civilization numbers its own articles, and the four ways of numbering
 * are held against the one list of civilizations.
 *
 * WHAT THIS IS FOR. `src/config/civilizationSigil.ts` is a table keyed by
 * civilization, which is the shape `civilizationMapCoverage` already exists to
 * police — with one difference that makes a second file worth it rather than a
 * sixth row over there. Those maps hold strings: an icon, a colour, a heading.
 * A missing key costs a blank badge. This one holds *functions*, and a missing
 * key costs a thrown error at render or, worse, a number formatted by the wrong
 * system — a Stephanus page where a 門 belongs, or `§ 27` with the denominator
 * dropped, both of which are legible, plausible and wrong. So the assertions
 * here go past key coverage into what each formatter actually produces.
 *
 * THE ASSERTION THAT DOES NOT WORK, recorded because it is the obvious one.
 * `expect(Object.keys(CIVILIZATION_SIGILS)).toEqual(Object.keys(
 * CIVILIZATION_SHORT_CODES))` cannot fail: `CIVILIZATION_SIGILS` is built by
 * mapping over `CIVILIZATION_SHORT_CODES`, so it has those keys whatever the
 * spec table says — a civilization with no spec gets the key and the value
 * `undefined`. That is a check that is green because of how it is wired, not
 * because of what is true, which is this repository's recurring failure shape.
 * The module exports the two difference lists instead, computed against the
 * hand-written table, and those are what is asserted below.
 */

describe("the contract is looking at something", () => {
  // Without this floor every `it.each` below runs zero cases and reports green.
  it("has four civilizations to number", () => {
    expect(CIVILIZATION_OPTIONS.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(CIVILIZATION_SHORT_CODES)).toHaveLength(
      CIVILIZATION_OPTIONS.length
    );
  });
});

describe("the sigil table and the civilization list are the same set", () => {
  it("has a numbering system for every civilization", () => {
    // A fifth civilization added to `civilizations.ts` and not here. The cost
    // is `formatSigil` throwing on that civilization's statute rows — which is
    // loud, but only once someone opens that page.
    expect(CIVILIZATIONS_WITH_NO_SIGIL).toEqual([]);
  });

  it("has no numbering system for a civilization that does not exist", () => {
    // The other direction, which matters more than it looks: a civilization
    // removed or renamed in `civilizations.ts` leaves its spec here, unreachable
    // and unread, and the next reader takes the stale entry for a live one.
    expect(SIGILS_FOR_NO_CIVILIZATION).toEqual([]);
  });

  it("resolves an actual spec, not an undefined, for each civilization", () => {
    // Key coverage alone would pass on `{ GREEK: undefined }`. This is the
    // assertion that the derived record is populated rather than merely keyed.
    for (const civilization of CIVILIZATION_OPTIONS) {
      const spec = CIVILIZATION_SIGILS[civilization];
      expect(spec).toBeDefined();
      expect(typeof spec.format).toBe("function");
      expect(sigilSystemName(civilization).trim()).not.toBe("");
    }
  });

  it("refuses a civilization it has never heard of", () => {
    expect(() => formatSigil("NORDIC", { ordinal: 1 })).toThrow(/NORDIC/);
  });
});

describe("Han numerals, to the ceiling the 功過格 needs and one past it", () => {
  it.each([
    [1, "一"],
    [9, "九"],
    [10, "十"],
    [11, "十一"],
    // 不仁門 is titled 十五條 — the largest 門 in the corpus.
    [15, "十五"],
    [17, "十七"],
    [20, "二十"],
    [30, "三十"],
    // 《太微仙君功過格》 is 73 articles. This is the number that has to be right.
    [73, "七十三"],
    [99, "九十九"],
  ])("%i is %s", (n, expected) => {
    expect(toHanNumeral(n)).toBe(expected);
  });

  it.each([0, -1, 100, 1.5, NaN])("%p has no Han form here", (n) => {
    // 100 is the documented ceiling, asserted so that raising it is a decision
    // rather than something a loop quietly starts doing.
    expect(toHanNumeral(n)).toBeNull();
  });
});

describe("roman numerals, to the ceiling the Inferno needs", () => {
  it.each([
    [1, "I"],
    [4, "IV"],
    // The seven terraces of Purgatorio.
    [7, "VII"],
    // The ninth and deepest circle.
    [9, "IX"],
    // The Inferno corpus is 26 articles.
    [26, "XXVI"],
    [40, "XL"],
    [90, "XC"],
    [3999, "MMMCMXCIX"],
  ])("%i is %s", (n, expected) => {
    expect(toRomanNumeral(n)).toBe(expected);
  });

  it.each([0, -1, 4000, 2.5, NaN])("%p has no roman form", (n) => {
    expect(toRomanNumeral(n)).toBeNull();
  });
});

describe("中國 · 功過格 numbers by 門 and 條, in Han", () => {
  it("puts the 門 first and the article in Han numerals", () => {
    expect(formatSigil("CHINESE", { gateOrdinal: 17, division: "救濟門" })).toBe(
      "救濟門 · 十七"
    );
  });

  it("prints the last article of the corpus", () => {
    expect(formatSigil("CHINESE", { gateOrdinal: 73, division: "不軌門" })).toBe(
      "不軌門 · 七十三"
    );
  });

  it("prints the numeral alone when no 門 is carried", () => {
    expect(formatSigil("CHINESE", { gateOrdinal: 17 })).toBe("十七");
    expect(formatSigil("CHINESE", { gateOrdinal: 17, division: "  " })).toBe("十七");
  });

  it("never prints an arabic numeral", () => {
    // The whole point of this civilization's system. A digit reaching the
    // screen means the Han conversion was skipped, not that it failed.
    for (let gateOrdinal = 1; gateOrdinal <= 73; gateOrdinal += 1) {
      expect(formatSigil("CHINESE", { gateOrdinal, division: "救濟門" })).not.toMatch(
        /[0-9]/
      );
    }
  });

  it("has nothing to print without an ordinal", () => {
    expect(formatSigil("CHINESE", { division: "救濟門" })).toBeNull();
    // And an `ordinal` is not a substitute for the missing `gateOrdinal`.
    // 門 are contiguous ranges of the corpus-wide count — 救濟門 is ordinals
    // 1–11 — so falling back would print 教典門 · 十七 for a 門 whose heading
    // says it holds seven. A number in the right place meaning nothing is
    // worse than no number: MissingValue says "not recorded", 十七 asserts.
    expect(formatSigil("CHINESE", { ordinal: 17, division: "教典門" })).toBeNull();
  });
});

describe("歐洲 · Inferno numbers in roman, circle first", () => {
  it("leads with the circle when the article sits in one", () => {
    expect(formatSigil("EUROPEAN", { ordinal: 26, circle: 9 })).toBe("IX · XXVI");
  });

  it("prints a bare numeral on a terrace, which has no circle", () => {
    // Purgatorio's seven terraces are a different structure from the nine
    // circles; a missing circle here is the correct state, not a gap.
    expect(formatSigil("EUROPEAN", { ordinal: 7 })).toBe("VII");
  });

  it("never prints an arabic numeral", () => {
    for (let ordinal = 1; ordinal <= 26; ordinal += 1) {
      expect(formatSigil("EUROPEAN", { ordinal, circle: 9 })).not.toMatch(/[0-9]/);
    }
  });

  it("has nothing to print without an ordinal", () => {
    expect(formatSigil("EUROPEAN", { circle: 3 })).toBeNull();
  });
});

describe("埃及 · the Negative Confession prints its denominator", () => {
  it("is 42, and that is doctrine rather than a display choice", () => {
    expect(NEGATIVE_CONFESSION_TOTAL).toBe(42);
  });

  it("renders § n / 42", () => {
    expect(formatSigil("EGYPTIAN", { ordinal: 27 })).toBe("§ 27 / 42");
  });

  it("carries the denominator on every one of the Forty-Two", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The Confession is answered in full or
    // it is not answered — forty-one declarations is not a partial pass. A
    // sigil reading `§ 27` has dropped the only part that says the article
    // belongs to a closed set that must be completed, and it would still look
    // like a perfectly good reference. Asserting the presence of `27` would
    // stay green while `42` went missing beside it, so the whole string is
    // pinned.
    for (let ordinal = 1; ordinal <= NEGATIVE_CONFESSION_TOTAL; ordinal += 1) {
      const sigil = formatSigil("EGYPTIAN", { ordinal });
      expect(sigil).toBe(`§ ${ordinal} / ${NEGATIVE_CONFESSION_TOTAL}`);
      expect(sigil).toContain(`/ ${NEGATIVE_CONFESSION_TOTAL}`);
    }
  });

  it("has nothing to print outside the Forty-Two", () => {
    expect(formatSigil("EGYPTIAN", { ordinal: 0 })).toBeNull();
    expect(formatSigil("EGYPTIAN", { ordinal: 43 })).toBeNull();
    expect(formatSigil("EGYPTIAN", {})).toBeNull();
  });
});

describe("希臘 · Plato is cited by Stephanus page and by nothing else", () => {
  it.each([
    ["523a-b", "523a-b"],
    ["614b", "614b"],
    ["621b", "621b"],
  ])("prints %s verbatim", (stephanus, expected) => {
    expect(formatSigil("GREEK", { stephanus })).toBe(expected);
  });

  it("does not fall back to the ordinal when the page is missing", () => {
    // The failure this forbids: a Greek article whose transcription carries no
    // `payload_json.stephanus` rendering as `22`, which is a number in the
    // right place that refers to nothing — the Greek ordinals are the seeder's
    // insertion order, not a citation. `backend/tests/test_greek_corpora.py`
    // raises on that same missing key rather than skipping; this is the
    // frontend half of the same refusal.
    expect(formatSigil("GREEK", { ordinal: 22 })).toBeNull();
    expect(formatSigil("GREEK", { ordinal: 22, stephanus: "   " })).toBeNull();
    expect(formatSigil("GREEK", { ordinal: 22, circle: 9, division: "救濟門" })).toBeNull();
  });

  it("prints the page and not the ordinal when it has both", () => {
    // Assert the absence as well as the presence: the right value being shown
    // stays true while the wrong one sits beside it.
    const sigil = formatSigil("GREEK", { ordinal: 22, stephanus: "621b" });
    expect(sigil).toBe("621b");
    expect(sigil).not.toContain("22");
  });
});

describe("only the Greek corpus declines to name offences", () => {
  it("is false for GREEK and true for the other three", () => {
    // 21 of the 23 Greek articles are PROCEDURE: neither Platonic
    // myth contains a code of offences, so the Greek statute table carries one
    // column fewer. This flag is that fact, and the table reads it instead of
    // testing `civilization === "GREEK"`.
    expect(civilizationNamesOffences("GREEK")).toBe(false);
    expect(civilizationNamesOffences("CHINESE")).toBe(true);
    expect(civilizationNamesOffences("EUROPEAN")).toBe(true);
    expect(civilizationNamesOffences("EGYPTIAN")).toBe(true);
  });

  it("is false for exactly one civilization", () => {
    // The claim being made is "one table has one column fewer". If a second
    // civilization ever answers false, that claim has changed and the layout
    // decision resting on it needs revisiting rather than silently applying
    // twice.
    const silent = CIVILIZATION_OPTIONS.filter(
      (civilization) => !civilizationNamesOffences(civilization)
    );
    expect(silent).toEqual(["GREEK"]);
  });
});

describe("the four systems are four systems", () => {
  it("gives no two civilizations the same sigil for the same ref", () => {
    // A table where two entries had accidentally been given the same formatter
    // would pass every coverage check above. The premise of the whole design is
    // that the numbering is the civilization marker, which requires the four to
    // be distinguishable on sight.
    const ref = { ordinal: 7, circle: 9, division: "救濟門", stephanus: "614b" };
    const rendered = CIVILIZATION_OPTIONS.map((civilization) =>
      formatSigil(civilization, ref)
    );
    expect(new Set(rendered).size).toBe(CIVILIZATION_OPTIONS.length);
  });
});
