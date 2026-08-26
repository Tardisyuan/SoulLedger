/**
 * 功过台账 —— the two things about this table that are not self-evident.
 *
 * 1. THE BOOK MUST SETTLE FORWARDS IN TIME. `LedgerService.get_ledger_summary`
 *    sends `order_by("-recorded_at")` — newest entry first
 *    (backend/apps/ledger/services.py:406). 逐條銷算 runs the other way, so the
 *    component sorts before carrying the balance down.
 *
 *    WHY THE FOOTER CANNOT GUARD THIS, which is the whole reason the running
 *    column is asserted row by row below. Addition commutes: settle the same
 *    entries in any order and the final total is identical. The fixture is
 *    built so that a component which skipped the sort would produce +30 / +18 /
 *    +23 against the correct +5 / -7 / +23 — every intermediate figure wrong,
 *    the last one right, and a footer-only test perfectly green. The failure
 *    mode of a mis-ordered ledger is not a wrong total, it is a column of
 *    numbers that answers "what is the net of everything after this line"
 *    while the heading says 销算余.
 *
 * 2. AN EMPTY SIDE STAYS EMPTY. One deed falls under 功 or under 過, never
 *    both. A `0` in the other cell asserts that nothing was earned; a `—`
 *    asserts something was earned and went unrecorded. The ledger makes
 *    neither claim, so the cell holds nothing — and "nothing" is asserted as
 *    the empty string rather than merely as "not the number", because
 *    `queryByText(0)` passing tells you nothing about what else is in there.
 *
 * 3. THE HEADINGS ARE REAL COPY, NOT KEYS. `t()` returns the key itself when a
 *    bundle has no entry (I18nContext.tsx:140), so a missing `ledger.book.*`
 *    reaches the screen as the literal string `ledger.book.col_merit` while
 *    every structural assertion above stays green — the column is still there,
 *    still ruled, still holding the right number. The real `I18nProvider` is
 *    used rather than a `t: key => key` stub for the reason
 *    `SoulReadingPanel.test.tsx` gives at length: a stub that echoes keys makes
 *    every copy assertion pass against a bundle with no copy in it.
 */
import { render } from "@testing-library/react";

import type { LedgerRecord } from "@/lib/api/ledger";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulLedgerBook } from "@/src/components/souls/SoulLedgerBook";

function record(
  over: Partial<LedgerRecord> & Pick<LedgerRecord, "id" | "type" | "original_weight" | "recorded_at">
): LedgerRecord {
  return {
    category: "GENERAL",
    description: `deed ${over.id}`,
    effective_weight: over.original_weight,
    years_elapsed: 0,
    decay_factor: 1,
    civilization: "CHINESE",
    event_date: null,
    is_milestone: false,
    ...over,
  };
}

/**
 * As the backend sends them: newest first. The weights are deliberately
 * lopsided so that settling in the wrong direction cannot coincidentally
 * produce the right intermediate figures.
 */
const RECORDS: LedgerRecord[] = [
  record({ id: "r1", type: "MERIT", original_weight: 30, recorded_at: "2020-03-01T00:00:00Z" }),
  record({ id: "r2", type: "DEMERIT", original_weight: 12, recorded_at: "2020-02-01T00:00:00Z" }),
  record({ id: "r3", type: "MERIT", original_weight: 5, recorded_at: "2020-01-01T00:00:00Z" }),
];

function renderBook(records: LedgerRecord[] = RECORDS) {
  return render(
    <I18nProvider>
      <SoulLedgerBook records={records} />
    </I18nProvider>
  );
}

/** The six cells of each body row, as text. */
function bodyRows(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim())
  );
}

describe("the book settles forwards in time", () => {
  it("carries the running balance down entries ordered oldest-first", () => {
    const { container } = renderBook();
    const running = Array.from(
      container.querySelectorAll('tbody [data-quantity-field="running_balance"]')
    ).map((el) => (el.textContent ?? "").trim());

    // +5 → -7 → +23. Settled newest-first it would read +30 / +18 / +23.
    expect(running).toEqual(["+5", "-7", "+23"]);
  });

  it("numbers and dates the entries in that same order", () => {
    const { container } = renderBook();
    const rows = bodyRows(container);

    expect(rows.map((cells) => cells[0])).toEqual(["1", "2", "3"]);
    // 条 1 is the earliest deed, r3, not the first element of the payload.
    expect(rows[0][2]).toBe("deed r3");
    expect(rows[2][2]).toBe("deed r1");
  });

  it("is not fooled by a payload that arrives already ascending", () => {
    // The sort is absolute, not a reversal, so an array in the other order
    // settles to the same book.
    const { container } = renderBook([...RECORDS].reverse());

    expect(
      Array.from(container.querySelectorAll('tbody [data-quantity-field="running_balance"]')).map(
        (el) => (el.textContent ?? "").trim()
      )
    ).toEqual(["+5", "-7", "+23"]);
  });
});

describe("功 and 过 each hold a column, and the empty one stays empty", () => {
  it("puts a merit entry under 功 and leaves 过 blank", () => {
    const { container } = renderBook();
    // Row 1 is r3, a MERIT of 5.
    const [, , , merit, demerit] = bodyRows(container)[0];

    expect(merit).toBe("+5");
    expect(demerit).toBe("");
  });

  it("puts a demerit entry under 过 and leaves 功 blank", () => {
    const { container } = renderBook();
    // Row 2 is r2, a DEMERIT of 12.
    const [, , , merit, demerit] = bodyRows(container)[1];

    expect(merit).toBe("");
    expect(demerit).toBe("-12");
  });

  it("never writes a zero or a dash into the empty side", () => {
    // Stated over the whole body rather than per row: the point is that no
    // filler reaches any empty cell, and a per-row check would go on passing
    // if a fourth row started printing one.
    const { container } = renderBook();

    for (const cells of bodyRows(container)) {
      const [, , , merit, demerit] = cells;
      expect([merit, demerit]).toContain("");
      for (const cell of [merit, demerit]) {
        expect(cell).not.toBe("0");
        expect(cell).not.toBe("—");
      }
    }
  });
});

describe("合计 appears once, at the foot", () => {
  it("totals each column and nets them", () => {
    const { container } = renderBook();
    const foot = container.querySelector("tfoot")!;
    const cells = Array.from(foot.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());

    // 功 35 = 30 + 5, 过 12, 销算余 +23.
    expect(cells[3]).toBe("+35");
    expect(cells[4]).toBe("-12");
    expect(cells[5]).toBe("+23");
  });

  it("gives no row a subtotal of its own", () => {
    // 销算余 already IS the running subtotal; a second per-row total would be
    // two numbers competing to be the same thing.
    const { container } = renderBook();

    expect(container.querySelectorAll("tfoot tr")).toHaveLength(1);
    expect(container.querySelectorAll('[data-quantity-field="net_total"]')).toHaveLength(1);
  });
});

describe("the column heads carry the book's own words", () => {
  it("names the six columns in the provider's default locale", () => {
    // zh-Hans is the provider default, so these are the strings that render.
    // Written out rather than read back out of the bundle: a test that looks up
    // `ledger.book.col_merit` and compares it to what `ledger.book.col_merit`
    // rendered agrees with itself no matter what the bundle says, including
    // when the bundle says nothing and both sides are the key.
    const { container } = renderBook();
    const heads = Array.from(container.querySelectorAll("thead th")).map((th) =>
      (th.textContent ?? "").trim()
    );

    expect(heads[0]).toBe("条");
    expect(heads[1]).toBe("日");
    expect(heads[2]).toBe("事目");
    // The three weight columns append the scale word to their heading.
    expect(heads[3]).toBe("功权重");
    expect(heads[4]).toBe("过权重");
    expect(heads[5]).toBe("销算余权重");
  });

  it("renders no raw message key anywhere in the book", () => {
    // The failure this is really about is a key that was never landed: it is
    // legible, it is in the right cell, and it is the string `ledger.book.…`.
    const { container } = renderBook();

    expect(container.textContent ?? "").not.toContain("ledger.book");
  });
});

describe("the scale is named once per column, not once per figure", () => {
  it("marks the three weight columns in the head and no cell in the body", () => {
    // `Figure` prints the marker beside every figure, which is right for a
    // panel of three numbers and would print 权重 thirty times here.
    const { container } = renderBook();

    expect(container.querySelectorAll("thead [data-quantity-scale]")).toHaveLength(3);
    expect(container.querySelectorAll("tbody [data-quantity-scale]")).toHaveLength(0);
  });
});
