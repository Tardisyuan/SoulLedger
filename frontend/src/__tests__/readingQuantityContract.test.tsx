/**
 * Which of a reading's numbers are magnitudes, which are counts, and the two
 * kinds the first scoping of this fix would have flattened.
 *
 * The defect, from the design review
 * ----------------------------------
 * European `culpa` and a Greek road's count were drawn with the same string of
 * classes: one bold numeral, same size, same weight. So 22 and 4 sat side by
 * side and read as two values of one quantity, with the larger one reading as
 * the worse soul. They are not one quantity — 22 is a sum of
 * `SoulRecord.weight` (this system's own 1-100 severity scale) and 4 is a tally
 * of ledger rows (Republic X counts deeds) — and a ledger view that sorts
 * across tenants will put them in one column regardless.
 *
 * `3fdbbba` made the two class strings stop being character-identical, but only
 * as a side effect of the Greek fork refusing the merit/demerit palette. The
 * distinction itself did not exist, which is why it could be arrived at by
 * accident and could be lost the same way.
 *
 * Why four kinds and not the designer's two
 * -----------------------------------------
 * `repayment_multiple` is a ratio and `circuit_years` / `elapsed_years` are
 * durations. Calling any of them "magnitude" or "count" would manufacture the
 * next pair of numbers that look alike and are not — the same defect one field
 * along. See `READING_QUANTITIES` for the four and what separates them.
 *
 * What holds this down, and in which direction
 * ----------------------------------------------
 *   1. `tsc` — `READING_QUANTITIES` is `Record<NumericFields<...>,
 *      QuantityKind>` per kind, so a numeric field added to the wire type with
 *      no classification does not compile. `numericFieldsOf` below is the
 *      run-time half, for whoever silences the compiler.
 *   2. The DOM inventory in this file is written out literally — field, kind,
 *      rendered text, and whether the figure names its scale. It is deliberately
 *      NOT derived from `READING_QUANTITIES`: a test that reads its expectation
 *      out of the thing under test certifies nothing. Reclassify `culpa` as a
 *      count and this file goes red; it is the second, independent statement.
 *   3. The one invariant that mentions no field at all: a magnitude names its
 *      scale and nothing else does. That is the review's complaint written as a
 *      property, and it survives fields being added, renamed or reordered.
 *
 * The real `I18nProvider` is used, not a `t: (key) => key` stub, for the reason
 * `SoulReadingPanel.test.tsx` states at length: a stub that echoes keys makes
 * every copy assertion pass against a bundle with no copy in it.
 */
import { render, screen } from "@testing-library/react";

import {
  POENA_MISSING_INPUTS,
  READING_KINDS,
  SENTENCE_MISSING_INPUTS,
  type LedgerReading,
  type LedgerReadingKind,
} from "@/lib/api/ledger";
import { QUANTITY_KINDS, READING_QUANTITIES } from "@/lib/api/ledgerQuantities";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";

import en from "../../messages/en.json";
import egy from "../../messages/egy.json";
import zhHans from "../../messages/zh-Hans.json";

const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** Dotted lookup into a bundle, the way `SoulReadingPanel.test.tsx` does it. */
function at(bundle: unknown, path: string): unknown {
  let node: unknown = bundle;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** The provider's default locale, so these are the strings that render below. */
const ZH = {
  /** `ledger.figure_scale_weight` — the marker a magnitude carries and nothing
   *  else does. It moved out of `souls.detail.reading` when the judgment
   *  queue's triage card started reading it: a key under one page's reading
   *  panel told a translator the word could only affect that panel. */
  scale: "权重",
  elapsedYears: (years: number) => `${years} 年`,
};

/**
 * One payload per kind, using the review's own numbers: European culpa 22
 * against a Greek road of 4. Typed per kind rather than as the bare union, so a
 * new field on any member makes these samples fail to compile instead of
 * quietly describing an older payload.
 */
const SAMPLES: { [K in LedgerReadingKind]: Extract<LedgerReading, { kind: K }> } = {
  BALANCE: { kind: "BALANCE", civilization: "CHINESE", balance: 18, merit: 30, demerit: 12 },
  THRESHOLD: {
    kind: "THRESHOLD", civilization: "EGYPTIAN",
    heart_weight: 22, counterweight: 1, heavier_than_feather: true,
  },
  GUILT_AND_PENALTY: {
    kind: "GUILT_AND_PENALTY", civilization: "EUROPEAN",
    culpa: 22, culpa_record_count: 5, poena: null, poena_missing: [...POENA_MISSING_INPUTS],
  },
  SENTENCE: {
    kind: "SENTENCE", civilization: "GREEK",
    wrongs: 4, benefactions: 3, repayment_multiple: 10, circuit_years: 1000,
    elapsed_years: null, elapsed_missing: [...SENTENCE_MISSING_INPUTS],
  },
  UNAVAILABLE: { kind: "UNAVAILABLE", civilization: "UNKNOWN", reason_code: "TENANT_NOT_MAPPED" },
};

/** The Greek payload with its clock running, so `elapsed_years` is a number. */
const SENTENCE_SERVED: Extract<LedgerReading, { kind: "SENTENCE" }> = {
  ...SAMPLES.SENTENCE,
  elapsed_years: 2424,
  elapsed_missing: [],
};

function renderPanel(reading: LedgerReading) {
  return render(
    <I18nProvider>
      <SoulReadingPanel reading={reading} meritScore={30} demeritScore={12} karmicBalance={18} />
    </I18nProvider>
  );
}

/** One rendered figure, as this file compares them. */
interface Figure {
  field: string;
  quantity: string;
  text: string;
  /** Does this figure name the scale it is measured on? */
  scaled: boolean;
}

function figures(container: HTMLElement): Figure[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-quantity]")).map((el) => {
    const field = el.dataset.quantityField ?? "";
    const mark = container.querySelector<HTMLElement>(`[data-quantity-scale="${field}"]`);
    return {
      field,
      quantity: el.dataset.quantity ?? "",
      text: (el.textContent ?? "").trim(),
      scaled: mark !== null && (mark.textContent ?? "").trim() !== "",
    };
  });
}

// ---------------------------------------------------------------------------
// The declaration, against the wire type it classifies
// ---------------------------------------------------------------------------

/** The numeric fields a payload actually carries, found by looking. */
function numericFieldsOf(reading: LedgerReading): string[] {
  return Object.entries(reading)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key)
    .sort();
}

describe("READING_QUANTITIES — every number the wire carries is classified", () => {
  it.each([...READING_KINDS])("%s classifies exactly the fields the payload has", (kind) => {
    // `elapsed_years` is null in the SENTENCE sample by design, so the Greek
    // payload used here is the one with the clock running: this check is about
    // which fields exist, and a nullable field that happens to be null would
    // make the classification look one entry too long.
    const payload: LedgerReading = kind === "SENTENCE" ? SENTENCE_SERVED : SAMPLES[kind];

    expect(Object.keys(READING_QUANTITIES[kind]).sort()).toEqual(numericFieldsOf(payload));
  });

  it("classifies every field as one of the four kinds and invents no fifth", () => {
    const used = new Set<string>();
    for (const perKind of Object.values(READING_QUANTITIES)) {
      for (const quantity of Object.values(perKind)) used.add(quantity);
    }

    for (const quantity of used) expect([...QUANTITY_KINDS]).toContain(quantity);
    // And the four are all in use. A kind nothing is classified as is a kind
    // the panels do not have to draw differently, which is how a distinction
    // becomes decorative.
    expect([...used].sort()).toEqual([...QUANTITY_KINDS].sort());
  });

  it("keeps the pair the review is about on opposite sides", () => {
    // Stated on its own because it is the finding, not an example of it. If
    // these two ever agree, the panels have gone back to drawing a weight sum
    // and a row tally as one quantity.
    expect(READING_QUANTITIES.GUILT_AND_PENALTY.culpa).toBe("magnitude");
    expect(READING_QUANTITIES.SENTENCE.wrongs).toBe("count");
    expect(READING_QUANTITIES.GUILT_AND_PENALTY.culpa).not.toBe(
      READING_QUANTITIES.SENTENCE.wrongs
    );
  });
});

// ---------------------------------------------------------------------------
// The declaration, against what is on the screen
// ---------------------------------------------------------------------------
//
// Written out rather than derived. Deriving the expectation from
// `READING_QUANTITIES` would make this pass for any classification at all,
// including the one the review rejected.

describe("SoulReadingPanel — the figure inventory of each panel", () => {
  it("CHINESE draws three magnitudes, each naming its scale", () => {
    const { container } = renderPanel(SAMPLES.BALANCE);

    expect(figures(container)).toEqual([
      { field: "merit", quantity: "magnitude", text: "+30", scaled: true },
      { field: "demerit", quantity: "magnitude", text: "-12", scaled: true },
      { field: "balance", quantity: "magnitude", text: "+18", scaled: true },
    ]);
  });

  it("EGYPTIAN draws the ratio, and neither of the two magnitudes it is made of", () => {
    // The headline is heart ÷ feather. `heart_weight` and `counterweight` are
    // magnitudes and they belong in the hint sentence, where the words say what
    // they are; promoting either to a numeral beside a "×" is the mistake the
    // hint copy itself used to make.
    const { container } = renderPanel(SAMPLES.THRESHOLD);

    expect(figures(container)).toEqual([
      { field: "ratio", quantity: "ratio", text: "22×", scaled: false },
    ]);
  });

  it("EUROPEAN draws culpa as a magnitude and its record count not at all", () => {
    // `culpa_record_count` is classified and deliberately not a figure: it is
    // the caption under culpa, and a second numeral of the same size beside a
    // weight sum is precisely the confusion being fixed.
    const { container } = renderPanel(SAMPLES.GUILT_AND_PENALTY);

    expect(figures(container)).toEqual([
      { field: "culpa", quantity: "magnitude", text: "22", scaled: true },
    ]);
    // The count is still on screen, in words, saying what it counts.
    expect(container.textContent ?? "").toContain("5 项记录");
  });

  it("GREEK draws two counts, and the rule and the circuit stay in their sentences", () => {
    const { container } = renderPanel(SAMPLES.SENTENCE);

    expect(figures(container)).toEqual([
      { field: "wrongs", quantity: "count", text: "4", scaled: false },
      { field: "benefactions", quantity: "count", text: "3", scaled: false },
    ]);
  });

  it("GREEK draws the served years as a duration once the clock has started", () => {
    const { container } = renderPanel(SENTENCE_SERVED);

    expect(figures(container)).toEqual([
      { field: "wrongs", quantity: "count", text: "4", scaled: false },
      { field: "benefactions", quantity: "count", text: "3", scaled: false },
      {
        field: "elapsed_years",
        quantity: "duration",
        text: ZH.elapsedYears(2424),
        // A duration already carries its unit inside the value. Bolting the
        // weight scale onto it would say the years were measured in weight.
        scaled: false,
      },
    ]);
  });

  it("UNAVAILABLE marks the raw sums as the magnitudes they are", () => {
    // Not a reading, but the same three weight sums, printed where a reader
    // will compare them with everything above. Neutral ink is what says "no
    // verdict"; it does not say what the numbers measure.
    const { container } = renderPanel(SAMPLES.UNAVAILABLE);

    expect(figures(container)).toEqual([
      { field: "merit_score", quantity: "magnitude", text: "30", scaled: true },
      { field: "demerit_score", quantity: "magnitude", text: "12", scaled: true },
      { field: "karmic_balance", quantity: "magnitude", text: "18", scaled: true },
    ]);
  });

  it("never promotes a number that lives inside a sentence to a figure", () => {
    // The complement of the inventories above, stated as a rule so it survives
    // a panel being rewritten: these four are classified, they are on screen,
    // and none of them may become a numeral of its own.
    const inProse = ["counterweight", "culpa_record_count", "repayment_multiple", "circuit_years"];
    const drawn = new Set<string>();

    for (const kind of READING_KINDS) {
      const { container } = renderPanel(kind === "SENTENCE" ? SENTENCE_SERVED : SAMPLES[kind]);
      for (const figure of figures(container)) drawn.add(figure.field);
    }

    expect(inProse.filter((field) => drawn.has(field))).toEqual([]);
    // And each one really is classified, so "not drawn" is a decision rather
    // than a field nobody looked at.
    for (const field of inProse) {
      const owner = Object.values(READING_QUANTITIES).find((perKind) => field in perKind);
      expect(owner).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The invariant that names no field
// ---------------------------------------------------------------------------

describe("SoulReadingPanel — a magnitude names its scale and nothing else does", () => {
  it.each([...READING_KINDS])("%s: exactly the magnitudes carry the scale marker", (kind) => {
    // The review's complaint as a property. `SoulRecord.weight` is a scale this
    // system made up — its help_text says "Significance weight (1-100)" — so
    // there is no honest unit to print and the marker names the scale instead.
    // A count, a duration and a ratio each already state what they are inside
    // their own value or caption; lending them the weight scale would say they
    // were measured on it.
    const { container } = renderPanel(kind === "SENTENCE" ? SENTENCE_SERVED : SAMPLES[kind]);

    for (const figure of figures(container)) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });

  it.each(Object.keys(BUNDLES))("%s prints real copy in the marker, and never a digit", (locale) => {
    // A marker that renders its own key, or renders empty, is the marker not
    // existing while every structural assertion above stays green.
    const value = at(BUNDLES[locale], "ledger.figure_scale_weight");

    expect(typeof value).toBe("string");
    expect(String(value).trim()).not.toBe("");
    expect(String(value)).not.toContain("figure_scale_weight");
    // A scale marker is a word, not a number. A digit here would be a second
    // copy of a constant sitting next to the constant.
    expect(String(value)).not.toMatch(/\d/);
  });

  it("says the marker out loud rather than hiding it from a screen reader", () => {
    // The em-dash in the poena slot is `aria-hidden` because the sentence under
    // it says the same thing. This is the opposite case: nothing else on the
    // panel says what culpa is measured on, so hiding the marker would leave a
    // screen reader with the bare "22" the sighted defect was about.
    const { container } = renderPanel(SAMPLES.GUILT_AND_PENALTY);
    const mark = container.querySelector<HTMLElement>('[data-quantity-scale="culpa"]');

    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe(ZH.scale);
    expect(mark!.hasAttribute("aria-hidden")).toBe(false);
  });

  it("keeps the two roads identical to each other after the marker exists", () => {
    // Both roads are counts, so neither gets a marker and the pair must still
    // be drawn the same. A marker that leaked onto one road would be a claim
    // about which road matters, which is the colour argument again.
    const { container } = renderPanel(SAMPLES.SENTENCE);
    const [owed, requited] = figures(container);

    expect(owed.quantity).toBe(requited.quantity);
    expect(owed.scaled).toBe(false);
    expect(requited.scaled).toBe(false);
    expect(container.querySelectorAll("[data-quantity-scale]")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No number escapes classification
// ---------------------------------------------------------------------------

/** The sizes this component draws a figure at. */
const FIGURE_SIZE = /(^|\s)text-(lg|xl|2xl|3xl)(\s|$)/;
const BOLD = /(^|\s)font-bold(\s|$)/;

describe("SoulReadingPanel — no unclassified headline number", () => {
  it.each([...READING_KINDS])("%s: every bold figure-sized slot declares itself", (kind) => {
    // The structural half. Adding a numeral at figure size without saying what
    // it measures is exactly how `culpa` and a road count came to be drawn the
    // same, and it is the change this rule makes red. The two em-dash slots
    // declare themselves too — as slots, with `data-quantity-absent` — because
    // an absence still occupies a figure's position and the next person to fill
    // one in has to be told which kind belongs there.
    const { container } = renderPanel(kind === "SENTENCE" ? SENTENCE_SERVED : SAMPLES[kind]);

    const unclassified = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) => {
      const cls = el.className.toString();
      if (!BOLD.test(cls) || !FIGURE_SIZE.test(cls)) return false;
      return !el.hasAttribute("data-quantity") && !el.hasAttribute("data-quantity-absent");
    });

    expect(unclassified.map((el) => (el.textContent ?? "").trim())).toEqual([]);
  });

  it("declares the poena slot absent rather than classifying a number it refuses to compute", () => {
    // `poena` is typed `null`, not `number | null`: Purgatorio's penalty is not
    // a figure this ledger withholds, it is one the ledger has no inputs for.
    // So the slot is marked absent and `READING_QUANTITIES` has no entry — a
    // kind assigned here would be a claim about a quantity that does not exist.
    const { container } = renderPanel(SAMPLES.GUILT_AND_PENALTY);
    const slot = container.querySelector<HTMLElement>('[data-quantity-absent="poena"]');

    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("—");
    expect(slot!.hasAttribute("data-quantity")).toBe(false);
    expect("poena" in READING_QUANTITIES.GUILT_AND_PENALTY).toBe(false);
  });

  it("declares the unstarted clock a duration slot, still empty", () => {
    // The other direction from the poena slot, and the reason they are not the
    // same marking. `elapsed_years` *is* a duration — the ledger simply has no
    // start to measure from — so the slot names the kind that belongs in it
    // while still drawing the em-dash rather than a 0.
    const { container } = renderPanel(SAMPLES.SENTENCE);
    const slot = container.querySelector<HTMLElement>('[data-quantity-absent="elapsed_years"]');

    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("—");
    expect(READING_QUANTITIES.SENTENCE.elapsed_years).toBe("duration");
    // And no figure in that slot: an absence must not also be a number.
    expect(screen.queryByText(ZH.elapsedYears(0))).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The Egyptian hint used to print a magnitude where a ratio goes
// ---------------------------------------------------------------------------

describe("threshold hint — the heart's weight is not the heart's ratio", () => {
  it("states the two magnitudes and leaves the ratio to the headline", () => {
    // The bug this fixed. The hint read "the heart weighs {{weight}}× the
    // feather" and `{{weight}}` was `heart_weight` — a magnitude standing in a
    // ratio's slot, correct only because MAAT_FEATHER_WEIGHT happens to be 1.
    // With a counterweight of 2 the headline would have said 11× and the
    // sentence beneath it 22×, and nothing would have been red.
    const { container } = renderPanel({
      kind: "THRESHOLD", civilization: "EGYPTIAN",
      heart_weight: 22, counterweight: 2, heavier_than_feather: true,
    });

    expect(figures(container)).toEqual([
      { field: "ratio", quantity: "ratio", text: "11×", scaled: false },
    ]);

    // The hint, interpolated from the bundle rather than retyped here: both
    // magnitudes stated as magnitudes, and no multiple of its own to disagree
    // with the 11× above.
    const hint = String(at(zhHans, "souls.detail.reading.threshold_hint"))
      .replace("{{weight}}", "22")
      .replace("{{counterweight}}", "2")
      .replace("{{scale}}", ZH.scale);
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(hint).not.toContain("22×");
    expect(hint).not.toContain("11");
  });

  it.each(Object.keys(BUNDLES))("%s names the scale in the hint by interpolation, not by copying it", (locale) => {
    // The hint prints two magnitudes in prose, so it has to name the scale the
    // same way the marker does. Interpolated rather than written into the
    // sentence: a second copy of the word is a second copy free to drift, which
    // is how the frontend's inheritance rates came to disagree with the
    // backend's.
    const hint = String(at(BUNDLES[locale], "souls.detail.reading.threshold_hint"));
    const scale = String(at(BUNDLES[locale], "ledger.figure_scale_weight"));

    expect(hint).toContain("{{weight}}");
    expect(hint).toContain("{{counterweight}}");
    expect(hint).toContain("{{scale}}");
    // Placeholders stripped first: the English marker is the word "weight" and
    // `{{weight}}` is a placeholder that contains it. What must not appear is
    // the scale written into the *prose*, which is the second copy that drifts.
    expect(hint.replace(/\{\{\w+\}\}/g, "")).not.toContain(scale);
  });
});
