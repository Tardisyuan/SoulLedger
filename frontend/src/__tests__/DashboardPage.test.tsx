/**
 * Tests for app/dashboard/page.tsx.
 *
 * Two things here are worth guarding. First the permission gate: the ledger
 * tab exposes admin-only figures, and both the tab *and* the panel behind it
 * have to refuse a non-admin — a gate that only hides the tab is no gate at
 * all, since the tab is selected from the query string. Second
 * bucketMidpoint(), which turns "< -50" / "-5 to 5" / "> 50" bucket labels
 * into an average balance; a wrong parse there produces a plausible-looking
 * number and nothing else.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardPage from "@/app/dashboard/page";
import { deathSyncApi, dispatchApi, judgmentApi, ledgerApi } from "@soulledger/core/api";
import { tZh, zh } from "./support/zhBundle";

const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearch,
}));

jest.mock("@soulledger/core/api", () => ({
  ledgerApi: { statsOverview: jest.fn(), exportStats: jest.fn() },
  dispatchApi: { proposed: jest.fn() },
  judgmentApi: { next: jest.fn() },
  deathSyncApi: { summary: jest.fn() },
  menusApi: { all: jest.fn().mockResolvedValue({ data: [] }), list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const mockShowToast = jest.fn();
const mockT = jest.fn((key: string, _params?: Record<string, string>) => key);
let mockUser: { role: string; permissions?: string[] } | null = { role: "ADMIN" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => mockT(key, params),
    formatDateTime: (v: string) => `dt(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));

const mockedStats = ledgerApi.statsOverview as jest.Mock;
const mockedProposed = dispatchApi.proposed as jest.Mock;
const mockedNext = judgmentApi.next as jest.Mock;
const mockedDeathSummary = deathSyncApi.summary as jest.Mock;
const mockedExport = ledgerApi.exportStats as jest.Mock;

/** 服务端的等宽直方图:[-300, 300) 每 50 一格,两端开口 —— 共 14 格。 */
const histogramBuckets = [
  { min: null, max: -300, count: 1 },
  ...Array.from({ length: 12 }, (_, i) => ({ min: -300 + 50 * i, max: -250 + 50 * i, count: i === 5 ? 2 : i === 6 ? 3 : 0 })),
  { min: 300, max: null, count: 4 },
];

const baseStats = {
  as_of: "2026-10-02T08:00:00Z",
  total_souls: 4,
  average_balance: -15,
  // `label` 是**枚举成员原样**,不是英文标签。
  //
  // 这份夹具原来写的是 `"Alive"` / `"Judging"` / `"Disposed"`,而后端
  // (`apps/ledger/views.py`)写的是 `{"label": s}` —— SCREAMING_SNAKE 原样。
  // 夹具和它旁边那条注释一起,把一个不存在的接线说成了事实,于是下面两条测试
  // **钉住的是那个不存在的接线**。
  state_distribution: [
    { state: "ALIVE", label: "ALIVE", count: 2, average_balance: 12.5 },
    { state: "JUDGING", label: "JUDGING", count: 1, average_balance: -40 },
    { state: "DISPOSED", label: "DISPOSED", count: 1, average_balance: null },
  ],
  tenants: [
    { tenant_code: "CN_DIYU", tenant_name: "地府", total_souls: 3, state_breakdown: { ALIVE: 2, JUDGING: 1 } },
    { tenant_code: "EG_DUAT", tenant_name: "", total_souls: 1, state_breakdown: { DISPOSED: 1 } },
  ],
  souls_by_realm: [{ realm_code: "R1", realm_name: "Diyu", civilization: "CHINESE", realm_type: "HELL", count: 3, capacity: 8, held: 2 }],
  karma_distribution: [
    { label: "< -50", count: 2 },
    { label: "-5 to 5", count: 3 },
    { label: "> 50", count: 1 },
    { label: "unparseable", count: 5 },
  ],
  balance_histogram: { bucket_width: 50, buckets: histogramBuckets, total: 10 },
  recent_activity: [
    { id: 1, action: "CREATE", description: "made a soul", user: "admin", resource: "Soul", timestamp: "T1" },
    { id: 2, action: "CREATE", description: "", user: "admin", resource: "SoulResource", timestamp: "T2" },
    { id: 3, action: "WEIRD_ACTION", description: "odd", user: "clerk", resource: "X", timestamp: "T3" },
  ],
};

/** Waits until `selector` exists — a waitFor callback has to THROW to keep waiting. */
async function found(container: HTMLElement, selector: string): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
  return container.querySelector(selector) as HTMLElement;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<DashboardPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockUser = { role: "ADMIN" };
  mockT.mockImplementation((key: string) => key);
  mockedStats.mockResolvedValue({ data: baseStats });
  mockedProposed.mockResolvedValue({ data: { count: 1, results: [] } });
  mockedNext.mockResolvedValue({ data: { total: 0 } });
  mockedDeathSummary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 3 } });
});

// ── Overview tab ─────────────────────────────────────────────────────

describe("DashboardPage overview", () => {
  it("renders the lifecycle row from the payload, in lifecycle order", async () => {
    renderPage();

    // Selected by `data-kpi`, not by class name (a KPI test must not fail
    // because the cards changed size). ALIVE / JUDGING / DISPOSED /
    // REINCARNATING / SETTLED — the last two absent from the payload, so 0.
    await waitFor(() =>
      expect(Array.from(document.querySelectorAll<HTMLElement>("[data-kpi]")).map((el) => el.textContent)).toEqual([
        "2", "1", "1", "0", "0",
      ])
    );
  });

  it("falls back to zero for a state the payload omits", async () => {
    mockedStats.mockResolvedValue({ ...baseStats, data: { ...baseStats, state_distribution: [] } });

    renderPage();

    await waitFor(() => expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3));
  });

  describe("图例账 — no pie chart, every number in a row", () => {
    it("draws no pie and puts each state's count and share in its own ledger row", async () => {
      const { container } = renderPage();
      const ledger = await found(container, "[data-legend-ledger]");
      expect(screen.queryByTestId("pie")).not.toBeInTheDocument();
      // 2 of 4 alive: the row carries both numbers, beside the swatch, not on it.
      const alive = ledger.querySelector('[data-legend-row="ALIVE"]') as HTMLElement;
      expect(alive).toHaveTextContent("2");
      expect(alive).toHaveTextContent("50%");
      const judging = ledger.querySelector('[data-legend-row="JUDGING"]') as HTMLElement;
      expect(judging).toHaveTextContent("25%");
      // A zero state is still a row (0, 0%), never a vanished legend entry.
      expect(ledger.querySelector('[data-legend-row="SETTLED"]')).toHaveTextContent("0%");
    });

    it("翻译缺失时,图例账里不会出现裸枚举成员", async () => {
      mockT.mockImplementation((key: string) => key);
      const { container } = renderPage();
      const ledger = await found(container, "[data-legend-ledger]");
      expect(ledger).not.toHaveTextContent("ALIVE");
      expect(ledger).not.toHaveTextContent("JUDGING");
    });

    it("**断存在。** 有翻译时用翻译", async () => {
      mockT.mockImplementation((key: string) => (key === "souls.states.ALIVE" ? "存活" : key));
      const { container } = renderPage();
      await waitFor(() =>
        expect(container.querySelector('[data-legend-row="ALIVE"]')).toHaveTextContent("存活")
      );
    });
  });

  it("renders the error text, and no empty-state copy, when the query fails", async () => {
    mockedStats.mockRejectedValue(new Error("500"));

    renderPage();

    expect(await screen.findByText("dashboard.error_load")).toBeInTheDocument();
    expect(screen.queryByText("dashboard.no_activity")).not.toBeInTheDocument();
  });

  it("lists all four civilizations; one with no souls says so and links to register", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('[data-civ-row="CHINESE"]')).toHaveTextContent("3"));
    expect(container.querySelector('[data-civ-row="CHINESE"]')).toHaveTextContent("75%");
    expect(container.querySelector('[data-civ-row="EGYPTIAN"]')).toHaveTextContent("25%");
    const greek = container.querySelector('[data-civ-row="GREEK"]') as HTMLElement;
    expect(greek).toHaveTextContent("0");
    expect(greek.querySelector("a")).toHaveAttribute("href", "/souls");
    // Four rows, not "as many as tenants happened to come back".
    expect(container.querySelectorAll("[data-civ-row]")).toHaveLength(4);
  });

  it("draws the fixed-width histogram (每格 50, −300…+300, open ends) by the sign of each bucket — never a status colour (Design A4)", async () => {
    const { container } = renderPage();
    await found(container, "[data-histogram-bar]");
    const bars = Array.from(container.querySelectorAll<HTMLElement>("[data-histogram-bar]"));
    // `balance_histogram`, not the seven old `karma_distribution` buckets.
    expect(bars).toHaveLength(14);
    expect(bars.map((b) => b.getAttribute("data-histogram-bar"))).not.toContain("-5 to 5");
    const bar = (label: string) => bars.find((el) => el.getAttribute("data-histogram-bar") === label) as HTMLElement;
    const fill = (label: string) => bar(label).querySelector("[aria-hidden]")?.className ?? "";
    expect(bar("< −300")).toHaveTextContent("1");
    expect(bar("−50 – 0")).toHaveTextContent("2");
    expect(bar("0 – +50")).toHaveTextContent("3");
    expect(bar("≥ +300")).toHaveTextContent("4");
    // [−50, 0) is the negative side (4th ramp step); [0, 50) the positive side (2nd).
    expect(fill("−50 – 0")).toMatch(/^block w-full bg-\[oklch\(var\(--color-chart-4\)\)\]$/);
    expect(fill("0 – +50")).toMatch(/^block w-full bg-\[oklch\(var\(--color-chart-2\)\)\]$/);
    // The 0 line sits on the boundary between them: 7 of 14 buckets.
    expect(container.querySelector<HTMLElement>("[data-zero-line]")?.style.left).toBe("50%");
    // Ticks −300 / −150 / 0 / +150 / +300 at those buckets' lower edges.
    const ticks = Array.from(container.querySelectorAll<HTMLElement>("[data-histogram-tick]"));
    expect(ticks.map((t) => [t.textContent, t.style.left])).toEqual([
      ["−300", `${(1 / 14) * 100}%`],
      ["−150", `${(4 / 14) * 100}%`],
      ["0", "50%"],
      ["+150", `${(10 / 14) * 100}%`],
      ["+300", `${(13 / 14) * 100}%`],
    ]);
    expect(screen.getByText(/dashboard\.bucket_width/)).toBeInTheDocument();
    // 只数已处置的(Design A4「已处置 · 每格 50」):n 是直方图自己的 total(10),不是 total_souls(4)。
    const scope = container.querySelector("[data-histogram-scope]");
    expect(scope).toHaveTextContent(/^dashboard\.disposed · n = 10 · dashboard\.bucket_width$/);
    expect(scope).not.toHaveTextContent("n = 4");
    // Absence: no feedback colour anywhere in the histogram.
    expect(container.querySelector("[data-histogram]")?.innerHTML).not.toMatch(/--color-(danger|success)/);
  });

  it("图例账:生命周期占梯度第 1–5 档,迷失是第 1 档空框、排在最后(v2 A5 / D 组)", async () => {
    mockedStats.mockResolvedValue({
      ...baseStats,
      data: { ...baseStats, state_distribution: [{ state: "LOST", label: "LOST", count: 1 }, ...baseStats.state_distribution] },
    });
    const { container } = renderPage();
    const ledger = await found(container, "[data-legend-ledger]");
    await waitFor(() => expect(ledger.querySelector('[data-legend-row="LOST"]')).not.toBeNull());
    const rows = Array.from(ledger.querySelectorAll<HTMLElement>("[data-legend-row]")).map((r) => r.dataset.legendRow);
    expect(rows).toEqual(["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED", "LOST"]);
    const swatch = (state: string) => ledger.querySelector(`[data-legend-row="${state}"] > span`)?.className ?? "";
    ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"].forEach((state, i) =>
      expect(swatch(state)).toContain(`bg-[oklch(var(--color-chart-${i + 1}))]`)
    );
    expect(swatch("LOST")).toContain("border-[oklch(var(--color-chart-1))]");
    expect(swatch("LOST")).not.toContain("bg-");
    expect(ledger.innerHTML).not.toContain("--color-status-");
  });

  describe("待办 row", () => {
    it("shows the approval inbox count with its link, and a zero queue as 「无待办」 without one", async () => {
      renderPage();
      const link = await screen.findByRole("link", { name: "dashboard.todo.go_approve" });
      expect(link).toHaveAttribute("href", "/dispatch");
      // The count comes from the inbox endpoint, not the both-directions list.
      expect(mockedProposed).toHaveBeenCalled();
      expect(await screen.findByText("dashboard.todo.none")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "dashboard.todo.enter" })).not.toBeInTheDocument();
    });

    it("links into the queue when something is waiting", async () => {
      mockedNext.mockResolvedValue({ data: { total: 2 } });
      renderPage();
      expect(await screen.findByRole("link", { name: "dashboard.todo.enter" })).toHaveAttribute("href", "/judgment/queue");
    });

    it("a failed count is an error, not a zero", async () => {
      mockedProposed.mockRejectedValue(new Error("500"));
      renderPage();
      expect(await screen.findByText("dashboard.todo.load_error")).toBeInTheDocument();
    });

    it("a failed cell fails alone: the others still count, and 重试 refetches only that one", async () => {
      mockedProposed.mockRejectedValueOnce(new Error("500")).mockResolvedValue({ data: { count: 4, results: [] } });
      const { container } = renderPage();
      const retry = await screen.findByRole("button", { name: "common.retry" });
      // The queue and death-sync cells still show their numbers beside the failure.
      const counts = () => Array.from(container.querySelectorAll("[data-todo-count]")).map((el) => el.textContent);
      await waitFor(() => expect(counts()).toEqual(["0", "3"]));
      const nextCalls = mockedNext.mock.calls.length;
      fireEvent.click(retry);
      await waitFor(() => expect(counts()).toEqual(["4", "0", "3"]));
      expect(screen.queryByText("dashboard.todo.load_error")).not.toBeInTheDocument();
      expect(mockedNext.mock.calls.length).toBe(nextCalls);
    });

    it("marks only the cells that need me (count > 0); an empty cell shows 0 and stays", async () => {
      // dispatch 1, queue 0, death-sync 3 (beforeEach)
      const { container } = renderPage();
      await screen.findByText("dashboard.todo.unbooked");
      const cells = Array.from(container.querySelectorAll<HTMLElement>("[data-todo]"));
      expect(cells).toHaveLength(3);
      expect(cells.map((c) => c.hasAttribute("data-todo-mine"))).toEqual([true, false, true]);
      expect(cells.map((c) => c.querySelectorAll('[data-testid="row-mark"]').length)).toEqual([1, 0, 1]);
      expect(cells[1].querySelector("[data-todo-count]")).toHaveTextContent("0");
      expect(cells[1]).toHaveTextContent("dashboard.todo.none");
    });

    it("a clean death sync says so, without the 未入簿 alarm", async () => {
      mockedDeathSummary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 0 } });
      renderPage();
      expect(await screen.findByText("dashboard.todo.sync_ok")).toBeInTheDocument();
      expect(screen.queryByText("dashboard.todo.unbooked")).not.toBeInTheDocument();
    });

    it("counts death-sync anomalies for an admin and links to the status the server counted", async () => {
      mockedDeathSummary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 3 } });
      renderPage();
      const link = await screen.findByRole("link", { name: "dashboard.todo.go_view" });
      expect(link).toHaveAttribute("href", "/death-sync?status=FAILED");
      expect(screen.getByText("dashboard.todo.death_sync_anomaly")).toBeInTheDocument();
    });

    it("has no death-sync cell, and asks nothing, for a non-admin who holds the other two", async () => {
      mockUser = { role: "JUDGE", permissions: ["dispatch.read", "judgment.read"] };
      renderPage();
      await screen.findByText("dashboard.todo.approve_dispatch");
      expect(screen.queryByText("dashboard.todo.death_sync_anomaly")).not.toBeInTheDocument();
      expect(mockedDeathSummary).not.toHaveBeenCalled();
    });

    it("is not shown, and asks nothing, for someone who may open neither page", async () => {
      mockUser = { role: "VIEWER", permissions: [] };
      renderPage();
      await screen.findByText("made a soul");
      expect(screen.queryByText("dashboard.todo.approve_dispatch")).not.toBeInTheDocument();
      expect(mockedProposed).not.toHaveBeenCalled();
      expect(mockedNext).not.toHaveBeenCalled();
      expect(mockedDeathSummary).not.toHaveBeenCalled();
    });
  });

  it("draws each realm bar in its realm type's pattern (A5: 炼狱实底 / 天界半色 / 地狱斜线 / 中立空框)", async () => {
    const realm = (code: string, realm_type: string, count: number) =>
      ({ realm_code: code, realm_name: code, civilization: "CHINESE", realm_type, count });
    mockedStats.mockResolvedValue({
      data: {
        ...baseStats,
        souls_by_realm: [realm("H", "HELL", 4), realm("P", "PURGATORY", 3), realm("B", "BLISS", 2), realm("N", "NEUTRAL", 1)],
      },
    });
    const { container } = renderPage();
    await found(container, "[data-realm-bar]");
    const drawn = Array.from(container.querySelectorAll<HTMLElement>("[data-realm-bar]")).map(
      (el) => `${el.getAttribute("data-realm-bar")}:${el.querySelector("[data-pattern]")?.getAttribute("data-pattern")}`
    );
    expect(drawn).toEqual(["H:hatch", "P:solid", "B:half", "N:outline"]);
    // Absence: the four patterns are drawn in one ramp step, no realm-type hue.
    expect(container.querySelector("[data-realm-bars]")?.innerHTML).not.toMatch(/--color-(chart-[2-6]|danger|success|warning|civ)/);
  });

  it("shows a placeholder instead of a realm chart when there are no realms", async () => {
    mockedStats.mockResolvedValue({ data: { ...baseStats, souls_by_realm: [] } });

    renderPage();

    expect(await screen.findByText("dashboard.no_realm_data")).toBeInTheDocument();
  });

  it("groups recent activity by action and counts each group in bundle copy", async () => {
    // Real zh-Hans here, not key-echo: with an echoing `t` every enum member
    // renders as "unrecognised", and this test used to pin `CREATE` — the raw
    // member — as the correct output (FT-01, 2026-09-12).
    mockT.mockImplementation(tZh);
    renderPage();

    // §4.6: translated copy in the text node, the raw member only in `title`.
    expect(await screen.findByText(zh("audit.actions.CREATE"))).toBeInTheDocument();
    expect(screen.getByTitle("CREATE")).toBeInTheDocument();
    expect(screen.queryByText("CREATE")).not.toBeInTheDocument();
    // A member the bundle does not know is "unrecognised", never verbatim.
    expect(screen.getByTitle("WEIRD_ACTION")).toHaveTextContent(zh("common.value.unrecognized"));
    expect(screen.queryByText("WEIRD_ACTION")).not.toBeInTheDocument();
    // The two CREATE rows collapse into one group. The count was English-only
    // (`"action" : "actions"`) inline in the page; it is bundle copy now.
    expect(screen.getByText(zh("dashboard.activity_count", { count: "2" }))).toBeInTheDocument();
    expect(screen.getByText(zh("dashboard.activity_count", { count: "1" }))).toBeInTheDocument();
    expect(screen.queryByText("2 actions")).not.toBeInTheDocument();
  });

  it("falls back to the resource name when an activity row has no description", async () => {
    renderPage();

    expect(await screen.findByText("made a soul")).toBeInTheDocument();
    expect(screen.getByText("SoulResource")).toBeInTheDocument();
  });

  it("shows the empty state when there is no recent activity", async () => {
    mockedStats.mockResolvedValue({ data: { ...baseStats, recent_activity: [] } });

    renderPage();

    expect(await screen.findByText("dashboard.no_activity")).toBeInTheDocument();
  });
});

// ── Permission gate ──────────────────────────────────────────────────

describe("DashboardPage permission gate", () => {
  it("shows the ledger tab to an admin", async () => {
    renderPage();

    expect(await screen.findByText("dashboard.tab_ledger")).toBeInTheDocument();
  });

  it("hides the ledger tab from a non-admin", async () => {
    mockUser = { role: "JUDGE", permissions: ["karma.export"] };

    renderPage();

    await screen.findByText("dashboard.tab_overview");
    expect(screen.queryByText("dashboard.tab_ledger")).not.toBeInTheDocument();
  });

  it("refuses the ledger panel to a non-admin who reaches it via ?tab=ledger", async () => {
    mockUser = { role: "JUDGE", permissions: [] };
    mockSearch = new URLSearchParams("tab=ledger");

    renderPage();

    await waitFor(() => expect(screen.queryByText("admin.avg_balance")).not.toBeInTheDocument());
    expect(screen.queryByText("dashboard.top_realms")).not.toBeInTheDocument();
  });

  it("renders the ledger panel for an admin at ?tab=ledger", async () => {
    mockSearch = new URLSearchParams("tab=ledger");

    renderPage();

    expect((await screen.findAllByText("admin.avg_balance")).length).toBeGreaterThan(0);
    // The overview-only cards must be gone.
    expect(screen.queryByTestId("pie")).not.toBeInTheDocument();
  });

  // These two used to gate on `karma.export`. That string is not in the
  // backend's 46-codename catalogue and no role holds it -- the whole `karma.*`
  // family was renamed to `ledger.*` by perm/0016, and there was never a
  // `.export` member. `/ledger/stats/export/` checks `role == "ADMIN"` in the
  // view body.
  //
  // So the second test constructed a user production cannot produce (a JUDGE
  // holding a codename nobody can hold) and asserted the button appeared --
  // which it did, but only because `hasPermission` short-circuits ADMIN... no:
  // because the *mocked* hook was told the permission was present. The test
  // exercised its own stub. The real gate was "ADMIN only" by accident, and
  // it is now `<RequireAdmin>` by intent.
  it("hides the export button from a non-admin", async () => {
    mockUser = { role: "JUDGE", permissions: ["souls.read", "ledger.read"] };

    renderPage();

    await screen.findByText("dashboard.tab_overview");
    expect(screen.queryByText("dashboard.export_stats")).not.toBeInTheDocument();
  });

  it("hides it from a non-admin however many codenames they hold", async () => {
    // The point of RequireAdmin: no codename opens this gate, so no future
    // grant can open it by accident either.
    mockUser = {
      role: "MODERATOR",
      permissions: ["ledger.read", "ledger.manage", "karma.export"],
    };

    renderPage();

    await screen.findByText("dashboard.tab_overview");
    expect(screen.queryByText("dashboard.export_stats")).not.toBeInTheDocument();
  });

  it("shows the export button to an admin", async () => {
    mockUser = { role: "ADMIN", permissions: [] };

    renderPage();

    expect(await screen.findByText("dashboard.export_stats")).toBeInTheDocument();
  });
});

// ── Ledger tab arithmetic ────────────────────────────────────────────

describe("DashboardPage ledger tab", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams("tab=ledger");
  });

  it("较上月: the server's delta in mono with a true minus; the half-sentence is absent without a previous snapshot", async () => {
    mockedStats.mockResolvedValue({
      data: { ...baseStats, average_balance: 42.7, average_balance_prev_month: 44, average_balance_delta: -1.3 },
    });
    const first = renderPage();
    const delta = await found(first.container, "[data-avg-delta]");
    expect(delta).toHaveTextContent(/^−1\.3$/);
    expect(delta.parentElement).toHaveTextContent("dashboard.avg_scope · dashboard.vs_last_month −1.3");
    first.unmount();

    // No snapshot for last month: null, and the card says only its scope — not 0.0, not 未记录.
    mockedStats.mockResolvedValue({
      data: { ...baseStats, average_balance: 42.7, average_balance_prev_month: null, average_balance_delta: null },
    });
    const { container } = renderPage();
    await found(container, "[data-avg-balance]");
    expect(container.querySelector("[data-avg-delta]")).toBeNull();
    expect(screen.queryByText(/dashboard\.vs_last_month/)).toBeNull();
    expect(screen.getByText("dashboard.avg_scope")).toBeInTheDocument();
  });

  it("shows the server's exact mean balance, signed, one decimal — not a bucket-midpoint estimate", async () => {
    // The old buckets' midpoints would give (-60 * 2 + 60 * 1) / 4 = -15.0 too, so move the
    // server's number off it: what is printed must be `average_balance` and nothing else.
    mockedStats.mockResolvedValue({ data: { ...baseStats, average_balance: 42.7 } });
    const { container } = renderPage();

    expect(await screen.findByText("+42.7")).toBeInTheDocument();
    expect(container.querySelector("[data-avg-balance]")).toHaveTextContent("+42.7");
    expect(screen.queryByText("-15.0")).not.toBeInTheDocument();
  });

  it("writes 未记录, not 0.0, when there are no souls to average", async () => {
    mockedStats.mockResolvedValue({ data: { ...baseStats, total_souls: 0, average_balance: null } });
    const { container } = renderPage();

    const avg = await found(container, "[data-avg-balance]");
    expect(avg.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(avg).not.toHaveTextContent("0.0");
  });

  it("gives each state its mean balance; a state with no souls is 不适用, not 0", async () => {
    const { container } = renderPage();

    const cell = async (state: string) => found(container, `[data-avg-of="${state}"]`);
    expect(await cell("ALIVE")).toHaveTextContent("+12.5");
    expect(await cell("JUDGING")).toHaveTextContent("-40.0");
    const disposed = await cell("DISPOSED");
    expect(disposed.querySelector('[data-missing="inapplicable"]')).not.toBeNull();
    expect(disposed).not.toHaveTextContent("0.0");
  });

  it("占容量: held / capacity as a percentage; 「■ 满」 at held ≥ capacity; 未记录 without a capacity", async () => {
    mockedStats.mockResolvedValue({
      data: {
        ...baseStats,
        souls_by_realm: [
          { realm_code: "A", realm_name: "Half", civilization: "CHINESE", realm_type: "HELL", count: 9, capacity: 8, held: 4 },
          { realm_code: "B", realm_name: "Full", civilization: "CHINESE", realm_type: "HELL", count: 5, capacity: 5, held: 5 },
          { realm_code: "C", realm_name: "Open", civilization: "CHINESE", realm_type: "HELL", count: 1, capacity: null, held: 3 },
        ],
      },
    });
    renderPage();

    const row = async (name: string) => (await screen.findByText(name)).closest("tr") as HTMLElement;
    const half = await row("Half");
    expect(half.querySelector("[data-occupancy]")).toHaveTextContent(/^50%$/);
    const full = await row("Full");
    expect(full.querySelector('[data-occupancy="full"]')).toHaveTextContent("■ realms.table.full");
    expect(full).not.toHaveTextContent("100%");
    const open = await row("Open");
    expect(open.querySelector("[data-occupancy]")).toBeNull();
    expect(open.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
  });

  it("lists the realms in the top-realms table", async () => {
    renderPage();

    expect(await screen.findByText("Diyu")).toBeInTheDocument();
    // Since BRIEF §4.6 the raw enum member lives in `title`, not in the text
    // node — see src/lib/domainDisplay.ts. (`t` is mocked to echo its key
    // here, so the visible label is the convention's unrecognized copy.)
    expect(screen.getByTitle("CHINESE")).toBeInTheDocument();
  });

  it("shows the table's empty message when no realms came back", async () => {
    mockedStats.mockResolvedValue({ data: { ...baseStats, souls_by_realm: [] } });

    renderPage();

    expect(await screen.findByText("admin.no_realm_data")).toBeInTheDocument();
  });
});

// ── Tab navigation ───────────────────────────────────────────────────

describe("DashboardPage tab navigation", () => {
  it("writes ?tab=ledger to the URL when the ledger tab is picked", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("dashboard.tab_ledger"));

    expect(mockReplace).toHaveBeenCalledWith("/dashboard?tab=ledger", { scroll: false });
  });

  it("drops the tab parameter entirely when returning to overview", async () => {
    mockSearch = new URLSearchParams("tab=ledger");
    renderPage();

    fireEvent.click(await screen.findByText("dashboard.tab_overview"));

    expect(mockReplace).toHaveBeenCalledWith("/dashboard", { scroll: false });
  });

  it("preserves unrelated query parameters when switching tabs", async () => {
    mockSearch = new URLSearchParams("keep=1&tab=ledger");
    renderPage();

    fireEvent.click(await screen.findByText("dashboard.tab_overview"));

    expect(mockReplace).toHaveBeenCalledWith("/dashboard?keep=1", { scroll: false });
  });

  it("treats an unrecognised tab value as overview", async () => {
    mockSearch = new URLSearchParams("tab=nonsense");

    const { container } = renderPage();

    // The overview's own marker — the 图例账 that replaced the pie.
    expect(await found(container, "[data-legend-ledger]")).toBeInTheDocument();
  });
});

// ── Export ───────────────────────────────────────────────────────────

describe("DashboardPage export", () => {
  const createObjectURL = jest.fn(() => "blob:csv");

  beforeEach(() => {
    Object.defineProperty(window.URL, "createObjectURL", { value: createObjectURL, writable: true });
    createObjectURL.mockClear();
  });

  it("builds a download from the exported CSV payload", async () => {
    mockedExport.mockResolvedValue({ data: "a,b\n1,2" });
    renderPage();

    fireEvent.click(await screen.findByText("dashboard.export_stats"));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when the export request fails", async () => {
    mockedExport.mockRejectedValue(new Error("boom"));
    renderPage();

    fireEvent.click(await screen.findByText("dashboard.export_stats"));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("dashboard.error_export", "error"),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  /** 见 `NotificationsPage.test.tsx` 里同名的那条 —— 同一个缺陷,另一条 tab 条。 */
  it("tab 用 aria-pressed 报告选中,而不是只靠颜色", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByRole("button", { pressed: true }).length).toBe(1)
    );
  });
});

/**
 * 导出正在进行时,按钮要说出来 —— 而且不能被点第二下。
 *
 * `Button` 从写出来就有 `loading`(禁用 + `aria-busy`),全站 21 处在用。
 * 这一处没接:一次导出要走完整的服务端统计再下载,而按钮在这期间看起来和空闲时
 * **逐字节相同**,也接受点击。点三下就下三个文件。
 *
 * 缺的不是一个组件,是既有的 prop 没接上。
 */
describe("导出按钮在进行中说话,而且不接受第二下", () => {
  it("点击之后按钮进入 busy 并被禁用", async () => {
    // 永不 resolve:这就是「还在导出」。
    (ledgerApi.exportStats as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderPage();

    const button = await screen.findByText("dashboard.export_stats");
    fireEvent.click(button);

    const control = button.closest("button")!;
    await waitFor(() => expect(control).toBeDisabled());
    // `aria-busy` 是读屏那一半 —— 禁用只说「现在不能点」,不说「正在做事」。
    expect(control).toHaveAttribute("aria-busy", "true");
  });

  it("连点三下只发一次请求", async () => {
    (ledgerApi.exportStats as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderPage();

    const button = await screen.findByText("dashboard.export_stats");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(ledgerApi.exportStats).toHaveBeenCalledTimes(1));
  });

  it("失败之后按钮回到可用 —— 不能把自己锁死", async () => {
    (ledgerApi.exportStats as jest.Mock).mockRejectedValue(new Error("500"));
    renderPage();

    const button = await screen.findByText("dashboard.export_stats");
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("dashboard.error_export", "error")
    );
    // `finally` 那一半。少了它,一次失败就让导出永远点不动了。
    await waitFor(() => expect(button.closest("button")!).not.toBeDisabled());
  });
});
