/**
 * Every member the backend can send must have copy in every bundle.
 *
 * Written the way `civilizationCopyCoverage.test.ts` is written, and for the
 * same reason: three-bundle parity asks whether the bundles agree with each
 * other, and three bundles that are all missing the same key agree perfectly.
 * This asks whether they agree with the member list the wire actually carries.
 *
 * Split out of `SoulReadingPanel.test.tsx`, which renders the panels these
 * keys feed.
 *
 * Each sweep below ends in `expect(missing).toEqual([])` — an absence, which
 * is also what a sweep over an empty list reports. So each one collects the
 * keys it actually visited and states that count as well, and every count is a
 * number read off `packages/core/src/api/ledger.ts` rather than one that seemed safe.
 */
import {
  POENA_MISSING_INPUTS,
  SENTENCE_MISSING_INPUTS,
  UNAVAILABLE_REASON_CODES,
} from "@soulledger/core/api/ledger";

import { assertScanned } from "./support/soulReadingFixtures";

import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zhHans from "@soulledger/core/messages/zh-Hans.json";

const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** The fixed keys the two panels read, none of them derived from a member. */
const FIXED_KEYS = [
  "souls.detail.reading.sentence_repayment_rule",
  "souls.detail.reading.sentence_owed_label",
  "souls.detail.reading.sentence_owed_detail",
  "souls.detail.reading.sentence_requited_label",
  "souls.detail.reading.sentence_requited_detail",
  "souls.detail.reading.sentence_circuit",
  "souls.detail.reading.sentence_elapsed_label",
  "souls.detail.reading.sentence_elapsed_years",
  "souls.detail.reading.elapsed_unavailable_heading",
  "souls.detail.reading.unrenderable_kind",
];

// Stated at module scope, because `it.each([])` registers no tests and so
// cannot guard its own list: an emptied BUNDLES would delete fifteen tests and
// report only a smaller count. Measured against `messages/`: en, zh-Hans, egy.
assertScanned("locale bundles enumerated", Object.keys(BUNDLES).length, 3);
// And the member lists every sweep below iterates. Measured at 3 / 2 / 1 / 10.
assertScanned("poena members", POENA_MISSING_INPUTS.length, 3);
assertScanned("sentence members", SENTENCE_MISSING_INPUTS.length, 2);
assertScanned("unavailable reason codes", UNAVAILABLE_REASON_CODES.length, 1);
assertScanned("fixed panel keys", FIXED_KEYS.length, 10);

function at(bundle: unknown, path: string): unknown {
  let node: unknown = bundle;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** The keys in `bundle` that hold no usable string. Also reports what it read. */
function absentKeys(bundle: unknown, keys: string[]): { missing: string[]; checked: number } {
  const missing: string[] = [];
  for (const key of keys) {
    const value = at(bundle, key);
    if (typeof value !== "string" || value.trim() === "") missing.push(key);
  }
  return { missing, checked: keys.length };
}

describe("reading copy coverage", () => {
  it.each(Object.keys(BUNDLES))("%s has a bullet for every poena_missing member", (locale) => {
    // The key is built exactly the way SoulReadingPanel builds it. Spelling
    // it out a second way here would let the two drift and this test would
    // certify a key nothing renders.
    const keys = POENA_MISSING_INPUTS.map(
      (member) => `souls.detail.reading.poena_missing_${member.toLowerCase()}`
    );
    const { missing, checked } = absentKeys(BUNDLES[locale], keys);

    expect(checked).toBe(3);
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s has a bullet for every elapsed_missing member", (locale) => {
    const keys = SENTENCE_MISSING_INPUTS.map(
      (member) => `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`
    );
    const { missing, checked } = absentKeys(BUNDLES[locale], keys);

    expect(checked).toBe(2);
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s has the fixed copy the two panels need", (locale) => {
    // The SENTENCE panel's own labels, and the notice the `default` branch
    // renders. Not derived from a member list, so nothing else would miss them
    // — and a bundle without them renders a raw key where a label goes.
    const { missing, checked } = absentKeys(BUNDLES[locale], FIXED_KEYS);

    expect(checked).toBe(10);
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s keeps the interpolations the panels pass", (locale) => {
    // `{{multiple}}`, `{{years}}` and `{{kind}}` are the numbers and the value
    // the copy is *about*. A translation that drops the placeholder reads as a
    // complete sentence and states nothing — the failure mode a missing key
    // does not have, because a missing key at least shows itself.
    const bundle = BUNDLES[locale];
    // The multiple now has exactly one home — the apex of the fork — because
    // 615b gives both roads the same measure and a fact drawn twice is two
    // copies free to drift. It still has to be interpolated there.
    expect(at(bundle, "souls.detail.reading.sentence_repayment_rule")).toContain("{{multiple}}");
    expect(at(bundle, "souls.detail.reading.sentence_circuit")).toContain("{{years}}");
    // The served figure is the number this copy is *about*. A translation that
    // drops the placeholder reads as a complete phrase and states nothing —
    // and here it would state nothing in the slot an em-dash used to occupy,
    // i.e. it would look exactly like the absence it replaced.
    expect(at(bundle, "souls.detail.reading.sentence_elapsed_years")).toContain("{{years}}");
    expect(at(bundle, "souls.detail.reading.unrenderable_kind")).toContain("{{kind}}");

    // The other half of what the two road captions used to be asserted for, and
    // the half that actually mattered: a translation that hard-codes "10" is a
    // second copy of a constant, which is how the frontend's 20/100 came to
    // disagree with the backend's inheritance rates. The captions no longer
    // carry the multiple at all, so neither may carry a digit — a placeholder
    // that moved to the apex must not leave a literal behind.
    for (const key of [
      "souls.detail.reading.sentence_owed_detail",
      "souls.detail.reading.sentence_requited_detail",
    ]) {
      expect(at(bundle, key)).not.toMatch(/\d/);
      expect(at(bundle, key)).not.toContain("{{multiple}}");
    }
  });

  it.each(Object.keys(BUNDLES))("%s has an explanation and a CTA for every reason code", (locale) => {
    const keys = UNAVAILABLE_REASON_CODES.flatMap((code) =>
      ["explanation", "cta"].map(
        (suffix) => `souls.detail.reading.unavailable_${code.toLowerCase()}_${suffix}`
      )
    );
    const { missing, checked } = absentKeys(BUNDLES[locale], keys);

    expect(checked).toBe(2);
    expect(missing).toEqual([]);
  });

  it("does not let a member's copy be the raw member", () => {
    // The other way to make the two tests above green without saying anything:
    // `"poena_missing_absolution": "ABSOLUTION"`. Copy that repeats its member
    // is the untranslated value reaching the screen by a second route.
    const offenders: string[] = [];
    let checked = 0;

    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      for (const member of POENA_MISSING_INPUTS) {
        const key = `souls.detail.reading.poena_missing_${member.toLowerCase()}`;
        checked += 1;
        if (at(bundle, key) === member) offenders.push(`${locale}:${key}`);
      }
      for (const member of SENTENCE_MISSING_INPUTS) {
        const key = `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`;
        checked += 1;
        if (at(bundle, key) === member) offenders.push(`${locale}:${key}`);
      }
      for (const code of UNAVAILABLE_REASON_CODES) {
        for (const suffix of ["explanation", "cta"]) {
          const key = `souls.detail.reading.unavailable_${code.toLowerCase()}_${suffix}`;
          checked += 1;
          if (at(bundle, key) === code) offenders.push(`${locale}:${key}`);
        }
      }
    }

    // 3 locales × (3 poena + 2 elapsed + 2 unavailable).
    expect(checked).toBe(21);
    expect(offenders).toEqual([]);
  });

  it("keeps the codeless keys gone, so a second reason code cannot inherit this one's copy", () => {
    // `unavailable_explanation` / `unavailable_cta` are what the panel read
    // before the code existed. Leaving them behind would be harmless today and
    // exactly the trap `ledger.civ.UNKNOWN` was: a plausible fallback waiting
    // for the next member to fall into it.
    const bundles = Object.values(BUNDLES);
    assertScanned("bundles swept for codeless leftovers", bundles.length, 3);
    for (const bundle of bundles) {
      expect(at(bundle, "souls.detail.reading.unavailable_explanation")).toBeUndefined();
      expect(at(bundle, "souls.detail.reading.unavailable_cta")).toBeUndefined();
    }
  });
});
