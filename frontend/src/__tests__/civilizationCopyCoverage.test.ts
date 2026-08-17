/**
 * Every civilization must have copy in every bundle, in every namespace that
 * names civilizations.
 *
 * This exists because of how the gap it guards was found. `48a5e74` added GREEK
 * as a fourth civilization and inserted it into the five `*.civilizations`
 * blocks — but not into `ledger.civ`, which is a sixth namespace doing the same
 * job under a different key. Nothing failed. A Greek soul's ledger heading fell
 * through `tf()` to `ledger.civ.UNKNOWN` and rendered 「功过记录 / Deed Record」,
 * which is a real string, in the right language, in the right place. There was
 * no missing-key marker to notice, because a fallback had been supplied for the
 * case of an unrecognised civilization and GREEK quietly became one.
 *
 * The three-bundle parity check that already exists cannot catch this: parity
 * asks whether the bundles agree with each other, and all three agreed —
 * all three were missing GREEK. This asks a different question, whether they
 * agree with `CIVILIZATION_OPTIONS`, which is the list the application actually
 * routes on.
 *
 * UNKNOWN is deliberately not in that list, and is required below only of
 * `ledger.civ`, which is the only one of the six that has it. That asymmetry is
 * the point rather than an oversight: `ledger.civ` is read through `tf()` with
 * `ledger.civ.UNKNOWN` as an explicit fallback, so it is the namespace where a
 * missing civilization renders as plausible copy instead of as a visible miss.
 * The other five have no fallback and would show the key, which is ugly and
 * therefore self-reporting.
 */
import en from "../../messages/en.json";
import egy from "../../messages/egy.json";
import zhHans from "../../messages/zh-Hans.json";
import { CIVILIZATION_OPTIONS } from "../config/civilizations";

const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** Every namespace whose keys are civilization members. `ledger.civ` is the
 *  odd one out by name and was the one that got missed; it is listed here so
 *  that being differently named stops being a way to be forgotten. */
const CIVILIZATION_NAMESPACES = [
  "souls.civilizations",
  "workflow.civilizations",
  "realms.civilizations",
  "organization.civilizations",
  "actors.civilizations",
  "ledger.civ",
];

function at(bundle: unknown, path: string): Record<string, unknown> | undefined {
  let node: unknown = bundle;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "object" && node !== null
    ? (node as Record<string, unknown>)
    : undefined;
}

describe("civilization copy coverage", () => {
  it.each(Object.keys(BUNDLES))("%s names every civilization everywhere", (locale) => {
    const bundle = BUNDLES[locale];
    const missing: string[] = [];

    for (const namespace of CIVILIZATION_NAMESPACES) {
      const block = at(bundle, namespace);
      expect(block).toBeDefined();

      for (const civilization of CIVILIZATION_OPTIONS) {
        const value = block?.[civilization];
        if (typeof value !== "string" || value.trim() === "") {
          missing.push(`${namespace}.${civilization}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s keeps ledger.civ.UNKNOWN for the unrecognised", (locale) => {
    // Absence of a civilization must not be met by deleting the fallback
    // either. These two assertions pull in opposite directions on purpose:
    // the one above forbids relying on UNKNOWN for a known civilization, this
    // one keeps it available for a genuinely unknown one.
    expect(typeof at(BUNDLES[locale], "ledger.civ")?.UNKNOWN).toBe("string");
  });

  it("does not let a civilization's copy be the raw enum member", () => {
    // The other way to make the first test green without saying anything:
    // `"GREEK": "GREEK"`. Copy that repeats the key is the untranslated value
    // reaching the screen by another route — the same defect
    // soulLifecycleRows had, where a raw state was printed beside its label.
    const offenders: string[] = [];

    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      for (const namespace of CIVILIZATION_NAMESPACES) {
        const block = at(bundle, namespace);
        for (const civilization of CIVILIZATION_OPTIONS) {
          if (block?.[civilization] === civilization) {
            offenders.push(`${locale}:${namespace}.${civilization}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
