/**
 * The DOM half of the ledger quantity contract. The declarations half — the
 * four classification tables and whether they agree with each other — is
 * `ledgerQuantityContract.test.tsx`, and the payloads and render helpers both
 * halves draw on are `support/ledgerQuantityFixtures.ts` and
 * `support/ledgerQuantityRender.tsx`.
 *
 * What is deliberately not derived
 * --------------------------------
 * The inventories below are written out — field, kind, rendered text, and
 * whether the figure names its scale. A test that reads its expectation out of
 * the thing under test endorses whatever the thing under test says, including
 * the classification a review rejected.
 *
 * The real `I18nProvider` is used, not a `t: (key) => key` stub: a stub that
 * echoes keys makes every copy assertion pass against a bundle with no copy in
 * it.
 */
import type { QueueLedger } from "@/lib/api/judgment";

import {
  BALANCE_READING,
  BUNDLES,
  INHERITANCE,
  QUEUE_LEDGER,
  QUEUE_LEDGER_THRESHOLD,
  RECORDS,
  SENTENCE_READING,
  THRESHOLD_READING,
  ZH,
  at,
  zhHans,
} from "./support/ledgerQuantityFixtures";

// Recharts under next/dynamic is unrelated to what this file asserts and is a
// known source of jsdom flake. `requireActual` first so the stub replaces one
// export instead of deleting the rest of the module — the mistake
// `SoulDetailPage.inheritance.test.tsx` documents, where a factory that
// returned only what it stubbed took `READING_QUANTITIES` with it and the
// failure surfaced three components away.
//
// Declared here rather than in the shared render helper: `jest.mock` is hoisted
// per test file and does not travel through an import.
jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  ...jest.requireActual("@/src/components/charts/LazyDashboardCharts"),
  LazyLifespanBarChart: () => null,
}));

import {
  figureSlots,
  figures,
  renderCard,
  renderQueueLedger,
  unclassifiedHeadlines,
} from "./support/ledgerQuantityRender";

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
    const { container } = renderQueueLedger(noReading as QueueLedger);

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
    //
    // The floor: three bundles, and a `BUNDLES` that lost its entries would
    // turn the loop below into a pass over nothing.
    const locales = Object.keys(BUNDLES);
    expect(locales).toEqual(expect.arrayContaining(["en", "zh-Hans", "egy"]));

    for (const locale of locales) {
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

describe("a magnitude names its scale and nothing else does", () => {
  it("holds across the whole soul card, reading panel included", () => {
    const { container } = renderCard(BALANCE_READING, INHERITANCE);

    const drawn = figures(container);
    expect(drawn.length).toBeGreaterThanOrEqual(11);
    for (const figure of drawn) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });

  it("holds for a Greek card, where counts and durations sit above the same sums", () => {
    // The mixed case, and the one that matters: a road count and a weight sum
    // on one screen is the pairing the review found.
    const { container } = renderCard(SENTENCE_READING, INHERITANCE);

    const drawn = figures(container);
    expect(drawn.length).toBeGreaterThanOrEqual(1);
    expect(drawn.some((f) => f.quantity === "count")).toBe(true);
    for (const figure of drawn) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });

  it("holds in the triage card", () => {
    const { container } = renderQueueLedger(QUEUE_LEDGER);

    const drawn = figures(container);
    // The floor this block needs most: the other two cases state their own
    // inventories elsewhere, and this one would be a loop over nothing the day
    // `LedgerPanel` stopped marking its numerals.
    expect(drawn.length).toBeGreaterThanOrEqual(3);
    for (const figure of drawn) {
      expect(figure.scaled).toBe(figure.quantity === "magnitude");
    }
  });
});

describe("no unclassified headline number", () => {
  // A scan for offenders is clean when it scans nothing, so each case floors
  // its own subject set: how many figure-sized bold slots the card drew at all.
  it("soul card: every bold figure-sized slot declares itself", () => {
    // Adding a numeral at figure size without saying what it measures is how
    // the defect got in. Anything drawn at figure size **that contains digits**
    // has to declare a kind.
    //
    // 这段原本写的是「The soul name and section headings are not numerals and
    // are not bold-and-figure-sized here」。那句在旧档下为真 —— 标题当时用
    // `font-semibold`,而 BOLD 只认 `font-bold`,所以标题进不了主体集合。
    // 八档字号之后它**按构造为假**:`text-06` 是标题档,而它同时落在 BOLD 与
    // FIGURE_SIZE 里,于是每个被正确迁到 text-06 的面板标题都会自己走进来。
    // 实测:往这张卡里注入一个 `text-06` 的标题和一个 `text-08` 的 🔒,旧判据
    // 把两者都报成「未分类头条数字」,其中一条的 textContent 就是「🔒」。
    //
    // 这句话读起来像已核实的结论,所以没有人再推导一遍 —— 它替一段没跑过的
    // 逻辑作了保证,而那正是本仓记过多次的形状。现在主体集合由**有没有数字**
    // 决定,这句注释才重新成立。
    const { container } = renderCard(BALANCE_READING, INHERITANCE).container
      ? renderCard(BALANCE_READING, INHERITANCE)
      : renderCard(BALANCE_READING, INHERITANCE);
  // 下限是**实测**的,不是估的。原先写的是 8/5/3,三个都比这张卡真正画出的槽多,
  // 而它们从未被跑过就写进了断言。`figureSlots` 选的是「看起来像头条数字」的元素
  // (粗体 + 头条字号),它们是 `figures()` 那 11 个带 data-quantity 元素里的一个子集
  // —— 其余画在更小的字号上。这三个数是棘轮:卡片少画一个头条数字就会红。

    expect(figureSlots(container).length).toBeGreaterThanOrEqual(4);
    expect(unclassifiedHeadlines(container)).toEqual([]);
  });

  it("soul card: the same with a Greek reading and no inheritance", () => {
    const { container } = renderCard(SENTENCE_READING, null);

    expect(figureSlots(container).length).toBeGreaterThanOrEqual(3);
    expect(unclassifiedHeadlines(container)).toEqual([]);
  });

  it("triage card: the same", () => {
    const { container } = renderQueueLedger(QUEUE_LEDGER);

    expect(figureSlots(container).length).toBeGreaterThanOrEqual(1);
    expect(unclassifiedHeadlines(container)).toEqual([]);
  });
});
