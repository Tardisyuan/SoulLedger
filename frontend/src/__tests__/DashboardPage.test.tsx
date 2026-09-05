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
import { ledgerApi } from "@soulledger/core/api";

const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearch,
}));

jest.mock("@soulledger/core/api", () => ({
  ledgerApi: { statsOverview: jest.fn(), exportStats: jest.fn() },
  menusApi: { all: jest.fn().mockResolvedValue({ data: [] }), list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const mockShowToast = jest.fn();
const mockT = jest.fn((key: string) => key);
let mockUser: { role: string; permissions?: string[] } | null = { role: "ADMIN" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => mockT(key),
    formatDateTime: (v: string) => `dt(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazyDashboardPieChart: ({ data }: { data: { name: string }[] }) => (
    <div data-testid="pie">{data.map((d) => d.name).join("|")}</div>
  ),
  LazyBarChart: ({ data, dataKey }: { data: unknown[]; dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`}>{data.length}</div>
  ),
}));

const mockedStats = ledgerApi.statsOverview as jest.Mock;
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
});

// ── Overview tab ─────────────────────────────────────────────────────

describe("DashboardPage overview", () => {
  it("renders the stat cards from the payload", async () => {
    renderPage();

    await screen.findByTestId("pie");
    // Selected by `data-kpi`, not by class name. This used to filter on
    // `text-2xl font-bold`, which pinned the test to one rung of the old type
    // scale: when Stage 11 moved KPI values to `text-08` (56px) the filter
    // matched none of the four cards, silently fell through to two unrelated
    // numbers elsewhere on the page, and reported a data bug that did not
    // exist. A test for "the payload reaches the cards" must not fail because
    // the cards changed size.
    const cardValues = Array.from(
      document.querySelectorAll<HTMLElement>("[data-kpi]"),
    ).map((el) => el.textContent);
    // The four summary cards come first: total / alive / judging / disposed.
    expect(cardValues.slice(0, 4)).toEqual(["4", "2", "1", "1"]);
  });

  it("falls back to zero for a state the payload omits", async () => {
    mockedStats.mockResolvedValue({ ...baseStats, data: { ...baseStats, state_distribution: [] } });

    renderPage();

    await waitFor(() => expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3));
  });

  it("翻译缺失时,图例里不会出现裸枚举成员", async () => {
    // 这条曾经叫「shows the API label in the pie legend」,断的是
    // `toHaveTextContent("Alive|Judging|Disposed")` —— 而 API 送的是
    // `ALIVE|JUDGING|DISPOSED`。**夹具、注释、测试三者互相印证了一件假的事。**
    // 现在断的是:无论 `label` 里是什么,裸成员都不会进图例。
    mockT.mockImplementation((key: string) => key);

    renderPage();

    const legend = await screen.findByTestId("pie");
    expect(legend).not.toHaveTextContent("ALIVE");
    expect(legend).not.toHaveTextContent("JUDGING");
    expect(legend).not.toHaveTextContent("DISPOSED");
  });

  it("**断存在。** 有翻译时用翻译", async () => {
    mockT.mockImplementation((key: string) => (key === "souls.states.ALIVE" ? "存活" : key));

    renderPage();

    expect(await screen.findByTestId("pie")).toHaveTextContent("存活");
  });

  it("renders the error text instead of the pie chart when the query fails", async () => {
    mockedStats.mockRejectedValue(new Error("500"));

    renderPage();

    expect(await screen.findByText("dashboard.error_load")).toBeInTheDocument();
    expect(screen.queryByTestId("pie")).not.toBeInTheDocument();
  });

  it("falls back to the tenant code when the tenant has no display name", async () => {
    renderPage();

    expect(await screen.findByText("地府")).toBeInTheDocument();
    expect(screen.getByText("EG_DUAT")).toBeInTheDocument();
  });

  it("leaves the third civilization slot empty when only two tenants exist", async () => {
    renderPage();

    await screen.findByText("地府");
    // Two tenant totals render; the third card body stays empty.
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows a placeholder instead of a realm chart when there are no realms", async () => {
    mockedStats.mockResolvedValue({ data: { ...baseStats, souls_by_realm: [] } });

    renderPage();

    expect(await screen.findByText("dashboard.no_realm_data")).toBeInTheDocument();
  });

  it("groups recent activity by action and pluralises the count", async () => {
    renderPage();

    expect(await screen.findByText("CREATE")).toBeInTheDocument();
    expect(screen.getByText("WEIRD_ACTION")).toBeInTheDocument();
    // The two CREATE rows collapse into one group labelled with the plural.
    expect(screen.getByText("2 actions")).toBeInTheDocument();
    expect(screen.getByText("1 action")).toBeInTheDocument();
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

    renderPage();

    expect(await screen.findByTestId("pie")).toBeInTheDocument();
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
