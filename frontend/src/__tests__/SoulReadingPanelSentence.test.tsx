/**
 * GREEK — the panel that did not exist, and the clock it could not read.
 *
 * `f92ed35` gave the Greek reading `kind: "SENTENCE"`. `lib/api/ledger.ts`
 * declared four kinds, this component switched over those four with no
 * `default`, and so a SENTENCE payload fell out of the switch, the function
 * returned `undefined`, and React 18 rendered that as nothing. A Greek soul's
 * ledger card was blank — not broken-looking, blank, indistinguishable from a
 * soul with no ledger at all — and `tsc`, `eslint` and the whole Jest suite
 * were green throughout, because a switch is exhaustive over the union the
 * frontend declares and the union was the half nobody updated.
 *
 * Everything in the first half below is that failure written down as
 * assertions. The generalised form of it — "a kind can be missing and nothing
 * says so" — lives in `SoulReadingPanel.test.tsx`, and the fork's geometry in
 * `SoulReadingPanelFork.test.tsx`.
 *
 * The second half is the clock. `elapsed_years` was typed `null` — the type,
 * not the value — and this slot drew the em-dash without ever asking.
 * `Disposition.term_start` made the backend able to send a number, and an
 * unchanged panel would have drawn "—" on top of it: an absence rendered over
 * a fact, which is worse than the honest blank it replaced and worse than the
 * number it hid. Both directions are asserted, because a fix that makes the
 * number appear and also turns the honest absence into a 0 has traded one
 * wrong claim for another.
 */
import { screen } from "@testing-library/react";

import { SENTENCE_MISSING_INPUTS, type SentenceMissingInput } from "@/lib/api/ledger";

import {
  ZH,
  assertScanned,
  bulletTexts,
  dashSpans,
  renderPanel,
  sentence,
} from "./support/soulReadingFixtures";

describe("SoulReadingPanel — the Greek sentence renders at all", () => {
  it("renders the panel instead of nothing", () => {
    // The assertion that would have caught the whole defect. Before the
    // `SENTENCE` branch existed this rendered an empty container and every
    // more specific expectation below would have failed for the same reason,
    // so it is worth stating the crude one first: something is on screen.
    const { container } = renderPanel(sentence());

    expect(container).not.toBeEmptyDOMElement();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("shows the wrongs count and the repayment rule as two separate facts", () => {
    const { container } = renderPanel(sentence({ wrongs: 4 }));

    expect(screen.getByText(ZH.owedLabel)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(ZH.owedDetail)).toBeInTheDocument();

    // Absence, and it is the point of the upper half. Tenfold repayment is the
    // rule Republic X states; 4 × 10 = 40 is a debt it does not, in a unit this
    // system has never defined — the "rule rendered as a balance" collapse the
    // whole readings module exists to stop making.
    expect(container.textContent ?? "").not.toContain("40");
  });

  it("draws the right-hand road beside the left, not instead of it", () => {
    // The defect this test was written for: `_greek_reading` took the demerit
    // count alone, so the panel could say what a soul owed and had no way to
    // say what it was owed. Republic X sends the just to the right and upward
    // and the unjust to the left and downward (614c) and requites both tenfold
    // over the same circuit (615b); a panel that draws one of those two roads
    // is not a shorter reading, it is a different one.
    renderPanel(sentence({ wrongs: 4, benefactions: 3 }));

    expect(screen.getByText(ZH.owedLabel)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(ZH.requitedLabel)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(ZH.requitedDetail)).toBeInTheDocument();
  });

  it("never renders the two roads' arithmetic", () => {
    // The whole reason merit stayed out of this reading until now. Every
    // number below is a way of collapsing two parallel repayments into one
    // figure: their difference (the Chinese balance), their sum, their product,
    // and each multiplied out by the repayment rule (`ef7df3d`: tenfold is a
    // rule Republic X states, not a total it computes).
    //
    // `queryByText` matches an element's whole text, so "1" here means an
    // element that says exactly "1" — the 1 inside "1000" cannot satisfy it,
    // and a substring check on the container would be satisfied by it.
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 3 }));

    for (const collapsed of ["1", "7", "12", "40", "30"]) {
      expect(screen.queryByText(collapsed)).not.toBeInTheDocument();
    }
    expect(container.textContent ?? "").not.toContain("40");
    expect(container.textContent ?? "").not.toContain("30");
    // And no shared axis to invite the eye to do the subtraction the numbers
    // do not: no bar, no percentage. Same prohibition as the elapsed half.
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent ?? "").not.toContain("%");
  });

  it("reports an empty road as 0 and keeps the em-dash for the clock alone", () => {
    // 0 and — are different claims and this panel must keep them apart. "No
    // recorded good deeds" is something the ledger knows; how much of the
    // circuit has run is not. Drawing the empty road as an absence would put
    // the two on the same footing, and dropping it would take the reading back
    // to the one road it is being fixed for.
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 0 }));

    expect(screen.getByText(ZH.requitedLabel)).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(dashSpans(container, 16)).toHaveLength(1);
  });

  it("presents the circuit as a period and never as this soul's term", () => {
    renderPanel(sentence());

    expect(screen.getByText(ZH.circuit)).toBeInTheDocument();
    // 1000 appears only inside that sentence, not as a headline figure. The
    // headline is the wrongs count; a large "1000" beside the word 刑期 would
    // say the soul was sentenced to a thousand years, which is a claim about
    // this soul that the circuit length is not.
    const headline = screen.getByText("4");
    expect(headline.className).toContain("text-xl");
    expect(screen.queryByText("1000")).not.toBeInTheDocument();
  });

  it("reports elapsed time as an em-dash absence, not as zero and not as progress", () => {
    const { container } = renderPanel(sentence());
    const text = container.textContent ?? "";

    expect(screen.getByText(ZH.elapsedLabel)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(ZH.elapsedHeading)).toBeInTheDocument();
    // A 0 would claim the term has not begun; the ledger does not know that
    // either. Same argument as poena, which is why the two are drawn alike.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    // And no bar or percentage: the numerator is null and the denominator is a
    // term length nobody has computed, so a progress indicator invents both.
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text).not.toContain("%");
  });

  it("names what is missing, one bullet per member, in the payload's order", () => {
    const { container } = renderPanel(sentence());

    expect(bulletTexts(container)).toEqual([ZH.termStart, ZH.timeServed]);
  });

  it("follows the payload when the list shrinks or is reordered", () => {
    const { container } = renderPanel(sentence({ elapsed_missing: ["TIME_SERVED"] }));

    expect(bulletTexts(container)).toEqual([ZH.timeServed]);
    expect(screen.queryByText(ZH.termStart)).not.toBeInTheDocument();
  });

  it("keeps the heading and drops the list when nothing is reported missing", () => {
    const { container } = renderPanel(sentence({ elapsed_missing: [] }));

    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(screen.getAllByText(ZH.elapsedHeading).length).toBeGreaterThan(0);
  });

  it("never puts a raw member name or a raw key on screen", () => {
    const { container } = renderPanel(sentence());
    const text = container.textContent ?? "";

    // `not.toContain` per member asserts nothing over an empty list. Measured
    // at 2 (TERM_START, TIME_SERVED) against `lib/api/ledger.ts`.
    assertScanned("sentence members swept for raw leakage", SENTENCE_MISSING_INPUTS.length, 2);
    for (const member of SENTENCE_MISSING_INPUTS) {
      expect(text).not.toContain(member);
    }
    expect(text).not.toContain("souls.detail.reading");
  });

  it("shows the raw key for a member no bundle has copy for", () => {
    const unknown = ["TERM_START", "PAROLE"] as unknown as SentenceMissingInput[];
    const { container } = renderPanel(sentence({ elapsed_missing: unknown }));

    expect(bulletTexts(container)).toEqual([
      ZH.termStart,
      "souls.detail.reading.elapsed_missing_parole",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The clock can now be read, and the em-dash must get out of its way
// ---------------------------------------------------------------------------

describe("SoulReadingPanel — elapsed time, when the ledger has it", () => {
  it("renders the years served instead of the em-dash", () => {
    const { container } = renderPanel(sentence({ elapsed_years: 2424, elapsed_missing: [] }));

    expect(screen.getByText(ZH.elapsedLabel)).toBeInTheDocument();
    expect(screen.getByText(ZH.elapsedYears(2424))).toBeInTheDocument();
    // Absence asserted beside presence: the whole defect is a "—" sitting
    // next to a number rather than instead of one.
    expect(dashSpans(container, 17)).toHaveLength(0);
  });

  it("drops the not-recorded heading and its bullets", () => {
    const { container } = renderPanel(sentence({ elapsed_years: 2424, elapsed_missing: [] }));

    expect(screen.queryByText(ZH.elapsedHeading)).not.toBeInTheDocument();
    expect(container.querySelectorAll("ul")).toHaveLength(0);
  });

  it("renders a served count of zero as zero and not as the em-dash", () => {
    // The truthiness trap, and the reason the branch is `!== null`. A term
    // that began this year has served 0 years of it, which is a fact; the
    // em-dash means the ledger does not know, which is not the same claim.
    // `elapsed_years && ...` would have redrawn the glyph over it.
    const { container } = renderPanel(sentence({ elapsed_years: 0, elapsed_missing: [] }));

    expect(screen.getByText(ZH.elapsedYears(0))).toBeInTheDocument();
    expect(dashSpans(container, 17)).toHaveLength(0);
  });

  it("lets the number decide when the payload contradicts itself", () => {
    // The backend sends the list empty whenever the number is present, so this
    // payload should not occur. It is asserted anyway because "should not
    // occur" is not a rendering rule: a panel that drew both would put a
    // figure and a claim that the figure is unavailable in the same box.
    const { container } = renderPanel(
      sentence({ elapsed_years: 300, elapsed_missing: [...SENTENCE_MISSING_INPUTS] })
    );

    expect(screen.getByText(ZH.elapsedYears(300))).toBeInTheDocument();
    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(screen.queryByText(ZH.termStart)).not.toBeInTheDocument();
  });

  it("still refuses to turn the number into progress", () => {
    // A served figure larger than the circuit is a real state — Republic X's
    // souls come back, and this ledger does not know whether this one has.
    // The prohibition that held while the numerator was null holds harder now
    // that it is not: there is still no term length to be a denominator.
    const { container } = renderPanel(
      sentence({ elapsed_years: 2424, elapsed_missing: [], circuit_years: 1000 })
    );
    const text = container.textContent ?? "";

    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text).not.toContain("%");
    // 2424 - 1000 and 2424 / 1000: the remainder and the ratio a progress
    // reading would produce. Neither is a fact this payload contains.
    expect(screen.queryByText(ZH.elapsedYears(1424))).not.toBeInTheDocument();
    expect(text).not.toContain("2.4");
  });

  it("gives the number no colour the roads do not have", () => {
    // Both roads are plain ink at identical weight, and their shared clock is
    // not allowed to be louder. A green or red served figure would be the
    // merit/demerit palette — the BALANCE reading's subtraction — arriving
    // through the one slot the fork does not govern.
    renderPanel(sentence({ elapsed_years: 2424, elapsed_missing: [] }));

    const value = screen.getByText(ZH.elapsedYears(2424));
    expect(value.className).not.toContain("karma-merit");
    expect(value.className).not.toContain("karma-demerit");
    expect(value.className).not.toContain("status-error");
  });

  it("keeps the em-dash and the bullets when the ledger still has nothing", () => {
    // The other direction, restated here rather than left to the older test:
    // this describe block is where someone will come to change this slot, and
    // the absent path has to be visible from the same place.
    const { container } = renderPanel(sentence({ elapsed_years: null }));

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(ZH.elapsedHeading)).toBeInTheDocument();
    expect(bulletTexts(container)).toEqual([ZH.termStart, ZH.timeServed]);
    expect(screen.queryByText(ZH.elapsedYears(0))).not.toBeInTheDocument();
  });
});
