/**
 * /disposition 的三段(规范 v1 第三类 A·07):待执行 → 执行中 → 期满。
 *
 * 「期满」后端没有这个状态,由 `term_start + sentence_years` 算出(src/lib/dispositionTerm.ts),
 * 所以这里既测算法,也测页面把行放进了对的段、只在规则 15 允许的两段给行尾动作。
 * 缺起算日的行不许被算成期满,也不许画一条从零开始的进度条 —— 那是替它编了一个起点。
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DispositionPage from "@/app/disposition/page";
import { dispositionApi } from "@soulledger/core/api";
import { sectionOf, termState } from "@/src/lib/dispositionTerm";
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
    sentence_years: 3, term_start: { year: year - 1, month: 1, day: 1 }, notes: "", created_at: "2026-06-18",
    ...over,
  };
}

describe("termState / sectionOf", () => {
  it("未执行一律待执行,不看期限", () => {
    expect(sectionOf(row({ id: "a", is_executed: false, term_start: { year: 1900, month: 1, day: 1 } }), NOW)).toBe("pending");
  });

  it("起算 + 年限已过 = 期满;未过 = 执行中,带比例与余下天数", () => {
    const served = row({ id: "b", term_start: { year: year - 5, month: 1, day: 1 } });
    expect(termState(served, NOW)).toMatchObject({ kind: "served", end: { year: year - 2 } });
    expect(sectionOf(served, NOW)).toBe("expired");

    const running = termState(row({ id: "c" }), NOW);
    expect(running.kind).toBe("running");
    if (running.kind !== "running") throw new Error("unreachable");
    expect(running.fraction).toBeGreaterThan(0.33);
    expect(running.fraction).toBeLessThan(0.66);
    expect(running.daysLeft).toBeGreaterThan(365);
  });

  it("永恒永不期满;缺期限、缺起算的都留在执行中,不被算成期满", () => {
    expect(termState(row({ id: "d", is_eternal: true, term_start: { year: 1, month: 1, day: 1 } }), NOW)).toEqual({ kind: "eternal" });
    expect(termState(row({ id: "e", sentence_years: null }), NOW)).toEqual({ kind: "no_term" });
    expect(termState(row({ id: "f", term_start: null }), NOW)).toEqual({ kind: "no_start", years: 3 });
    for (const id of ["d", "e", "f"]) {
      const d = id === "d" ? row({ id, is_eternal: true }) : id === "e" ? row({ id, sentence_years: null }) : row({ id, term_start: null });
      expect(sectionOf(d, NOW)).toBe("running");
    }
  });

  it("公元前起算也能算(年是带符号的)", () => {
    expect(termState(row({ id: "g", sentence_years: 1000, term_start: { year: -399, month: null, day: null } }), NOW)).toMatchObject({
      kind: "served",
      end: { year: 601 },
    });
  });
});

describe("处置页分三段,行尾动作只在待执行与期满", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    (dispositionApi.list as jest.Mock).mockResolvedValue({
      data: {
        count: 5, next: null, previous: null,
        results: [
          row({ id: "p", is_executed: false, executed_at: null }),
          row({ id: "r" }),
          row({ id: "eternal", is_eternal: true, sentence_years: null }),
          row({ id: "nostart", term_start: null }),
          row({ id: "x", term_start: { year: year - 5, month: 1, day: 1 } }),
        ],
      },
    });
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

  it("each row lands in its section", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const names = (testId: string) => screen.getAllByTestId(testId).map((r) => within(r).getByRole("link", { name: /^Soul / }).textContent);
    expect(names("disposition-pending-row")).toEqual(["Soul p"]);
    // 执行中按期满近 → 远,不计时的在后。
    expect(names("disposition-running-row")).toEqual(["Soul r", "Soul eternal", "Soul nostart"]);
    expect(names("disposition-expired-row")).toEqual(["Soul x"]);
  });

  it("待执行有「执行」、期满有「安排轮回」(去灵魂页),执行中没有任何按钮", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const [pending] = screen.getAllByTestId("disposition-pending-row");
    expect(within(pending).getByRole("button", { name: "disposition.execute" })).toBeInTheDocument();

    const [expired] = screen.getAllByTestId("disposition-expired-row");
    expect(within(expired).getByRole("link", { name: "disposition.arrange_reincarnation" })).toHaveAttribute("href", "/souls/s-x");

    for (const r of screen.getAllByTestId("disposition-running-row")) {
      expect(within(r).queryByRole("button")).toBeNull();
      expect(within(r).queryByRole("link", { name: "disposition.arrange_reincarnation" })).toBeNull();
    }
  });

  it("只有起算与年限都在的行画进度;永恒写不计时,缺起算写缺什么", async () => {
    renderPage();
    await screen.findByText("Soul p");
    const [r, eternal, nostart] = screen.getAllByTestId("disposition-running-row");
    expect(within(r).getByRole("meter")).toBeInTheDocument();
    expect(within(eternal).queryByRole("meter")).toBeNull();
    expect(within(eternal).getAllByText("disposition.term_eternal").length).toBeGreaterThan(0);
    expect(within(nostart).queryByRole("meter")).toBeNull();
    expect(within(nostart).getByText("disposition.start_unrecorded")).toBeInTheDocument();
  });
});
