/**
 * app/ledger/page.tsx —— 功过总账:四柱、按日分组的流水、日小计与本页合计、
 * 图例账,以及加载 / 空 / 失败三屏。
 *
 * 真 I18nProvider(zh-Hans),不用回显键的替身:断言落在操作员读到的字上,
 * 一个缺失的键会作为原样的 key 出现在屏上并让断言红。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LedgerJournal } from "@soulledger/core/api";
import LedgerPage from "@/app/ledger/page";
import { ledgerApi } from "@soulledger/core/api";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { currentMonth, groupByDay, shiftMonth, signed } from "@/src/lib/ledgerJournal";

jest.mock("@soulledger/core/api", () => ({
  ledgerApi: { journal: jest.fn() },
}));

type MockUser = { id: number; role?: string; permissions?: string[] };
let mockUser: MockUser | null = { id: 1, role: "VIEWER", permissions: ["ledger.read"] };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

const mockedJournal = ledgerApi.journal as jest.Mock;

const row = (id: string, day: string, type: "MERIT" | "DEMERIT", weight: number, soul = "沈青梧") => ({
  id,
  soul_id: `soul-${soul}`,
  soul_name: soul,
  record_type: type,
  category: type === "MERIT" ? "CHARITY" : "DECEPTION",
  description: `${id} 事目`,
  weight,
  statute_clause: type === "MERIT" ? "救濟門#7:賑濟窮民百錢" : "",
  recorded_at: `${day}T09:12:00Z`,
  day,
});

const JOURNAL: LedgerJournal = {
  month: "2026-06",
  opening: 18420,
  received: 3912,
  disbursed: 2640,
  closing: 19692,
  soul_count: 33,
  record_count: 214,
  categories: [
    { category: "CHARITY", merit: 1480, demerit: 0 },
    { category: "DECEPTION", merit: 0, demerit: 980 },
  ],
  page: 1,
  page_size: 20,
  count: 214,
  results: [
    row("a", "2026-06-16", "MERIT", 40, "周慕云"),
    row("b", "2026-06-16", "DEMERIT", 120, "Marguerite Vey"),
    row("c", "2026-06-15", "DEMERIT", 25),
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return render(<LedgerPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  mockUser = { id: 1, role: "VIEWER", permissions: ["ledger.read"] };
  mockedJournal.mockReset();
});

describe("pure helpers", () => {
  it("formats signed figures with a real minus and a bare zero", () => {
    expect([signed(3912), signed(-2640), signed(0)]).toEqual(["+3,912", "−2,640", "0"]);
  });

  it("steps months across the year boundary in UTC", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(currentMonth(new Date(Date.UTC(2026, 5, 30, 23, 59)))).toBe("2026-06");
  });

  it("groups consecutive rows by the server's day, keeping arrival order", () => {
    expect(groupByDay(JOURNAL.results).map((g) => [g.day, g.rows.length])).toEqual([
      ["2026-06-16", 2],
      ["2026-06-15", 1],
    ]);
  });
});

describe("the four pillars", () => {
  it("prints 旧管 + 新收 − 开除 = 实在, the double line only under 实在", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    renderPage();
    const pillars = await screen.findByTestId("four-pillars");
    const cells = Array.from(pillars.querySelectorAll("[data-pillar]"));
    expect(cells.map((c) => c.getAttribute("data-pillar"))).toEqual(["opening", "received", "disbursed", "closing"]);
    expect(cells.map((c) => c.querySelector("dd")?.textContent)).toEqual(["+18,420", "+3,912", "−2,640", "+19,692"]);
    expect(cells[3].className).toContain("border-double");
    expect(cells.slice(0, 3).some((c) => c.className.includes("border-double"))).toBe(false);
    expect(screen.getByTestId("ledger-formula")).toHaveTextContent("旧管 + 新收 − 开除 = 实在 · 33 户 · 本期 214 条");
  });

  it("asks for the current month first and the chosen month after stepping back", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    renderPage();
    await screen.findByTestId("four-pillars");
    expect(mockedJournal).toHaveBeenLastCalledWith({ month: currentMonth(), page: 1 });
    fireEvent.click(screen.getByRole("button", { name: "上一月" }));
    await waitFor(() =>
      expect(mockedJournal).toHaveBeenLastCalledWith({ month: shiftMonth(currentMonth(), -1), page: 1 })
    );
  });
});

describe("the journal", () => {
  it("groups by day with a single-line subtotal, and closes the page with a double-line total", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    renderPage();
    const journal = await screen.findByTestId("ledger-journal");
    const subtotals = within(journal).getAllByTestId("day-subtotal");
    expect(subtotals.map((s) => s.textContent)).toEqual(["小计 +40 / −120", "小计 0 / −25"]);
    const total = within(journal).getByTestId("page-total");
    expect(total).toHaveTextContent("本页合计 · 3 条");
    expect(total).toHaveTextContent("+40");
    expect(total).toHaveTextContent("−145");
    expect(total.className).toContain("border-double");
  });

  it("makes the whole row one link to that soul's 乙 · 功过", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    renderPage();
    const link = await screen.findByRole("link", { name: "周慕云" });
    expect(link).toHaveAttribute("href", "/souls/soul-周慕云#soul-karma");
    expect(link.className).toContain("after:inset-0");
    // 一行只有一个链接 —— 不再有行尾「查看 →」。
    const rowEl = link.closest("[data-journal-row]")!;
    expect(within(rowEl as HTMLElement).getAllByRole("link")).toHaveLength(1);
  });

  it("shows the basis when recorded and a typed miss (not blank) when not", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    const { container } = renderPage();
    await screen.findByTestId("ledger-journal");
    const rows = container.querySelectorAll("[data-journal-row]");
    expect(rows[0]).toHaveTextContent("救濟門#7:賑濟窮民百錢");
    expect(rows[1].querySelector('[data-missing="unrecorded"]')).not.toBeNull();
  });

  it("feeds each category's merit and demerit into the legend ledger as separate rows", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    const { container } = renderPage();
    await screen.findByTestId("ledger-journal");
    const legend = container.querySelector("[data-legend-ledger]")!;
    expect(Array.from(legend.querySelectorAll("[data-legend-row]"), (r) => r.getAttribute("data-legend-row"))).toEqual([
      "CHARITY:M",
      "DECEPTION:D",
    ]);
    expect(legend).toHaveTextContent("布施 · 收");
    expect(legend).toHaveTextContent("1480");
  });

  it("offers the next page when there is one", async () => {
    mockedJournal.mockResolvedValue({ data: JOURNAL });
    renderPage();
    await screen.findByTestId("ledger-journal");
    expect(screen.getByText("1–20 / 214")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(mockedJournal).toHaveBeenLastCalledWith({ month: currentMonth(), page: 2 }));
  });
});

describe("加载中 / 空 / 失败 是三屏", () => {
  it("gives a skeleton on first load, not an empty ledger", async () => {
    mockedJournal.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByTestId("ledger-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("four-pillars")).toBeNull();
  });

  it("says an empty month is empty, with the opening carried to the closing", async () => {
    mockedJournal.mockResolvedValue({
      data: { ...JOURNAL, received: 0, disbursed: 0, closing: 18420, record_count: 0, soul_count: 0, count: 0, results: [], categories: [] },
    });
    renderPage();
    expect(await screen.findByText("本期没有流水")).toBeInTheDocument();
    expect(screen.getByText("2026-06 尚无功过登记;旧管 = 实在 = +18,420。")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-journal")).toBeNull();
  });

  it("says a failure is a failure, with a retry, and draws no pillars", async () => {
    mockedJournal.mockRejectedValue(new Error("500"));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("功过总账加载失败");
    expect(screen.queryByTestId("four-pillars")).toBeNull();
  });

  it("does not call the endpoint when there is no user", () => {
    mockUser = null;
    renderPage();
    expect(mockedJournal).not.toHaveBeenCalled();
  });
});
