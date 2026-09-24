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
import { dispatchApi, judgmentApi, ledgerApi } from "@soulledger/core/api";
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

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazyBarChart: ({ data, dataKey }: { data: unknown[]; dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`}>{data.length}</div>
  ),
}));

const mockedStats = ledgerApi.statsOverview as jest.Mock;
const mockedProposed = dispatchApi.proposed as jest.Mock;
const mockedNext = judgmentApi.next as jest.Mock;
const mockedExport = ledgerApi.exportStats as jest.Mock;

const baseStats = {
  total_souls: 4,
  // `label` 是**枚举成员原样**,不是英文标签。
  //
  // 这份夹具原来写的是 `"Alive"` / `"Judging"` / `"Disposed"`,而后端
  // (`apps/ledger/views.py`)写的是 `{"label": s}` —— SCREAMING_SNAKE 原样。
  // 夹具和它旁边那条注释一起,把一个不存在的接线说成了事实,于是下面两条测试
  // **钉住的是那个不存在的接线**。
  state_distribution: [
    { state: "ALIVE", label: "ALIVE", count: 2 },
    { state: "JUDGING", label: "JUDGING", count: 1 },
    { state: "DISPOSED", label: "DISPOSED", count: 1 },
  ],
  tenants: [
    { tenant_code: "CN_DIYU", tenant_name: "地府", total_souls: 3, state_breakdown: { ALIVE: 2, JUDGING: 1 } },
    { tenant_code: "EG_DUAT", tenant_name: "", total_souls: 1, state_breakdown: { DISPOSED: 1 } },
  ],
  souls_by_realm: [{ realm_code: "R1", realm_name: "Diyu", civilization: "CHINESE", count: 3 }],
  karma_distribution: [
    { label: "< -50", count: 2 },
    { label: "-5 to 5", count: 3 },
    { label: "> 50", count: 1 },
    { label: "unparseable", count: 5 },
  ],
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

  it("colours histogram bars by the sign of their bucket, with the count above each", async () => {
    const { container } = renderPage();
    await found(container, "[data-histogram-bar]");
    // Looked up by attribute value in JS: jsdom's selector engine mis-reads a
    // `>` inside a quoted attribute value.
    const bar = (label: string) =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-histogram-bar]")).find(
        (el) => el.getAttribute("data-histogram-bar") === label
      ) as HTMLElement;
    expect(bar("< -50")).toHaveTextContent("2");
    expect(bar("< -50").querySelector("[aria-hidden]")?.className).toContain("--color-danger");
    expect(bar("> 50").querySelector("[aria-hidden]")?.className).toContain("--color-success");
    expect(bar("-5 to 5").querySelector("[aria-hidden]")?.className).toContain("--color-ink-subtle");
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

    it("is not shown, and asks nothing, for someone who may open neither page", async () => {
      mockUser = { role: "VIEWER", permissions: [] };
      renderPage();
      await screen.findByText("made a soul");
      expect(screen.queryByText("dashboard.todo.approve_dispatch")).not.toBeInTheDocument();
      expect(mockedProposed).not.toHaveBeenCalled();
      expect(mockedNext).not.toHaveBeenCalled();
    });
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

    expect(await screen.findByText("admin.ledger_stats")).toBeInTheDocument();
  });

  it("hides the ledger tab from a non-admin", async () => {
    mockUser = { role: "JUDGE", permissions: ["karma.export"] };

    renderPage();

    await screen.findByText("dashboard.tab_overview");
    expect(screen.queryByText("admin.ledger_stats")).not.toBeInTheDocument();
  });

  it("refuses the ledger panel to a non-admin who reaches it via ?tab=ledger", async () => {
    mockUser = { role: "JUDGE", permissions: [] };
    mockSearch = new URLSearchParams("tab=ledger");

    renderPage();

    await waitFor(() => expect(screen.queryByText("admin.avg_balance")).not.toBeInTheDocument());
    expect(screen.queryByText("admin.top_balance")).not.toBeInTheDocument();
  });

  it("renders the ledger panel for an admin at ?tab=ledger", async () => {
    mockSearch = new URLSearchParams("tab=ledger");

    renderPage();

    expect(await screen.findByText("admin.avg_balance")).toBeInTheDocument();
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

  it("averages the balance buckets by their midpoints", async () => {
    // (-60 * 2) + (0 * 3) + (60 * 1) + (0 * 5) = -60, over 4 souls => -15.00
    renderPage();

    expect(await screen.findByText("-15.00")).toBeInTheDocument();
  });

  it("divides by one rather than by zero when there are no souls", async () => {
    mockedStats.mockResolvedValue({
      data: { ...baseStats, total_souls: 0, karma_distribution: [{ label: "> 50", count: 1 }] },
    });

    renderPage();

    expect(await screen.findByText("60.00")).toBeInTheDocument();
  });

  it("reports a zero average when no bucket data came back", async () => {
    mockedStats.mockResolvedValue({ data: { ...baseStats, karma_distribution: undefined } });

    renderPage();

    expect(await screen.findByText("0.00")).toBeInTheDocument();
  });

  it("lists the realms in the top-balance table", async () => {
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

    fireEvent.click(await screen.findByText("admin.ledger_stats"));

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
