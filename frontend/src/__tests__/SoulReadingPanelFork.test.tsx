/**
 * The fork — the prohibition drawn instead of described.
 *
 * "The two roads never combine" was, until this layout, a comment. Two figures
 * stacked in one column with a shared right edge are an invitation to subtract,
 * and nothing in the markup declined it. The fork declines it structurally:
 * there is no row spanning both roads, no shared axis, and the gap between them
 * is an empty column rather than a boundary. A derived figure has nowhere to
 * go, so adding one means adding a cell — a diff a reviewer can see.
 *
 * These assertions are about that structure. They are deliberately not
 * screenshot-shaped: a picture cannot say "there is no place to put a derived
 * number", and the DOM can.
 *
 * Split out of `SoulReadingPanel.test.tsx`; the panel's content assertions are
 * in `SoulReadingPanelSentence.test.tsx`.
 *
 * A note on the floors below. Almost every assertion here is an absence
 * enumerated over a DOM sweep — no `col-span`, no vertical rule, no merit
 * palette — and an absence is what a sweep that matched nothing also reports.
 * Each sweep therefore states the number of elements it must reach, and each
 * of those numbers was printed by a probe run against the real component
 * rather than chosen because it looked conservative.
 */
import {
  ZH,
  assertScanned,
  renderPanel,
  sentence,
} from "./support/soulReadingFixtures";

/** Measured against the rendered panel: `[data-fork]` has 23 descendants. */
const FORK_DESCENDANTS = 23;
/** Measured: the roads row has 11 descendants below it. */
const ROADS_ROW_DESCENDANTS = 11;
/** Measured: exactly one `border-l` line inside the connector's gutter cell. */
const CONNECTOR_GUTTER_LINES = 1;
/** Measured: two `[data-road]` cells, owed and requited. */
const ROADS = 2;

function fork(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-fork]");
  if (!el) throw new Error("no [data-fork] in the panel");
  return el;
}

/** The fork's descendants, having first proved the fork has any. */
function forkDescendants(container: HTMLElement): HTMLElement[] {
  const all = Array.from(fork(container).querySelectorAll<HTMLElement>("*"));
  assertScanned("sweep over the fork's descendants", all.length, FORK_DESCENDANTS);
  return all;
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

    const roads = Array.from(container.querySelectorAll<HTMLElement>("[data-road]"));
    assertScanned("roads swept for a second copy of the multiple", roads.length, ROADS);
    for (const road of roads) {
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
    const spanning = forkDescendants(container).filter(
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
    const inRow = Array.from(row.querySelectorAll<HTMLElement>("*"));
    assertScanned("roads row swept for vertical rules", inRow.length, ROADS_ROW_DESCENDANTS);
    for (const el of [row, ...inRow]) {
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
    //
    // The `continue` below is the vacuity risk this whole file is careful
    // about: a renamed class would skip every element and pass. So the lines
    // are filtered first and counted before anything is asserted about them.
    const connectorGutter = connector!.children[1] as HTMLElement;
    const lines = Array.from(connectorGutter.querySelectorAll<HTMLElement>("*")).filter((el) =>
      /(^|\s)border-l(\s|$)/.test(el.className.toString())
    );
    assertScanned("border-l lines in the connector's gutter", lines.length, CONNECTOR_GUTTER_LINES);
    for (const line of lines) {
      const cls = line.className.toString();
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

    for (const el of forkDescendants(container)) {
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
    expect(owed.className).toContain("text-06");
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
