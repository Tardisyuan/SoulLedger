/**
 * The same question `readingQuantityContract` asks of the four cosmology
 * panels, asked of the two places the answer was missing: the raw/decayed
 * breakdown directly beneath them, and the judgment queue's triage card.
 *
 * This file is the declarations half — the four classification tables, and
 * whether they agree with each other. The DOM half, which renders the two
 * components and inventories every figure they draw, is
 * `ledgerQuantityContract.render.test.tsx`; the payloads both halves use are in
 * `support/ledgerQuantityFixtures.ts`. Split for the 500-line rule, along the
 * one seam that costs nothing: nothing below renders anything.
 *
 * Why a second file and not more of the first
 * -------------------------------------------
 * The sibling file is about `LedgerReading` — one wire type, indexed by `kind`,
 * with `READING_QUANTITIES` as its declaration. Everything here is about three
 * *other* wire types: `LedgerSummary`, `LedgerInheritance` and `LedgerRecord`,
 * each with a table of its own. Merging the two would have meant one file
 * describing four payloads and, worse, one classification object indexed two
 * ways — see `SUMMARY_QUANTITIES` for why that costs the compile-time half of
 * the guarantee.
 *
 * The seam this file exists for
 * -----------------------------
 * Four tables mean the same quantity is classified four times. `merit` in the
 * Chinese reading, `merit_score` in the summary the queue and the card both
 * draw, `inherited_merit` in the next-life preview, `original_weight` in the
 * row those raw sums are made of — all sums of `SoulRecord.weight`, all
 * magnitudes, and nothing in `Record<NumericFields<T>, QuantityKind>` makes any
 * two of them agree. Demote one and half the numbers on the soul detail page
 * lose their scale marker while every per-table check stays green. So the
 * agreement is asserted (`QUANTITY_ALIASES`), and the answer they must agree on
 * is stated separately and literally, because three tables agreeing on the
 * wrong kind is not a way to pass.
 *
 * What is deliberately not derived
 * --------------------------------
 * The kinds below are written out. A test that reads its expectation out of the
 * thing under test endorses whatever the thing under test says, including the
 * classification a review rejected. Same rule as the sibling file, same reason.
 */
import {
  INHERITANCE_QUANTITIES,
  QUANTITY_ALIASES,
  QUANTITY_KINDS,
  RECORD_QUANTITIES,
  SUMMARY_QUANTITIES,
  readingQuantityOf,
} from "@/lib/api/ledgerQuantities";

import {
  INHERITANCE,
  QUEUE_LEDGER,
  RECORDS,
  numericFieldsOf,
} from "./support/ledgerQuantityFixtures";

// ---------------------------------------------------------------------------
// Each table against the payload it classifies
// ---------------------------------------------------------------------------

describe("the non-reading tables classify exactly their payload's numbers", () => {
  it("SUMMARY_QUANTITIES covers LedgerSummary's four", () => {
    expect(Object.keys(SUMMARY_QUANTITIES).sort()).toEqual(
      ["demerit_score", "karmic_balance", "merit_score", "record_count"]
    );
  });

  it("SUMMARY_QUANTITIES also covers the queue payload, which is the same body typed twice", () => {
    // `QUEUE_LEDGER_NUMBERS_ARE_SUMMARY_NUMBERS` is the compile-time half; this
    // is the run-time one, for whoever silences the compiler. The triage card
    // reads `SUMMARY_QUANTITIES` for numbers that arrive as `QueueLedger`, and
    // that is only legitimate while the two carry the same names.
    expect(numericFieldsOf(QUEUE_LEDGER)).toEqual(Object.keys(SUMMARY_QUANTITIES).sort());
  });

  it("INHERITANCE_QUANTITIES covers the preview's two sums and two rates", () => {
    expect(numericFieldsOf(INHERITANCE)).toEqual(Object.keys(INHERITANCE_QUANTITIES).sort());
  });

  it("RECORD_QUANTITIES covers one ledger row's four", () => {
    expect(numericFieldsOf(RECORDS[0])).toEqual(Object.keys(RECORD_QUANTITIES).sort());
  });

  it("invents no fifth kind", () => {
    const tables = [SUMMARY_QUANTITIES, INHERITANCE_QUANTITIES, RECORD_QUANTITIES];

    // The floor for the loop below. Three empty tables satisfy "no value is
    // outside QUANTITY_KINDS" perfectly, and a table that stopped being
    // exported would arrive here as `{}` rather than as an error — the shape
    // this whole directory keeps being caught by.
    const classified = tables.flatMap((table) => Object.values(table));
    expect(classified.length).toBeGreaterThanOrEqual(12);
    expect(QUANTITY_KINDS.length).toBeGreaterThanOrEqual(4);

    for (const table of tables) {
      for (const quantity of Object.values(table)) {
        expect([...QUANTITY_KINDS]).toContain(quantity);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The four tables against each other
// ---------------------------------------------------------------------------

describe("one quantity keeps one kind across the tables that name it", () => {
  it("states the kinds literally, so agreeing on the wrong one is not a pass", () => {
    // Written out rather than compared: three tables that all said "count"
    // would satisfy the alias check below and would be exactly the review's
    // defect, applied to more numbers than the review saw.
    expect(SUMMARY_QUANTITIES.merit_score).toBe("magnitude");
    expect(SUMMARY_QUANTITIES.demerit_score).toBe("magnitude");
    expect(SUMMARY_QUANTITIES.karmic_balance).toBe("magnitude");
    expect(INHERITANCE_QUANTITIES.inherited_merit).toBe("magnitude");
    expect(INHERITANCE_QUANTITIES.inherited_demerit).toBe("magnitude");
    expect(RECORD_QUANTITIES.original_weight).toBe("magnitude");
    expect(RECORD_QUANTITIES.effective_weight).toBe("magnitude");
  });

  it("keeps the row tally a count, which is the one number here that is not a weight", () => {
    expect(SUMMARY_QUANTITIES.record_count).toBe("count");
    expect(SUMMARY_QUANTITIES.record_count).not.toBe(SUMMARY_QUANTITIES.merit_score);
  });

  it("keeps the carry-forward rates ratios, not weights", () => {
    // `66a5a3f` put these on the wire as fractions so the card would stop
    // mirroring the backend constants. A fraction classified `magnitude` would
    // pick up the weight scale marker and say the rate was measured in weight.
    expect(INHERITANCE_QUANTITIES.inheritance_merit_rate).toBe("ratio");
    expect(INHERITANCE_QUANTITIES.inheritance_demerit_rate).toBe("ratio");
    expect(RECORD_QUANTITIES.decay_factor).toBe("ratio");
    expect(RECORD_QUANTITIES.years_elapsed).toBe("duration");
  });

  it("holds each alias's three names on one kind", () => {
    // The floor: an emptied `QUANTITY_ALIASES` turns this into a loop over
    // nothing, and the one test in this file whose whole job is cross-table
    // agreement would stop comparing anything while staying green.
    expect(QUANTITY_ALIASES.length).toBeGreaterThanOrEqual(3);

    for (const alias of QUANTITY_ALIASES) {
      const kind = readingQuantityOf(alias.reading);
      expect(SUMMARY_QUANTITIES[alias.summary]).toBe(kind);
      if (alias.inheritance !== null) {
        expect(INHERITANCE_QUANTITIES[alias.inheritance]).toBe(kind);
      }
    }
  });

  it("aliases the three names that are the same quantity, and no others", () => {
    // Written out so a shortened list is a failure rather than a silently
    // narrower guarantee: dropping an entry would leave that concept free to
    // drift while this describe block went on passing.
    expect(QUANTITY_ALIASES.map((a) => [a.reading.field, a.summary, a.inheritance])).toEqual([
      ["merit", "merit_score", "inherited_merit"],
      ["demerit", "demerit_score", "inherited_demerit"],
      ["balance", "karmic_balance", null],
    ]);
  });
});
