/**
 * The panels that report an absence, the copy they do it with, and the
 * exhaustiveness guarantee that keeps a panel from being absent itself.
 *
 * Why this file exists
 * --------------------
 * `apps/ledger/readings.py` used to put two English sentences on the wire —
 * `poena_unavailable` and `reason` — that nothing in this repository read. The
 * panel rendered the same content from its own catalogue keys, and rendered it
 * better: three separate bullets where the sentence had one clause listing
 * three things. Two copies of one fact, and the panel's copy was the one that
 * could not move: the bullets were three hard-coded `<li>` elements, so a
 * fourth missing input added on the backend would have gone on rendering as
 * three, in a UI that says in as many words which three, with nothing red.
 *
 * The backend now sends `poena_missing` (members) and `reason_code` (a state),
 * and this file holds the two properties that replace the hard-coding:
 *
 *   1. the bullets are what the backend sent — a shorter list renders shorter,
 *      a reordered one renders reordered;
 *   2. the copy key is derived from the member, so the mapping cannot be
 *      half-written. A member with no key in a bundle puts the raw key on
 *      screen, which is ugly and therefore self-reporting — the property
 *      `civilizationCopyCoverage.test.ts` argues for, applied to members
 *      instead of civilizations.
 *
 * The real `I18nProvider` is used rather than a `t: (key) => key` stub. A stub
 * that returns the key would make every assertion below pass against a bundle
 * with no copy in it at all, which is the shape of test double
 * `WorkflowPage.test.tsx` was caught with: it reproduced the defect under test
 * and measured itself.
 *
 * The direction this file cannot see — a member, or a whole `kind`, added on
 * the backend and not to the constants in `lib/api/ledger.ts` — is held by
 * `apps/ledger/test_readings.py::TestFrontendMemberListsAgree`, which reads
 * this module's declarations as text and compares them to the Python tuples.
 * That blind spot is how the GREEK panel came to not exist for a release.
 */
import { render, screen } from "@testing-library/react";

import {
  POENA_MISSING_INPUTS,
  READING_KINDS,
  SENTENCE_MISSING_INPUTS,
  UNAVAILABLE_REASON_CODES,
  type LedgerReading,
  type LedgerReadingKind,
  type PoenaMissingInput,
  type SentenceMissingInput,
} from "@/lib/api/ledger";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";

import en from "../../messages/en.json";
import egy from "../../messages/egy.json";
import zhHans from "../../messages/zh-Hans.json";

const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** The provider's default locale, so these are the strings that render below. */
const ZH = {
  absolution: "是否已获赦免",
  satisfaction: "应偿补赎多少",
  penance: "已行补赎多少",
  unavailableExplanation:
    "该灵魂所属租户尚未映射到任何文明宇宙观，因此没有可呈现的解读——仅显示下方原始账目。",
  unavailableCta: "请为该租户配置文明映射以启用解读。",
  // The tenfold rule now sits at the apex of the fork, stated once for both
  // roads, so neither road's caption carries the multiple any more.
  repaymentRule: "每桩皆以 10 倍偿还——两道同此一律",
  owedLabel: "所欠刑期",
  owedDetail: "桩在案过错",
  requitedLabel: "所得回报",
  requitedDetail: "桩在案善行 · 不冲抵刑期",
  circuit: "以 1000 年为一个周期计量——这是偿还的单位，不是本刑期的长度。",
  elapsedLabel: "已服",
  poenaHeading: "无法计算",
  elapsedHeading: "本账本未记",
  termStart: "刑期何时开始",
  timeServed: "已服了多少",
};

function renderPanel(reading: LedgerReading) {
  return render(
    <I18nProvider>
      <SoulReadingPanel reading={reading} meritScore={30} demeritScore={12} karmicBalance={18} />
    </I18nProvider>
  );
}

function guiltAndPenalty(poenaMissing: PoenaMissingInput[]): LedgerReading {
  return {
    kind: "GUILT_AND_PENALTY",
    civilization: "EUROPEAN",
    culpa: 12,
    culpa_record_count: 2,
    poena: null,
    poena_missing: poenaMissing,
  };
}

function bulletTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("li")).map((li) => li.textContent ?? "");
}

describe("SoulReadingPanel — poena bullets follow the payload", () => {
  it("renders one bullet per member the backend sent, in that order", () => {
    const { container } = renderPanel(guiltAndPenalty([...POENA_MISSING_INPUTS]));

    expect(bulletTexts(container)).toEqual([ZH.absolution, ZH.satisfaction, ZH.penance]);
  });

  it("renders fewer bullets when the backend reports fewer missing inputs", () => {
    // The assertion the three hard-coded `<li>` elements could never fail. If
    // this list ever legitimately shrinks — because the ledger starts
    // recording absolution, say — the panel must shrink with it rather than go
    // on naming a fact the backend no longer claims is missing.
    const { container } = renderPanel(guiltAndPenalty(["PENANCE"]));

    expect(bulletTexts(container)).toEqual([ZH.penance]);
    // Absence, not just presence: the other two must be gone from the whole
    // panel, not merely absent from the list.
    expect(screen.queryByText(ZH.absolution)).not.toBeInTheDocument();
    expect(screen.queryByText(ZH.satisfaction)).not.toBeInTheDocument();
  });

  it("follows the payload's order rather than a fixed one", () => {
    const { container } = renderPanel(guiltAndPenalty(["PENANCE", "ABSOLUTION"]));

    expect(bulletTexts(container)).toEqual([ZH.penance, ZH.absolution]);
  });

  it("drops the list entirely, keeping the heading, when nothing is reported missing", () => {
    // readings.py keeps `poena_missing` non-empty for as long as `poena` is
    // null and pins that; this is what the panel does if it ever arrives empty
    // anyway. An empty `<ul>` renders as a stray bullet gutter, and a crash
    // here would take the whole soul detail page with it.
    const { container } = renderPanel(guiltAndPenalty([]));

    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(bulletTexts(container)).toEqual([]);
    expect(screen.getAllByText("无法计算").length).toBeGreaterThan(0);
  });

  it("never puts a raw member name on screen", () => {
    // The defect `soulLifecycleRows` was fixed for and `civilizationCopyCoverage`
    // guards against: the untranslated value reaching the screen beside — or
    // instead of — its label. Asserted over the panel's whole text, so a member
    // leaking into an attribute-free corner still fails.
    const { container } = renderPanel(guiltAndPenalty([...POENA_MISSING_INPUTS]));
    const text = container.textContent ?? "";

    for (const member of POENA_MISSING_INPUTS) {
      expect(text).not.toContain(member);
    }
    // And no untranslated key either, which is the other way a member reaches
    // the screen unspoken for.
    expect(text).not.toContain("souls.detail.reading");
  });

  it("shows the raw key for a member no bundle has copy for", () => {
    // Not an endorsement of the raw key, a statement of which failure mode was
    // chosen. A member the frontend has never heard of is a real possibility
    // between a backend deploy and a frontend one, and the alternatives are
    // silently dropping the bullet — the exact defect this change removed — or
    // throwing. A visible key is the one that reports itself.
    const unknown = ["ABSOLUTION", "PURGATION"] as unknown as PoenaMissingInput[];
    const { container } = renderPanel(guiltAndPenalty(unknown));

    expect(bulletTexts(container)).toEqual([
      ZH.absolution,
      "souls.detail.reading.poena_missing_purgation",
    ]);
  });
});

// ---------------------------------------------------------------------------
// GREEK — the panel that did not exist
// ---------------------------------------------------------------------------
//
// `f92ed35` gave the Greek reading `kind: "SENTENCE"`. `lib/api/ledger.ts`
// declared four kinds, this component switched over those four with no
// `default`, and so a SENTENCE payload fell out of the switch, the function
// returned `undefined`, and React 18 rendered that as nothing. A Greek soul's
// ledger card was blank — not broken-looking, blank, indistinguishable from a
// soul with no ledger at all — and `tsc`, `eslint` and the whole Jest suite
// were green throughout, because a switch is exhaustive over the union the
// frontend declares and the union was the half nobody updated.
//
// Everything below is that failure written down as assertions.

function sentence(overrides: Partial<Extract<LedgerReading, { kind: "SENTENCE" }>> = {}): LedgerReading {
  return {
    kind: "SENTENCE",
    civilization: "GREEK",
    wrongs: 4,
    // Deliberately different from `wrongs`: every assertion below that looks up a
    // figure by its text would be ambiguous if the two roads carried the same
    // number, and the arithmetic guard needs the difference (1), the sum (7)
    // and the products (40, 30, 12) to be distinct from both.
    benefactions: 3,
    repayment_multiple: 10,
    circuit_years: 1000,
    elapsed_years: null,
    elapsed_missing: [...SENTENCE_MISSING_INPUTS],
    ...overrides,
  };
}

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
    const dashes = Array.from(container.querySelectorAll("span")).filter(
      (el) => el.textContent?.trim() === "—"
    );
    expect(dashes).toHaveLength(1);
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
// The fork — the prohibition drawn instead of described
// ---------------------------------------------------------------------------
//
// "The two roads never combine" was, until this layout, a comment. Two figures
// stacked in one column with a shared right edge are an invitation to subtract,
// and nothing in the markup declined it. The fork declines it structurally:
// there is no row spanning both roads, no shared axis, and the gap between them
// is an empty column rather than a boundary. A derived figure has nowhere to
// go, so adding one means adding a cell — a diff a reviewer can see.
//
// These assertions are about that structure. They are deliberately not
// screenshot-shaped: a picture cannot say "there is no place to put a derived
// number", and the DOM can.

function fork(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-fork]");
  if (!el) throw new Error("no [data-fork] in the panel");
  return el;
}

/** The row that carries the two roads: the roads' shared parent. */
function roadsRow(container: HTMLElement): HTMLElement {
  const owed = container.querySelector<HTMLElement>('[data-road="owed"]');
  if (!owed?.parentElement) throw new Error("no owed road, or it has no parent row");
  return owed.parentElement;
}

describe("SoulReadingPanel — the Greek reading forks", () => {
  it("puts the shared rule above the fork and both roads below it", () => {
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 3 }));
    const f = fork(container);

    // The apex, and the two roads under it, each in its own cell.
    expect(f.querySelector("[data-fork-rule]")?.textContent).toBe(ZH.repaymentRule);
    expect(f.querySelector('[data-road="owed"]')).not.toBeNull();
    expect(f.querySelector('[data-road="requited"]')).not.toBeNull();

    // Independent: neither road contains the other, and neither contains the
    // rule. A road nested inside its neighbour would be a shared axis wearing
    // a fork's clothes.
    const owed = f.querySelector<HTMLElement>('[data-road="owed"]')!;
    const requited = f.querySelector<HTMLElement>('[data-road="requited"]')!;
    expect(owed.contains(requited)).toBe(false);
    expect(requited.contains(owed)).toBe(false);
    expect(owed.textContent).toBe(`${ZH.owedLabel}4${ZH.owedDetail}`);
    expect(requited.textContent).toBe(`${ZH.requitedLabel}3${ZH.requitedDetail}`);
  });

  it("orders the roads owed then requited, following the copy catalogue", () => {
    const { container } = renderPanel(sentence());
    const roads = Array.from(container.querySelectorAll<HTMLElement>("[data-road]"));

    expect(roads.map((r) => r.dataset.road)).toEqual(["owed", "requited"]);
  });

  it("states the repayment rule once, not once per road", () => {
    // 615b gives both roads *the same measure*. Drawn twice it is one fact
    // rendered as two, free to drift; drawn at the apex it is what it is — the
    // rule that governs the fork, above the point where the roads part.
    const { container } = renderPanel(sentence({ repayment_multiple: 10 }));
    const text = container.textContent ?? "";

    expect(container.querySelectorAll("[data-fork-rule]")).toHaveLength(1);
    expect(text.split(ZH.repaymentRule)).toHaveLength(2);

    // And inside the fork the multiple appears nowhere but in that sentence —
    // not in either road's caption, which is where it used to be drawn twice.
    // Scoped to the fork on purpose: `circuit_years` is 1000 and contains a
    // "10", and the circuit is a different fact living outside the fork.
    const insideFork = fork(container).textContent ?? "";
    expect(insideFork.split(ZH.repaymentRule).join("")).not.toContain("10");
    for (const road of Array.from(container.querySelectorAll<HTMLElement>("[data-road]"))) {
      expect(road.textContent ?? "").not.toContain("10");
    }
  });

  it("leaves no cell for a figure derived from both roads", () => {
    // The structural form of the prohibition the arithmetic test states
    // numerically. The roads row holds exactly three cells — road, gutter,
    // road — the gutter is empty, and nothing inside the fork spans the pair.
    // A difference or a sum would need a fourth cell or a column span, and
    // either one is a visible change to this grid.
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 3 }));
    const row = roadsRow(container);

    expect(row.children).toHaveLength(3);
    const gutter = row.children[1] as HTMLElement;
    expect(gutter.hasAttribute("data-fork-gutter")).toBe(true);
    expect(gutter.textContent).toBe("");
    expect(gutter.children).toHaveLength(0);

    // No descendant of the fork spans both columns. `col-span`/`colspan` is how
    // one would be written, in a grid and in a table respectively.
    const spanning = Array.from(fork(container).querySelectorAll("*")).filter(
      (el) => /(^|\s)col-span-/.test(el.className.toString()) || el.hasAttribute("colspan")
    );
    expect(spanning).toEqual([]);
  });

  it("draws nothing in the gap between the two counts", () => {
    // The failure the designer hit and rebuilt away from: a `border-right` on
    // the left-hand cell lands on the *boundary* between the columns, which is
    // to say in the gap between the two numbers, which is the netting hint this
    // panel's whole argument forbids. The gap is a column now, and it is empty.
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 3 }));
    const row = roadsRow(container);

    // Nothing in the roads row carries a vertical rule of any kind — not on a
    // cell, not on a descendant, and not as an inline style.
    for (const el of [row, ...Array.from(row.querySelectorAll<HTMLElement>("*"))]) {
      const cls = el.className.toString();
      expect(cls).not.toMatch(/(^|\s)border-(l|r|x)(-|$|\s)/);
      expect(el.style.borderLeft || el.style.borderRight || "").toBe("");
    }

    // The connector that does carry hairlines is a separate row, it sits above
    // the roads, and it is decoration: everything it says is said in words by
    // the apex and the two labels, so it must not be in the reading order.
    const connector = container.querySelector<HTMLElement>("[data-fork-connector]");
    expect(connector).not.toBeNull();
    expect(connector).toHaveAttribute("aria-hidden", "true");
    expect(connector!.contains(row)).toBe(false);
    expect(connector!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It is geometry, not text — a connector that said anything would be a
    // caption nobody can read.
    expect(connector!.textContent).toBe("");

    // The connector's own gutter cell — the column that sits over the gap — may
    // carry the stem descending from the apex and the middle of the crossbar,
    // and nothing that reaches down past them. jsdom has no layout to measure,
    // so this is pinned on the classes that place the line: upper half only,
    // never anchored to the bottom. A line running the full height of this cell
    // is the vertical rule between the two numbers, arrived at from a different
    // direction than the `border-right` that caused it the first time.
    const connectorGutter = connector!.children[1] as HTMLElement;
    for (const line of Array.from(connectorGutter.querySelectorAll<HTMLElement>("*"))) {
      const cls = line.className.toString();
      if (!/(^|\s)border-l(\s|$)/.test(cls)) continue;
      expect(cls).toContain("top-0");
      expect(cls).toContain("h-1/2");
      expect(cls).not.toContain("bottom-0");
      expect(cls).not.toContain("inset-y-0");
      expect(cls).not.toMatch(/(^|\s)h-full(\s|$)/);
    }
  });

  it("gives neither road the merit/demerit palette", () => {
    // That palette is the two halves of the BALANCE reading's subtraction. It
    // *is* a net figure; wearing it here would smuggle the netting back in
    // through the colours right after the layout was rebuilt to refuse it.
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 3 }));

    for (const el of Array.from(fork(container).querySelectorAll<HTMLElement>("*"))) {
      const cls = el.className.toString();
      expect(cls).not.toContain("color-karma-merit");
      expect(cls).not.toContain("color-karma-demerit");
      expect(cls).not.toContain("color-status-error");
      expect(cls).not.toContain("color-status-success");
    }
  });

  it("treats the two counts identically, at the same size and weight", () => {
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 3 }));
    const owed = container.querySelector<HTMLElement>('[data-road-count="owed"]')!;
    const requited = container.querySelector<HTMLElement>('[data-road-count="requited"]')!;

    expect(requited.className).toBe(owed.className);
    expect(owed.className).toContain("text-xl");
  });

  it("draws the whole structure for an empty road, with no emphasis on the zero", () => {
    // The designer's own reversal, and the reason for it: the ledger counts
    // MERIT records the same way it counts DEMERIT records, so an empty right
    // road is an assessed fact, not an unassessed claim. Hiding it would make
    // the panel's shape depend on the data — a reader could no longer tell "no
    // good deeds" from "this build has no such field" — and styling the zero
    // would put the verdict back in through emphasis, which is the colour
    // argument again.
    const { container } = renderPanel(sentence({ wrongs: 4, benefactions: 0 }));
    const requited = container.querySelector<HTMLElement>('[data-road="requited"]')!;
    const zero = container.querySelector<HTMLElement>('[data-road-count="requited"]')!;
    const owedCount = container.querySelector<HTMLElement>('[data-road-count="owed"]')!;

    // Structure: label, count and caption all present, same as the other road.
    expect(requited.textContent).toBe(`${ZH.requitedLabel}0${ZH.requitedDetail}`);
    expect(zero.textContent).toBe("0");

    // No emphasis. Not a different class, not an inline style, not a role or a
    // title that would make the zero announce itself as special.
    expect(zero.className).toBe(owedCount.className);
    expect(zero.getAttribute("style")).toBeNull();
    expect(zero.getAttribute("role")).toBeNull();
    expect(zero.getAttribute("title")).toBeNull();
    expect(zero.getAttribute("aria-label")).toBeNull();

    // And the roads row still has its three cells: an empty road does not
    // collapse the fork into one column.
    expect(roadsRow(container).children).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness — the property, not the four instances of it
// ---------------------------------------------------------------------------
//
// This is the half of the fix that matters more than the Greek panel itself.
// The panel is one bug fixed; these two are what makes the *next* kind loud.

/** One payload per kind. Keyed by kind so the check below can be total. */
const SAMPLES: Record<LedgerReadingKind, LedgerReading> = {
  BALANCE: { kind: "BALANCE", civilization: "CHINESE", balance: 18, merit: 30, demerit: 12 },
  THRESHOLD: {
    kind: "THRESHOLD", civilization: "EGYPTIAN",
    heart_weight: 12, counterweight: 1, heavier_than_feather: true,
  },
  GUILT_AND_PENALTY: guiltAndPenalty([...POENA_MISSING_INPUTS]),
  SENTENCE: sentence(),
  UNAVAILABLE: { kind: "UNAVAILABLE", civilization: "UNKNOWN", reason_code: "TENANT_NOT_MAPPED" },
};

describe("SoulReadingPanel — every kind renders something", () => {
  it("has a sample for every kind and no sample for a kind that does not exist", () => {
    // `Record<LedgerReadingKind, ...>` already makes a missing entry a `tsc`
    // error; this is the run-time half, and the half that survives someone
    // widening the index signature to shut the compiler up.
    expect(Object.keys(SAMPLES).sort()).toEqual([...READING_KINDS].sort());
  });

  it.each([...READING_KINDS])("%s does not render blank", (kind) => {
    // The generalised form of the defect: not "SENTENCE was missing" but "a
    // kind can be missing and nothing says so". `undefined` from the switch
    // produces an empty container and no error of any sort.
    const { container } = renderPanel(SAMPLES[kind]);

    expect(container).not.toBeEmptyDOMElement();
    expect((container.textContent ?? "").trim()).not.toBe("");
  });

  it("says so out loud when the backend sends a kind this build has never heard of", () => {
    // The window between a backend deploy and a frontend one, which is exactly
    // the window `f92ed35` opened and nobody closed. `tsc` cannot help here —
    // the payload is data, not a type — so the `default` branch is the only
    // thing between this and a blank card.
    const unknown = { kind: "ORDEAL", civilization: "NORSE" } as unknown as LedgerReading;
    const { container } = renderPanel(unknown);

    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBeInTheDocument();
    // The kind is named, because a notice that does not say which kind is a
    // shrug. This is the one place a raw wire value on screen is the intent.
    expect(container.textContent ?? "").toContain("ORDEAL");
    expect(container.textContent ?? "").not.toContain("souls.detail.reading");
  });
});

describe("SoulReadingPanel — the unmapped tenant's copy is keyed on the reason", () => {
  it("renders the explanation and the CTA for the code it was given", () => {
    renderPanel({ kind: "UNAVAILABLE", civilization: "UNKNOWN", reason_code: "TENANT_NOT_MAPPED" });

    expect(screen.getByText(ZH.unavailableExplanation)).toBeInTheDocument();
    expect(screen.getByText(ZH.unavailableCta)).toBeInTheDocument();
  });

  it("never puts the raw reason code on screen", () => {
    const { container } = renderPanel({
      kind: "UNAVAILABLE",
      civilization: "UNKNOWN",
      reason_code: "TENANT_NOT_MAPPED",
    });
    const text = container.textContent ?? "";

    expect(text).not.toContain("TENANT_NOT_MAPPED");
    expect(text).not.toContain("souls.detail.reading");
  });
});

// ---------------------------------------------------------------------------
// Every member the backend can send must have copy in every bundle
// ---------------------------------------------------------------------------
//
// Written the way `civilizationCopyCoverage.test.ts` is written, and for the
// same reason: three-bundle parity asks whether the bundles agree with each
// other, and three bundles that are all missing the same key agree perfectly.
// This asks whether they agree with the member list the wire actually carries.

function at(bundle: unknown, path: string): unknown {
  let node: unknown = bundle;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("reading copy coverage", () => {
  it.each(Object.keys(BUNDLES))("%s has a bullet for every poena_missing member", (locale) => {
    const missing: string[] = [];

    for (const member of POENA_MISSING_INPUTS) {
      // The key is built exactly the way SoulReadingPanel builds it. Spelling
      // it out a second way here would let the two drift and this test would
      // certify a key nothing renders.
      const key = `souls.detail.reading.poena_missing_${member.toLowerCase()}`;
      const value = at(BUNDLES[locale], key);
      if (typeof value !== "string" || value.trim() === "") missing.push(key);
    }

    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s has a bullet for every elapsed_missing member", (locale) => {
    const missing: string[] = [];

    for (const member of SENTENCE_MISSING_INPUTS) {
      const key = `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`;
      const value = at(BUNDLES[locale], key);
      if (typeof value !== "string" || value.trim() === "") missing.push(key);
    }

    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s has the fixed copy the two panels need", (locale) => {
    // The SENTENCE panel's own labels, and the notice the `default` branch
    // renders. Not derived from a member list, so nothing else would miss them
    // — and a bundle without them renders a raw key where a label goes.
    const missing: string[] = [];

    for (const key of [
      "souls.detail.reading.sentence_repayment_rule",
      "souls.detail.reading.sentence_owed_label",
      "souls.detail.reading.sentence_owed_detail",
      "souls.detail.reading.sentence_requited_label",
      "souls.detail.reading.sentence_requited_detail",
      "souls.detail.reading.sentence_circuit",
      "souls.detail.reading.sentence_elapsed_label",
      "souls.detail.reading.elapsed_unavailable_heading",
      "souls.detail.reading.unrenderable_kind",
    ]) {
      const value = at(BUNDLES[locale], key);
      if (typeof value !== "string" || value.trim() === "") missing.push(key);
    }

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
    const missing: string[] = [];

    for (const code of UNAVAILABLE_REASON_CODES) {
      for (const suffix of ["explanation", "cta"]) {
        const key = `souls.detail.reading.unavailable_${code.toLowerCase()}_${suffix}`;
        const value = at(BUNDLES[locale], key);
        if (typeof value !== "string" || value.trim() === "") missing.push(key);
      }
    }

    expect(missing).toEqual([]);
  });

  it("does not let a member's copy be the raw member", () => {
    // The other way to make the two tests above green without saying anything:
    // `"poena_missing_absolution": "ABSOLUTION"`. Copy that repeats its member
    // is the untranslated value reaching the screen by a second route.
    const offenders: string[] = [];

    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      for (const member of POENA_MISSING_INPUTS) {
        const key = `souls.detail.reading.poena_missing_${member.toLowerCase()}`;
        if (at(bundle, key) === member) offenders.push(`${locale}:${key}`);
      }
      for (const member of SENTENCE_MISSING_INPUTS) {
        const key = `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`;
        if (at(bundle, key) === member) offenders.push(`${locale}:${key}`);
      }
      for (const code of UNAVAILABLE_REASON_CODES) {
        for (const suffix of ["explanation", "cta"]) {
          const key = `souls.detail.reading.unavailable_${code.toLowerCase()}_${suffix}`;
          if (at(bundle, key) === code) offenders.push(`${locale}:${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the codeless keys gone, so a second reason code cannot inherit this one's copy", () => {
    // `unavailable_explanation` / `unavailable_cta` are what the panel read
    // before the code existed. Leaving them behind would be harmless today and
    // exactly the trap `ledger.civ.UNKNOWN` was: a plausible fallback waiting
    // for the next member to fall into it.
    for (const bundle of Object.values(BUNDLES)) {
      expect(at(bundle, "souls.detail.reading.unavailable_explanation")).toBeUndefined();
      expect(at(bundle, "souls.detail.reading.unavailable_cta")).toBeUndefined();
    }
  });
});

/**
 * The em-dash occupies the slot a number would have taken. It used to carry an
 * `aria-label` set to the *same* catalogue key as the sentence rendered
 * directly beneath it, so a screen reader announced that sentence twice — once
 * as the value, once as itself. Raised in review against the shipped panel.
 *
 * The fix is `aria-hidden`, not a second shorter string: the explanation is the
 * next thing read either way, and adding a distinct name would put two
 * descriptions of one absence into the catalogue for translators to drift apart.
 *
 * What must NOT happen is the glyph acquiring an accessible name again, and
 * what must not happen either is the explanation disappearing along with it —
 * silence in that position would leave the row saying nothing at all. Both
 * halves are asserted, in both branches.
 */
describe("SoulReadingPanel — the absent value is not announced twice", () => {
  const CASES: Array<[string, () => LedgerReading, string]> = [
    ["poena", () => guiltAndPenalty([...POENA_MISSING_INPUTS]), ZH.poenaHeading],
    ["elapsed", () => sentence(), ZH.elapsedHeading],
  ];

  it.each(CASES)("%s: the heading is rendered once, not twice", (_name, build, heading) => {
    const { container } = renderPanel(build());

    // Once as visible copy...
    expect(screen.getAllByText(heading)).toHaveLength(1);
    // ...and never as an accessible name, which is what produced the double.
    expect(screen.queryAllByLabelText(heading)).toHaveLength(0);

    // The glyph is still there and still silent.
    const dash = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent?.trim() === "—"
    );
    expect(dash).toBeDefined();
    expect(dash).toHaveAttribute("aria-hidden", "true");
  });

  it.each(CASES)("%s: hiding the glyph did not take the explanation with it", (_name, build, heading) => {
    const { container } = renderPanel(build());
    // Absence assertion's complement: silence here would pass the test above.
    expect(container.textContent).toContain(heading);
  });
});
