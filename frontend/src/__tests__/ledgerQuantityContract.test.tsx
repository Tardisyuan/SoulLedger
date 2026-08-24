/**
 * The same question `readingQuantityContract` asks of the four cosmology
 * panels, asked of the two places the answer was missing: the raw/decayed
 * breakdown directly beneath them, and the judgment queue's triage card.
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
 * The DOM inventories below are written out — field, kind, rendered text, and
 * whether the figure names its scale. A test that reads its expectation out of
 * the thing under test endorses whatever the thing under test says, including
 * the classification a review rejected. Same rule as the sibling file, same
 * reason.
 *
 * The real `I18nProvider` is used, not a `t: (key) => key` stub: a stub that
 * echoes keys makes every copy assertion pass against a bundle with no copy in
 * it.
 */
import { render } from "@testing-library/react";

import type { LedgerInheritance, LedgerReading, LedgerRecord } from "@/lib/api/ledger";
import {
  INHERITANCE_QUANTITIES,
  QUANTITY_ALIASES,
  QUANTITY_KINDS,
  RECORD_QUANTITIES,
  SUMMARY_QUANTITIES,
  readingQuantityOf,
} from "@/lib/api/ledgerQuantities";
import type { QueueLedger } from "@/lib/api/judgment";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { LedgerPanel } from "@/src/components/judgment/JudgmentQueueContext";
import { SoulKarmaLedgerCard } from "@/src/components/souls/SoulKarmaLedgerCard";

import en from "../../messages/en.json";
import egy from "../../messages/egy.json";
import zhHans from "../../messages/zh-Hans.json";

// Recharts under next/dynamic is unrelated to what this file asserts and is a
// known source of jsdom flake. `requireActual` first so the stub replaces one
// export instead of deleting the rest of the module — the mistake
// `SoulDetailPage.inheritance.test.tsx` documents, where a factory that
// returned only what it stubbed took `READING_QUANTITIES` with it and the
// failure surfaced three components away.
jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  ...jest.requireActual("@/src/components/charts/LazyDashboardCharts"),
  LazyLifespanBarChart: () => null,
}));

const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** Dotted lookup into a bundle. */
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
  /** `ledger.figure_scale_weight` — the marker a magnitude carries. */
  scale: "权重",
  records: "条记录",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function record(over: Partial<LedgerRecord> & Pick<LedgerRecord, "id" | "type" | "original_weight">): LedgerRecord {
  return {
    category: "GENERAL",
    description: "",
    effective_weight: over.original_weight,
    years_elapsed: 0,
    decay_factor: 1,
    civilization: "CHINESE",
    recorded_at: "2020-01-01T00:00:00Z",
    event_date: null,
    is_milestone: false,
    ...over,
  };
}

/** Raw 30 / 12, decayed 24 / 9 — the two pairs must differ or the inventory
 *  below could not tell a raw sum from a decayed one. */
const RECORDS: LedgerRecord[] = [
  record({ id: "r1", type: "MERIT", original_weight: 30, effective_weight: 24 }),
  record({ id: "r2", type: "DEMERIT", original_weight: 12, effective_weight: 9 }),
];

const BALANCE_READING: LedgerReading = {
  kind: "BALANCE", civilization: "CHINESE", merit: 24, demerit: 9, balance: 15,
};

const THRESHOLD_READING: LedgerReading = {
  kind: "THRESHOLD", civilization: "EGYPTIAN",
  heart_weight: 18, counterweight: 1, heavier_than_feather: true,
};

const SENTENCE_READING: LedgerReading = {
  kind: "SENTENCE", civilization: "GREEK",
  wrongs: 4, benefactions: 3, repayment_multiple: 10, circuit_years: 1000,
  elapsed_years: null, elapsed_missing: ["TERM_START", "TIME_SERVED"],
};

const INHERITANCE: LedgerInheritance = {
  soul_id: "soul-1",
  inherited_merit: 5,
  inherited_demerit: 9,
  inheritance_merit_rate: 0.2,
  inheritance_demerit_rate: 1,
};

/** Carries `reading` because the payload does: `QueueLedger` declares it
 *  optional, but it is `LedgerService.get_ledger_summary`'s body and that
 *  function always builds one. A fixture without it exercised the fail-closed
 *  path while claiming to be the ordinary case. */
const QUEUE_LEDGER: QueueLedger = {
  soul_id: "soul-1",
  soul_name: "张三",
  merit_score: 120,
  demerit_score: 78,
  karmic_balance: 42,
  record_count: 0,
  records: [],
  reading: { kind: "BALANCE", civilization: "CHINESE" },
};

/** The same ledger under a cosmology that does not net. */
const QUEUE_LEDGER_THRESHOLD: QueueLedger = {
  ...QUEUE_LEDGER,
  reading: { kind: "THRESHOLD", civilization: "EGYPTIAN" },
};

function renderCard(reading: LedgerReading, inheritance: LedgerInheritance | null) {
  return render(
    <I18nProvider>
      <SoulKarmaLedgerCard
        ledgerLabel="业力总账"
        reading={reading}
        meritScore={24}
        demeritScore={9}
        karmicBalance={15}
        recordCount={RECORDS.length}
        records={RECORDS}
        inheritance={inheritance}
      />
    </I18nProvider>
  );
}

function renderQueueLedger(ledger: QueueLedger) {
  return render(
    <I18nProvider>
      <LedgerPanel ledger={ledger} />
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

/**
 * The marker is looked up as a *sibling* of the numeral rather than by field
 * name across the whole tree, which is where this differs from the sibling
 * file's helper. These two components can draw the same field twice on one
 * screen — an UNAVAILABLE reading prints the summary's three sums and the card
 * beneath it prints them again — and a document-wide lookup would answer for
 * the wrong one of the pair.
 */
function figures(root: HTMLElement): Figure[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-quantity]")).map((el) => {
    const mark = el.parentElement?.querySelector<HTMLElement>("[data-quantity-scale]") ?? null;
    return {
      field: el.dataset.quantityField ?? "",
      quantity: el.dataset.quantity ?? "",
      text: (el.textContent ?? "").trim(),
      scaled: mark !== null && (mark.textContent ?? "").trim() !== "",
    };
  });
}

/** The numeric fields a payload actually carries, found by looking. */
function numericFieldsOf(payload: object): string[] {
  return Object.entries(payload)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key)
    .sort();
}

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

// ---------------------------------------------------------------------------
// SoulKarmaLedgerCard — the figure inventory
// ---------------------------------------------------------------------------

describe("SoulKarmaLedgerCard — every number says which kind it is", () => {
  it("draws the reading's three, the breakdown's four, the balance and the inheritance's three", () => {
    // The whole card at once, in DOM order, because the complaint was about
    // adjacency: the reading panel named its scale and the block directly under
    // it did not, which reads as "these are different quantities" rather than
    // "one of these is annotated".
    const { container } = renderCard(BALANCE_READING, INHERITANCE);

    expect(figures(container)).toEqual([
      { field: "merit", quantity: "magnitude", text: "+24", scaled: true },
      { field: "demerit", quantity: "magnitude", text: "-9", scaled: true },
      { field: "balance", quantity: "magnitude", text: "+15", scaled: true },
      { field: "raw_merit", quantity: "magnitude", text: "+30", scaled: true },
      { field: "raw_demerit", quantity: "magnitude", text: "-12", scaled: true },
      { field: "merit_score", quantity: "magnitude", text: "+24", scaled: true },
      { field: "demerit_score", quantity: "magnitude", text: "-9", scaled: true },
      { field: "karmic_balance", quantity: "magnitude", text: "+15", scaled: true },
      { field: "inherited_merit", quantity: "magnitude", text: "+5", scaled: true },
      { field: "inherited_demerit", quantity: "magnitude", text: "-9", scaled: true },
      { field: "inherited_balance", quantity: "magnitude", text: "-4", scaled: true },
    ]);
  });

  it("keeps the raw sums apart from the decayed ones it sits beside", () => {
    // Both pairs are magnitudes on one scale, and that is the point: they are
    // comparable, which they would not be if one pair were a tally. The numbers
    // must still be the two different sums — a raw figure showing the decayed
    // value is a different bug this inventory would otherwise miss.
    const { container } = renderCard(BALANCE_READING, null);
    const drawn = figures(container);

    expect(drawn.find((f) => f.field === "raw_merit")?.text).toBe("+30");
    expect(drawn.find((f) => f.field === "merit_score")?.text).toBe("+24");
  });

  it("leaves the record count in its sentence, where its noun is", () => {
    // Classified a count, drawn as prose. A row tally at a weight sum's size,
    // beside weight sums, is the confusion this work is about — the same call
    // `culpa_record_count` gets in the panel above.
    const { container } = renderCard(BALANCE_READING, null);

    expect(figures(container).map((f) => f.field)).not.toContain("record_count");
    expect(container.textContent ?? "").toContain(`${RECORDS.length} ${ZH.records}`);
  });

  it("never draws a carry-forward rate as a figure, and states it as a percentage instead", () => {
    const { container } = renderCard(BALANCE_READING, INHERITANCE);
    const drawn = figures(container).map((f) => f.field);

    expect(drawn).not.toContain("inheritance_merit_rate");
    expect(drawn).not.toContain("inheritance_demerit_rate");
    // The rates are on screen — as a sentence, in the rate's own unit.
    const sentence = String(at(zhHans, "ledger.carry_forward_rate"))
      .replace("{{merit}}", "20")
      .replace("{{demerit}}", "100");
    expect(container.textContent ?? "").toContain(sentence);
  });

  it("draws no figure inside the carry-forward bars, whose own quantity is the rate", () => {
    // The bars' two captions print `meritScore` and `inherited_merit` as the
    // endpoints of a ratio. Same standing as `heart_weight` and `counterweight`
    // under the Egyptian headline: the ratio is the figure and its operands
    // stay out of the inventory. Both operands are marked elsewhere on this
    // card, so nothing goes unsaid — see the block's comment.
    const { container } = renderCard(BALANCE_READING, INHERITANCE);
    const bars = container.querySelector<HTMLElement>("[data-inheritance-bars]");

    expect(bars).not.toBeNull();
    expect(bars!.querySelectorAll("[data-quantity]")).toHaveLength(0);
    expect(bars!.querySelectorAll("[data-quantity-scale]")).toHaveLength(0);
  });

  it("draws no balance at all for a cosmology that does not net", () => {
    // The defect: `karmic_balance` is the 功過格's instrument — "the Chinese
    // reading served to everyone", in apps/ledger/services.py's own words — and
    // this block drew it under every panel. An Egyptian card said 「重于费斯之
    // 羽」and then, one row down in bold green, 「余额 +6 权重」: 18 points of
    // recorded wrongdoing reading as passing once 24 points of merit were
    // subtracted from it. `_egyptian_reading`'s docstring is about that exact
    // number. The Hall of Two Truths has no subtraction for it to come from.
    //
    // Asserted as an absence *and* as a text, because absence alone is the
    // weaker half: `figures()` would go on passing if the row lost its
    // `data-quantity` attribute and kept printing +6 as a bare numeral, which
    // is the shape this whole file exists to catch.
    const { container } = renderCard(THRESHOLD_READING, null);

    expect(figures(container).map((f) => f.field)).not.toContain("karmic_balance");
    expect(container.textContent).not.toContain("+6");
    // The raw/decayed rows are untouched: raw-against-decayed is a fact about
    // `SoulRecord.weight`, true whatever reads it, and nothing about it nets.
    expect(figures(container).map((f) => f.field)).toEqual(
      expect.arrayContaining(["raw_merit", "raw_demerit", "merit_score", "demerit_score"])
    );
  });

  it("does not read the netted balance out to a screen reader either", () => {
    // The sr-only 原始余额 is a netted sum too. Guarding only the visible row
    // would have kept the same claim and moved it somewhere a sighted reviewer
    // could not see it — which is how it would have survived the next look.
    const { container } = renderCard(THRESHOLD_READING, null);

    expect(container.querySelector(".sr-only")).toBeNull();
  });

  it("keeps the balance for the cosmology whose instrument it is", () => {
    // The other half of the guard, and the one that fails if `kind === "BALANCE"`
    // is ever tightened into something narrower.
    const { container } = renderCard(BALANCE_READING, null);

    expect(figures(container).map((f) => f.field)).toContain("karmic_balance");
    expect(container.querySelector(".sr-only")).not.toBeNull();
  });

  it("gives a Greek soul the same three inheritance figures without the Chinese bars", () => {
    // `f92ed35` made GREEK rebirth-capable, so this card renders for two
    // cosmologies. The bars are the Chinese mechanic; the three sums are not.
    const { container } = renderCard(SENTENCE_READING, INHERITANCE);

    expect(container.querySelector("[data-inheritance-bars]")).toBeNull();
    expect(figures(container).slice(-3)).toEqual([
      { field: "inherited_merit", quantity: "magnitude", text: "+5", scaled: true },
      { field: "inherited_demerit", quantity: "magnitude", text: "-9", scaled: true },
      { field: "inherited_balance", quantity: "magnitude", text: "-4", scaled: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The judgment queue's triage card
// ---------------------------------------------------------------------------

describe("LedgerPanel — the numbers the operator decides on", () => {
  it("draws the three sums as magnitudes, each naming its scale", () => {
    // §4.2's decision context. These were the last bare weight sums in the
    // product, and they are the ones a verdict is chosen against.
    const { container } = renderQueueLedger(QUEUE_LEDGER);

    expect(figures(container)).toEqual([
      { field: "merit_score", quantity: "magnitude", text: "+120", scaled: true },
      { field: "demerit_score", quantity: "magnitude", text: "-78", scaled: true },
      { field: "karmic_balance", quantity: "magnitude", text: "+42", scaled: true },
    ]);
  });

  it("shows no balance for a soul whose cosmology does not net", () => {
    // The third copy of the same defect and the one nearest the decision: this
    // card has no reading panel, so the three sums are all an operator sees
    // before choosing a verdict. An Egyptian soul was triaged against 「余额
    // +42」in bold with nothing on screen to say the weighing never subtracts.
    const { container } = renderQueueLedger(QUEUE_LEDGER_THRESHOLD);

    expect(figures(container).map((f) => f.field)).not.toContain("karmic_balance");
    expect(container.textContent).not.toContain("+42");
    // Marked inapplicable rather than dropped — an operator who is choosing
    // cannot tell a vanished column from a number nobody computed.
    expect(container.querySelector('[data-missing="inapplicable"]')).not.toBeNull();
    // The two sums that are facts about weight stay.
    expect(figures(container).map((f) => f.field)).toEqual(["merit_score", "demerit_score"]);
  });

  it("fails closed when the payload carries no reading at all", () => {
    // `reading` is optional on `QueueLedger` while the backend always sends it,
    // so an absent one is a payload nobody expected. The safe answer to "which
    // cosmology is this?" with nothing in hand is the one that does not net.
    const { reading: _omitted, ...noReading } = QUEUE_LEDGER;
    const { container } = renderQueueLedger(noReading);

    expect(figures(container).map((f) => f.field)).not.toContain("karmic_balance");
    expect(container.querySelector('[data-missing="inapplicable"]')).not.toBeNull();
  });

  it("keeps the sign inside the numeral and the scale outside it", () => {
    // `signed()` is what makes karma read as a ledger, so the sign is part of
    // the value; the scale is not, and a marker swallowed into the numeral's
    // text would put a word where the DOM says a number is.
    const { container } = renderQueueLedger(QUEUE_LEDGER);
    const numeral = container.querySelector<HTMLElement>('[data-quantity-field="demerit_score"]');
    const mark = container.querySelector<HTMLElement>('[data-quantity-scale="demerit_score"]');

    expect(numeral!.textContent).toBe("-78");
    expect(mark!.textContent).toBe(ZH.scale);
    expect(mark!.hasAttribute("aria-hidden")).toBe(false);
  });

  it("reads the copy out of the bundle rather than echoing a key", () => {
    // The marker renders its own key, or renders empty, in exactly the case
    // where every structural assertion above still passes.
    for (const locale of Object.keys(BUNDLES)) {
      const value = at(BUNDLES[locale], "ledger.figure_scale_weight");
      expect(typeof value).toBe("string");
      expect(String(value).trim()).not.toBe("");
      expect(String(value)).not.toContain("figure_scale_weight");
    }
  });
});

// ---------------------------------------------------------------------------
// The invariants that name no field
// ---------------------------------------------------------------------------

/** The sizes these components draw a figure at. */
const FIGURE_SIZE = /(^|\s)text-(lg|xl|2xl|3xl)(\s|$)/;
const BOLD = /(^|\s)font-bold(\s|$)/;

function unclassifiedHeadlines(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("*"))
    .filter((el) => {
      const cls = el.className.toString();
      if (!BOLD.test(cls) || !FIGURE_SIZE.test(cls)) return false;
      return !el.hasAttribute("data-quantity") && !el.hasAttribute("data-quantity-absent");
    })
    .map((el) => (el.textContent ?? "").trim());
}

describe("a magnitude names its scale and nothing else does", () => {
  it("holds across the whole soul card, reading panel included", () => {
    const { container } = renderCard(BALANCE_READING, INHERITANCE);

    const drawn = figures(container);
    expect(drawn.length).toBeGreaterThan(0);
    for (const figure of drawn) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });

  it("holds for a Greek card, where counts and durations sit above the same sums", () => {
    // The mixed case, and the one that matters: a road count and a weight sum
    // on one screen is the pairing the review found.
    const { container } = renderCard(SENTENCE_READING, INHERITANCE);

    const drawn = figures(container);
    expect(drawn.some((f) => f.quantity === "count")).toBe(true);
    for (const figure of drawn) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });

  it("holds in the triage card", () => {
    const { container } = renderQueueLedger(QUEUE_LEDGER);

    for (const figure of figures(container)) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });
});

describe("no unclassified headline number", () => {
  it("soul card: every bold figure-sized slot declares itself", () => {
    // Adding a numeral at figure size without saying what it measures is how
    // the defect got in. The soul name and section headings are not numerals
    // and are not bold-and-figure-sized here; anything that becomes both has
    // to declare a kind.
    expect(unclassifiedHeadlines(renderCard(BALANCE_READING, INHERITANCE).container)).toEqual([]);
  });

  it("soul card: the same with a Greek reading and no inheritance", () => {
    expect(unclassifiedHeadlines(renderCard(SENTENCE_READING, null).container)).toEqual([]);
  });

  it("triage card: the same", () => {
    expect(unclassifiedHeadlines(renderQueueLedger(QUEUE_LEDGER).container)).toEqual([]);
  });
});
