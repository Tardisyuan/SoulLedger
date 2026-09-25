/**
 * /disposition 的三段(规范 v1 第三类 A·07):待执行 → 执行中 → 期满。
 *
 * 段由服务端决定:每段一次 `?section=` 查询,段标上的数是服务端的 `count`,不是本页行数;
 * 期满由服务端的期满检查写下,前端不再从 `term_start + 年限` 推算 —— 过了终点而检查还没跑到
 * 的行仍在「执行中」(条满、余 0 天),**不许**被前端挪进期满。期满段带 `soul_reborn=false`。
 * 此外:待执行有判决列(字形 ✓ ✕ ◇ ↺),行尾动作只在待执行与期满(规则 15),永恒画虚线框。
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DispositionPage from "@/app/disposition/page";
import { dispositionApi } from "@soulledger/core/api";
import { termState } from "@/src/lib/dispositionTerm";
import type { Disposition } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  dispositionApi: { list: jest.fn(), execute: jest.fn() },
  PAGE_SIZE: 20,
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
const mockTenant = {
  user: { id: 1, username: "yama", role: "JUDGE", tenant: null, permissions: ["disposition.execute"] },
};
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => mockTenant }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const NOW = Date.UTC(2026, 8, 25);
const year = new Date(NOW).getUTCFullYear();

function row(over: Partial<Disposition> & { id: string }): Disposition {
  return {
    soul: `s-${over.id}`, soul_name: `Soul ${over.id}`, judgment: "j", destination_realm: "R", realm_name: "救济门",
    is_eternal: false, is_executed: true, executed_at: "2026-01-01T00:00:00Z", memory_reset: "NONE",
    sentence_years: 3, term_start: { year: year - 1, month: 1, day: 1 }, term_end: { year: year + 2, month: 1, day: 1 },
    notes: "", created_at: "2026-06-18", verdict: "PURGATORY", expired_at: null,
    ...over,
  };
}

describe("termState:期限条的读数,不再判期满", () => {
  it("用服务端的 term_end 作终点,带比例与余下天数", () => {
    const running = termState(row({ id: "c" }), NOW);
    expect(running.kind).toBe("running");
    if (running.kind !== "running") throw new Error("unreachable");
    expect(running.end).toEqual({ year: year + 2, month: 1, day: 1 });
    // 起算去年 1 月 1 日,终点后年 1 月 1 日,现在是 9 月底:走了约 1.73 / 3。
    expect(running.fraction).toBeGreaterThan(0.5);
    expect(running.fraction).toBeLessThan(0.66);
    expect(running.daysLeft).toBeGreaterThan(365);
  });

  it("过了终点也只是画满、余 0 天 —— 期满是服务端说了算", () => {
    const past = termState(row({ id: "b", term_start: { year: year - 5, month: 1, day: 1 }, term_end: { year: year - 2, month: 1, day: 1 } }), NOW);
    expect(past).toMatchObject({ kind: "running", fraction: 1, daysLeft: 0 });
  });

  it("永恒、缺期限、缺起算各有其读数", () => {
    expect(termState(row({ id: "d", is_eternal: true }), NOW)).toEqual({ kind: "eternal" });
    expect(termState(row({ id: "e", sentence_years: null }), NOW)).toEqual({ kind: "no_term" });
    expect(termState(row({ id: "f", term_start: null, term_end: null }), NOW)).toEqual({ kind: "no_start", years: 3 });
  });

  it("旧载荷没有 term_end 时才以起算 + 年限兜底", () => {
    expect(termState(row({ id: "g", term_end: undefined }), NOW)).toMatchObject({ end: { year: year + 2 } });
  });
});

describe("处置页按服务端分三段", () => {
  const BY_SECTION: Record<string, { count: number; results: Disposition[] }> = {
    pending: {
      count: 4,
      results: [
        row({ id: "p", is_executed: false, executed_at: null, verdict: "FAILED" }),
        row({ id: "q", is_executed: false, executed_at: null, verdict: null }),
      ],
    },
    executing: {
      count: 17,
      results: [
        row({ id: "far", term_end: { year: year + 30, month: 1, day: 1 }, sentence_years: 31 }),
        row({ id: "eternal", is_eternal: true, sentence_years: null, term_end: null }),
        // 终点已过、期满检查还没跑:仍是执行中。
        row({ id: "overdue", term_start: { year: year - 5, month: 1, day: 1 }, term_end: { year: year - 2, month: 1, day: 1 } }),
        row({ id: "nostart", term_start: null, term_end: null }),
      ],
    },
    expired: {
      count: 2,
      results: [row({ id: "x", expired_at: "2026-06-01T00:00:00Z", term_end: { year, month: 6, day: 1 } })],
    },
  };

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    (dispositionApi.list as jest.Mock).mockImplementation(async (params: Record<string, string>) => ({
      data: { next: null, previous: null, section_counts: {}, ...BY_SECTION[params.section] },
    }));
  });
  afterEach(() => jest.restoreAllMocks());

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <DispositionPage />
      </QueryClientProvider>
    );
  }
  const names = (testId: string) =>
    screen.getAllByTestId(testId).map((r) => within(r).getByRole("link", { name: /^Soul / }).textContent);

  it("每段一次 section 查询;期满段藏起已转世的灵魂", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const calls = (dispositionApi.list as jest.Mock).mock.calls.map(([p]) => p);
    expect(calls).toEqual(
      expect.arrayContaining([
        { section: "pending", page: "1" },
        { section: "executing", page: "1" },
        { section: "expired", soul_reborn: "false", page: "1" },
      ])
    );
    // 没有一次不带 section 的查询:分段不在前端做。
    expect(calls.every((p) => typeof p.section === "string")).toBe(true);
  });

  it("段标的数是服务端的 count,不是本页行数", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const count = (s: string) => within(screen.getByTestId(`disposition-section-${s}`)).getByTestId("section-count").textContent;
    expect(count("pending")).toBe("4");
    expect(count("executing")).toBe("17");
    expect(count("expired")).toBe("2");
  });

  it("行按服务端的段落位;过了终点的行不被前端挪进期满", async () => {
    renderPage();
    await screen.findByText("Soul p");
    expect(names("disposition-pending-row")).toEqual(["Soul p", "Soul q"]);
    // 执行中按期满近 → 远(本页内),不计时的在后。
    expect(names("disposition-running-row")).toEqual(["Soul overdue", "Soul far", "Soul eternal", "Soul nostart"]);
    expect(names("disposition-expired-row")).toEqual(["Soul x"]);
    const [overdue] = screen.getAllByTestId("disposition-running-row");
    expect(within(overdue).getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    expect(within(overdue).getByText("disposition.days_left:0")).toBeInTheDocument();
  });

  it("待执行的判决列带字形;没有审判的写未记录", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const [p, q] = screen.getAllByTestId("disposition-pending-row");
    expect(within(p).getByText("✕", { exact: false })).toBeInTheDocument();
    expect(within(p).queryByText("◇", { exact: false })).toBeNull();
    expect(within(q).queryByText(/[✓✕◇↺]/)).toBeNull();
  });

  it("待执行有「执行」、期满有「安排轮回」(去灵魂页),执行中没有任何按钮", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const [pending] = screen.getAllByTestId("disposition-pending-row");
    expect(within(pending).getByRole("button", { name: "disposition.execute" })).toBeInTheDocument();

    const [expired] = screen.getAllByTestId("disposition-expired-row");
    expect(within(expired).getByRole("link", { name: "disposition.arrange_reincarnation" })).toHaveAttribute("href", "/souls/s-x");
    expect(within(expired).getByText(/^disposition\.expired_on:/)).toBeInTheDocument();

    for (const r of screen.getAllByTestId("disposition-running-row")) {
      expect(within(r).queryByRole("button")).toBeNull();
      expect(within(r).queryByRole("link", { name: "disposition.arrange_reincarnation" })).toBeNull();
    }
  });

  it("永恒画虚线框不画进度;缺起算写缺什么", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const rows = screen.getAllByTestId("disposition-running-row");
    const eternal = rows.find((r) => r.textContent?.includes("Soul eternal"))!;
    const nostart = rows.find((r) => r.textContent?.includes("Soul nostart"))!;
    expect(within(eternal).queryByRole("meter")).toBeNull();
    expect(eternal.querySelector('[data-term-bar="eternal"]')?.className).toContain("border-dashed");
    expect(within(eternal).getAllByText("disposition.term_eternal").length).toBeGreaterThan(0);
    expect(within(nostart).queryByRole("meter")).toBeNull();
    expect(within(nostart).getByText("disposition.start_unrecorded")).toBeInTheDocument();
  });
});
