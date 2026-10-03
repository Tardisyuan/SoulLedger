/**
 * Tests for app/welcome/page.tsx after A9 (Design 2026-10-03).
 *
 * The page is deliberately unguarded — proxy.ts treats /welcome as public and
 * `user` is null during the first render, so an auth guard here used to bounce
 * signed-in visitors to /login. That is pinned below ("anonymous visitor").
 *
 * What is covered: the greeting in the identity band; the one stats panel and
 * its own loading / error / retry; 「接着做」 by role and by menu; my recent
 * activity and its own states; the first-time setup screen and the
 * `onboarded` flag; and the absence of what A9 removed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WelcomePage from "@/app/welcome/page";
import { auditApi, authApi, ledgerApi, permApi } from "@soulledger/core/api";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { tZh, zh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  ledgerApi: { statsOverview: jest.fn() },
  auditApi: { list: jest.fn() },
  // RoleName reads the role table for a custom role's display_name.
  permApi: { roles: { list: jest.fn() } },
  // 默认视图 lives on the server (`/auth/profile/preferences/`).
  authApi: { preferences: jest.fn(), updatePreferences: jest.fn() },
}));

let mockUser: Record<string, unknown> | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

let mockMenus: SidebarMenu[] = [];
jest.mock("@/src/hooks/useSidebarMenus", () => ({
  useSidebarMenus: () => ({ data: mockMenus }),
}));

const mockPlaque = jest.fn();
jest.mock("@/src/components/plaque/Plaque", () => ({
  usePlaque: (text: unknown) => mockPlaque(text),
}));

const mockSetTheme = jest.fn();
const mockFollowSystem = jest.fn();
jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", setTheme: mockSetTheme, followsSystem: true, followSystem: mockFollowSystem }),
}));

// Key-echo by default — most assertions are about WHICH key the page chose.
// The identity tests swap in `tZh` (the real zh-Hans bundle) because a
// `<DomainEnum>` under an echoing `t` renders every member as "unrecognised".
const keyEcho = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key;
let mockTranslate: typeof keyEcho = keyEcho;

jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: jest.requireActual("@/src/contexts/I18nContext").LOCALE_LABELS,
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => mockTranslate(key, params),
    formatDate: (_d: unknown, o?: Intl.DateTimeFormatOptions) => (o?.hour ? "20:14" : "FORMATTED_DATE"),
    formatDateTime: () => "FORMATTED_DATETIME",
    locale: "en",
    setLocale: jest.fn(),
    hydrated: true,
  }),
}));

const mockedStats = ledgerApi.statsOverview as jest.Mock;
const mockedAudit = auditApi.list as jest.Mock;
const mockedRoles = permApi.roles.list as jest.Mock;
const mockedPrefs = authApi.preferences as jest.Mock;
const mockedSavePrefs = authApi.updatePreferences as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WelcomePage />
    </QueryClientProvider>
  );
}

const stats = {
  total_souls: 77,
  state_distribution: [
    { state: "JUDGING", count: 4 },
    { state: "ALIVE", count: 60 },
    { state: "DISPOSED", count: 13 },
  ],
};

const menu = (id: number, path: string): SidebarMenu =>
  ({ id, name: path, path, icon: null, order: id, component: null, roles: [], is_active: true, parent: null, children: [] }) as SidebarMenu;

const JUDGE = { id: 7, username: "yama", display_name: "阎罗", role: "JUDGE", tenant: { display_name: "地府" } };
const ONBOARDED = "soulledger_onboarded:7";

let hoursSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockUser = null;
  mockMenus = [];
  mockTranslate = keyEcho;
  mockedStats.mockResolvedValue({ data: stats });
  mockedAudit.mockResolvedValue({ data: { results: [], count: 0 } });
  mockedRoles.mockResolvedValue({ data: [] });
  mockedPrefs.mockResolvedValue({ data: { default_view: null, onboarded: false } });
  mockedSavePrefs.mockImplementation(async (body: Record<string, unknown>) => ({
    data: { default_view: null, onboarded: false, ...body },
  }));
  hoursSpy = jest.spyOn(Date.prototype, "getHours").mockReturnValue(10);
});

afterEach(() => hoursSpy.mockRestore());

/** A signed-in judge who has done the setup (the server says so), so the regular page shows. */
function signedInJudge(over: Record<string, unknown> = {}) {
  mockUser = { ...JUDGE, ...over };
  mockedPrefs.mockResolvedValue({ data: { default_view: null, onboarded: true } });
}

/** A signed-in page shows a loading state until the server says whether setup is done. */
const settled = () => waitFor(() => expect(screen.queryByTestId("welcome-loading")).toBeNull());

const panel = (id: string) => {
  const el = document.querySelector(`section[aria-labelledby="${id}"]`);
  if (!el) throw new Error(`no panel ${id}`);
  return el as HTMLElement;
};
const statsPanel = () => panel("welcome-stats-title");
const activityPanel = () => panel("welcome-activity-title");
const nextPanel = () => panel("welcome-next-title");

// ── Greeting ─────────────────────────────────────────────────────────

describe("greeting: in the identity band, three buckets", () => {
  const bandTitle = () => mockPlaque.mock.calls.at(-1)?.[0]?.title;

  it.each([
    [9, "welcome.greeting_morning(阎罗)"],
    [12, "welcome.greeting_afternoon(阎罗)"],
    [17, "welcome.greeting_afternoon(阎罗)"],
    [18, "welcome.greeting_evening(阎罗)"],
    [3, "welcome.greeting_evening(阎罗)"],
  ])("%s o'clock → %s", async (hour, expected) => {
    hoursSpy.mockReturnValue(hour as number);
    signedInJudge();
    renderPage();
    await waitFor(() => expect(bandTitle()).toBe(expected));
    expect(mockPlaque.mock.calls.at(-1)?.[0]?.meta).toBe("FORMATTED_DATE");
    // The readers' <h1> says the same thing; there is no visible greeting block.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(expected as string);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("sr-only");
  });

  it("falls back to username, and greets an anonymous visitor without a name", async () => {
    signedInJudge({ display_name: "" });
    const first = renderPage();
    await waitFor(() => expect(bandTitle()).toBe("welcome.greeting_morning(yama)"));
    first.unmount();
    mockUser = null;
    renderPage();
    await waitFor(() => expect(bandTitle()).toBe("nav.greeting_morning"));
    expect(screen.queryByText(/Admin/)).toBeNull();
  });
});

// ── Stats ────────────────────────────────────────────────────────────

describe("本殿灵魂: one panel, four cells", () => {
  it("is busy with skeletons, not numbers, until the request resolves", () => {
    mockedStats.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(statsPanel()).toHaveAttribute("aria-busy", "true");
    expect(statsPanel().querySelectorAll("[data-kpi]")).toHaveLength(0);
  });

  it("fills the cells, each a link to its filtered list, with glyph + name", async () => {
    renderPage();
    await waitFor(() => expect(statsPanel().querySelectorAll("[data-kpi]")).toHaveLength(4));
    const cells = Array.from(statsPanel().querySelectorAll("a[data-stat]"));
    expect(cells.map((a) => [a.getAttribute("href"), a.querySelector("[data-kpi]")?.textContent])).toEqual([
      ["/souls", "77"],
      ["/judgment/queue", "4"],
      ["/souls?state=ALIVE", "60"],
      ["/souls?state=DISPOSED", "13"],
    ]);
    expect(cells[0]).toHaveTextContent(/^dashboard\.total_souls77welcome\.stats_roster$/);
    expect(cells[1]).toHaveTextContent("◇ dashboard.under_judgment");
    expect(cells[2]).toHaveTextContent("○ dashboard.alive");
    expect(cells[3]).toHaveTextContent("▣ dashboard.disposed");
    expect(statsPanel()).toHaveTextContent("welcome.stats_as_of(20:14)");
    expect(statsPanel()).not.toHaveAttribute("aria-busy");
  });

  it("writes 0 for a state the backend did not report — no dash, no hidden cell", async () => {
    mockedStats.mockResolvedValue({ data: { total_souls: 0, state_distribution: [] } });
    renderPage();
    await waitFor(() => expect(statsPanel().querySelectorAll("[data-kpi]")).toHaveLength(4));
    expect(Array.from(statsPanel().querySelectorAll("[data-kpi]")).map((n) => n.textContent)).toEqual(["0", "0", "0", "0"]);
    expect(screen.queryByText("-")).toBeNull();
  });

  it("errors on its own: 加载失败 in danger, the reason muted, 重试 reloads — activity is untouched", async () => {
    signedInJudge();
    mockedAudit.mockResolvedValue({ data: { results: [{ id: 1, action: "CREATE", resource: "soul", resource_id: "s1", description: "记一条", timestamp: new Date().toISOString() }], count: 1 } });
    mockedStats.mockRejectedValueOnce(new Error("500"));
    renderPage();
    await settled();
    const alert = await within(statsPanel()).findByRole("alert");
    expect(alert).toHaveTextContent("! dashboard.todo.load_error");
    expect(alert).toHaveTextContent("welcome.error_stats");
    expect(alert.querySelector("p")?.className).toContain("--color-danger");
    expect(within(activityPanel()).getByText("记一条")).toBeInTheDocument();
    // The entries still work while the numbers are down.
    expect(within(nextPanel()).getByTestId("welcome-primary")).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(statsPanel().querySelectorAll("[data-kpi]")).toHaveLength(4));
    expect(mockedStats).toHaveBeenCalledTimes(2);
    expect(mockedAudit).toHaveBeenCalledTimes(1);
  });
});

// ── 接着做 ───────────────────────────────────────────────────────────

describe("接着做: one primary button, entries from the user's own menus", () => {
  it("a judge: 进入审判台 with the pending count; only the entries their menus have", async () => {
    signedInJudge();
    mockMenus = [menu(1, "/souls"), menu(2, "/workflow")];
    renderPage();
    await settled();
    const primary = await within(nextPanel()).findByTestId("welcome-primary");
    await waitFor(() => expect(primary).toHaveTextContent("welcome.next_judgment(4)"));
    expect(primary).toHaveAttribute("href", "/judgment/queue");
    const rows = within(nextPanel()).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("a")?.getAttribute("href"))).toEqual(["/souls", "/workflow"]);
    expect(rows[0]).toHaveTextContent("souls.createwelcome.next_create_soul_hint");
    // /ledger is not in this judge's menus, so 功德统计 is not offered.
    expect(within(nextPanel()).queryByText("ledger.title")).toBeNull();
  });

  it("the queue is clear: 进入审判台 · 队列已清空", async () => {
    signedInJudge();
    mockedStats.mockResolvedValue({ data: { total_souls: 3, state_distribution: [{ state: "ALIVE", count: 3 }] } });
    renderPage();
    await waitFor(() => expect(within(nextPanel()).getByTestId("welcome-primary")).toHaveTextContent("welcome.next_judgment_empty"));
  });

  it("an administrator: 看统计概览, and 用户 / 权限 / 审计", async () => {
    signedInJudge({ role: "ADMIN" });
    mockMenus = [menu(1, "/users"), menu(2, "/permissions"), menu(3, "/audit"), menu(4, "/souls")];
    renderPage();
    await settled();
    const primary = await within(nextPanel()).findByTestId("welcome-primary");
    expect(primary).toHaveTextContent("welcome.next_dashboard");
    expect(primary).toHaveAttribute("href", "/dashboard");
    expect(within(nextPanel()).getAllByRole("listitem").map((r) => r.querySelector("a")?.getAttribute("href"))).toEqual([
      "/users",
      "/permissions",
      "/audit",
    ]);
  });

  it("names the role through RoleName — a custom role by the role table's display_name", async () => {
    mockedRoles.mockResolvedValue({ data: [{ id: 9, name: "SCRIBE", display_name: "书吏", is_builtin: false }] });
    signedInJudge({ role: "SCRIBE" });
    renderPage();
    await waitFor(() => expect(within(nextPanel()).getByText("书吏")).toBeInTheDocument());
    expect(within(nextPanel()).getByTitle("SCRIBE")).toBeInTheDocument();
  });

  it("is the only primary button on the page", async () => {
    signedInJudge();
    mockMenus = [menu(1, "/souls"), menu(2, "/workflow"), menu(3, "/ledger")];
    renderPage();
    await settled();
    await within(nextPanel()).findByTestId("welcome-primary");
    const primaries = Array.from(document.querySelectorAll("a, button")).filter((el) => el.className.includes("--color-main"));
    expect(primaries).toEqual([within(nextPanel()).getByTestId("welcome-primary")]);
  });
});

// ── 最近活动 ─────────────────────────────────────────────────────────

describe("最近活动: mine, from the audit log, at most six", () => {
  const entry = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    action: "CREATE",
    description: "记录一条",
    username: "yama",
    user_display: "阎罗",
    timestamp: new Date().toISOString(),
    resource: "soul",
    resource_id: "s1",
    ip_address: null,
    tenant_code: "CN_DIYU",
    ...over,
  });

  it("asks for this user's entries only, shows six of twenty, four columns with the verb's glyph", async () => {
    signedInJudge();
    mockTranslate = tZh;
    mockedAudit.mockResolvedValue({
      data: { results: Array.from({ length: 20 }, (_, i) => entry({ id: i + 1, description: `条目 ${i + 1}` })), count: 20 },
    });
    renderPage();
    await settled();
    await within(activityPanel()).findByText("条目 1");
    expect(mockedAudit).toHaveBeenCalledWith({ user: "7" });
    const rows = activityPanel().querySelectorAll("[data-activity]");
    expect(rows).toHaveLength(6);
    expect(within(activityPanel()).queryByText("条目 7")).toBeNull();
    const cols = Array.from(rows[0].children).map((c) => c.textContent);
    expect(cols).toEqual([zh("welcome.just_now"), `＋ ${zh("audit.actions.CREATE")}`, "soul · s1", "条目 1"]);
    expect(activityPanel()).toHaveTextContent(zh("welcome.activity_source").replace("{{n}}", "6"));
    expect(within(activityPanel()).getByRole("link", { name: new RegExp(zh("welcome.view_all_activity")) })).toHaveAttribute("href", "/audit");
  });

  it("shows real entries with relative times, never invented ones", async () => {
    signedInJudge();
    mockedAudit.mockResolvedValue({
      data: {
        results: [entry({ id: 1, description: "真实条目 A" }), entry({ id: 2, description: "真实条目 B", timestamp: new Date(Date.now() - 3600000).toISOString() })],
        count: 2,
      },
    });
    renderPage();
    expect(await screen.findByText("真实条目 A")).toBeInTheDocument();
    expect(screen.getByText("welcome.hours_ago(1)")).toBeInTheDocument();
    expect(screen.queryByText(/张三/)).not.toBeInTheDocument();
  });

  it("empty: the EmptyState with its reason, no action", async () => {
    signedInJudge();
    renderPage();
    await waitFor(() => expect(activityPanel().querySelector("[data-empty-state]")).not.toBeNull());
    const empty = activityPanel().querySelector("[data-empty-state]") as HTMLElement;
    expect(empty).toHaveTextContent("dashboard.no_activity");
    expect(empty).toHaveTextContent("welcome.activity_empty_reason");
    expect(empty.querySelector("[data-empty-state-action]")).toBeNull();
  });

  it("errors on its own and retries on its own", async () => {
    signedInJudge();
    mockedAudit.mockRejectedValueOnce(new Error("403"));
    renderPage();
    await settled();
    const alert = await within(activityPanel()).findByRole("alert");
    expect(alert).toHaveTextContent("welcome.error_activity");
    await waitFor(() => expect(statsPanel().querySelectorAll("[data-kpi]")).toHaveLength(4));
    fireEvent.click(within(alert).getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(activityPanel().querySelector("[data-empty-state]")).not.toBeNull());
    expect(mockedAudit).toHaveBeenCalledTimes(2);
    expect(mockedStats).toHaveBeenCalledTimes(1);
  });

  it("asks nothing, and invents nothing, for an anonymous visitor", async () => {
    renderPage();
    await waitFor(() => expect(mockedStats).toHaveBeenCalled());
    expect(mockedAudit).not.toHaveBeenCalled();
    expect(activityPanel().querySelector("[data-empty-state]")).not.toBeNull();
  });
});

// ── What A9 removed ─────────────────────────────────────────────────

describe("A9 removed the old blocks", () => {
  it("no quick-action tiles, no info cards, no agent panel; the version is one footer line", async () => {
    signedInJudge();
    renderPage();
    await waitFor(() => expect(statsPanel().querySelectorAll("[data-kpi]")).toHaveLength(4));
    for (const gone of ["welcome.quick_actions", "welcome.current_civilization", "welcome.user_role", "welcome.agent_status", "nav.welcome"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/^welcome\.system_version · v\d+\.\d+\.\d+$/);
  });
});

// ── 首次设置 ─────────────────────────────────────────────────────────

describe("first-time setup: its own screen until `onboarded`", () => {
  const stepStates = () =>
    Array.from(document.querySelectorAll("[data-step-state]")).map((li) => li.getAttribute("data-step-state"));
  const setup = () => screen.queryByTestId("welcome-setup");

  it("a signed-in user without the flag sees only the setup — not the regular panels", async () => {
    mockUser = { ...JUDGE };
    renderPage();
    await waitFor(() => expect(setup()).not.toBeNull());
    expect(stepStates()).toEqual(["current", "future", "future", "future"]);
    expect(document.querySelector("section[aria-labelledby='welcome-stats-title']")).toBeNull();
    expect(document.querySelector("section[aria-labelledby='welcome-next-title']")).toBeNull();
    expect(setup()).toHaveTextContent("welcome.first_run(1,4)");
  });

  it("until the server answers, neither screen — only the loading state", async () => {
    mockUser = { ...JUDGE };
    let answer: (_v: unknown) => void = () => {};
    mockedPrefs.mockReturnValue(new Promise((r) => (answer = r)));
    renderPage();
    expect(screen.getByTestId("welcome-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("common.loading");
    expect(setup()).toBeNull();
    expect(document.querySelector("section[aria-labelledby='welcome-stats-title']")).toBeNull();
    answer({ data: { default_view: null, onboarded: true } });
    await waitFor(() => expect(screen.queryByTestId("welcome-loading")).toBeNull());
    expect(document.querySelector("section[aria-labelledby='welcome-stats-title']")).not.toBeNull();
  });

  it("an anonymous visitor never gets it", async () => {
    renderPage();
    await waitFor(() => expect(mockedStats).toHaveBeenCalled());
    expect(setup()).toBeNull();
    expect(screen.queryByTestId("welcome-loading")).toBeNull();
  });

  it("继续 / 上一步 move through the steps; 上一步 is disabled on the first", async () => {
    mockUser = { ...JUDGE };
    renderPage();
    await waitFor(() => expect(setup()).not.toBeNull());
    expect(screen.getByRole("button", { name: "welcome.onboarding_back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "welcome.continue" }));
    expect(stepStates()).toEqual(["done", "current", "future", "future"]);
    expect(screen.getByRole("heading", { level: 2, name: "welcome.onboarding_view_title" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "welcome.onboarding_back" }));
    expect(stepStates()).toEqual(["current", "future", "future", "future"]);
  });

  it("finishing writes `onboarded` to the server — not this browser — and shows the regular page", async () => {
    mockUser = { ...JUDGE };
    renderPage();
    await waitFor(() => expect(setup()).not.toBeNull());
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "welcome.continue" }));
    expect(mockedSavePrefs).toHaveBeenCalledWith({ onboarded: true });
    expect(localStorage.getItem(ONBOARDED)).toBeNull();
    expect(setup()).toBeNull();
    expect(statsPanel()).toBeInTheDocument();
  });

  it("跳过，直接进入 writes it too", async () => {
    mockUser = { ...JUDGE };
    renderPage();
    await waitFor(() => expect(setup()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "welcome.skip" }));
    expect(mockedSavePrefs).toHaveBeenCalledWith({ onboarded: true });
    expect(setup()).toBeNull();
  });

  describe("`onboarded` comes from the server", () => {
    const savedOnboarded = () => mockedSavePrefs.mock.calls.filter(([body]) => "onboarded" in body);

    it("server says done → the regular page, no setup, nothing written", async () => {
      signedInJudge();
      renderPage();
      await waitFor(() => expect(mockedPrefs).toHaveBeenCalled());
      expect(await within(nextPanel()).findByRole("button", { name: "welcome.next_redo_onboarding" })).toBeInTheDocument();
      expect(setup()).toBeNull();
      expect(savedOnboarded()).toEqual([]);
    });

    it("server says done, a stale local key is removed and nothing is written", async () => {
      signedInJudge();
      localStorage.setItem(ONBOARDED, "1");
      renderPage();
      await waitFor(() => expect(localStorage.getItem(ONBOARDED)).toBeNull());
      expect(setup()).toBeNull();
      expect(savedOnboarded()).toEqual([]);
    });

    it("local says done, server says not → writes true to the server once, removes the key, no setup", async () => {
      mockUser = { ...JUDGE };
      localStorage.setItem(ONBOARDED, "1");
      renderPage();
      await waitFor(() => expect(localStorage.getItem(ONBOARDED)).toBeNull());
      expect(savedOnboarded()).toEqual([[{ onboarded: true }]]);
      expect(setup()).toBeNull();
      expect(statsPanel()).toBeInTheDocument();
    });

    it("another user's local key does not migrate for this one", async () => {
      mockUser = { ...JUDGE };
      localStorage.setItem("soulledger_onboarded:8", "1");
      renderPage();
      await waitFor(() => expect(setup()).not.toBeNull());
      expect(savedOnboarded()).toEqual([]);
      expect(localStorage.getItem("soulledger_onboarded:8")).toBe("1");
    });

    it("a migration that cannot be saved keeps the local key for next time, and still skips the setup", async () => {
      mockUser = { ...JUDGE };
      localStorage.setItem(ONBOARDED, "1");
      mockedSavePrefs.mockRejectedValue(new Error("offline"));
      renderPage();
      await waitFor(() => expect(mockedSavePrefs).toHaveBeenCalledWith({ onboarded: true }));
      await waitFor(() => expect(statsPanel()).toBeInTheDocument());
      expect(localStorage.getItem(ONBOARDED)).toBe("1");
      expect(setup()).toBeNull();
    });

    it("an unreadable server does not trap the operator in the setup", async () => {
      mockUser = { ...JUDGE };
      mockedPrefs.mockRejectedValue(new Error("offline"));
      renderPage();
      await waitFor(() => expect(mockedPrefs).toHaveBeenCalled());
      await waitFor(() => expect(statsPanel()).toBeInTheDocument());
      expect(setup()).toBeNull();
    });

    it("重看首次设置 opens the setup without clearing the flag", async () => {
      signedInJudge();
      renderPage();
      await settled();
      fireEvent.click(await within(nextPanel()).findByRole("button", { name: "welcome.next_redo_onboarding" }));
      expect(setup()).not.toBeNull();
      expect(savedOnboarded()).toEqual([]);
    });
  });

  it("重看首次设置 comes back from 接着做; 所有快捷键 opens the shortcuts step — exactly the queue's seven", async () => {
    signedInJudge();
    renderPage();
    await settled();
    fireEvent.click(await within(nextPanel()).findByRole("button", { name: "welcome.next_redo_onboarding" }));
    expect(stepStates()).toEqual(["current", "future", "future", "future"]);
    fireEvent.click(screen.getByRole("button", { name: "welcome.skip" }));

    fireEvent.click(within(nextPanel()).getByRole("button", { name: /welcome\.next_all_shortcuts/ }));
    expect(stepStates()).toEqual(["done", "done", "done", "current"]);
    const keys = Array.from(document.querySelectorAll("[data-shortcut] dt")).map((dt) => dt.textContent);
    expect(keys).toEqual(["1–4", "C", "S", "W", "R", "N", "?"]);
    for (const invented of ["⌘K", "Q", "⌘⏎", "⌘Z", "U"]) expect(keys).not.toContain(invented);
  });

  it("step 1 shows the identity it asks you to confirm", async () => {
    mockUser = { ...JUDGE, role: "GUARDIAN" };
    mockTranslate = tZh;
    renderPage();
    await waitFor(() => expect(setup()).not.toBeNull());
    expect(within(setup()!).getByText("地府")).toBeInTheDocument();
    expect(within(setup()!).getByText(zh("users.roles.GUARDIAN"))).toBeInTheDocument();
    expect(within(setup()!).getByTitle("GUARDIAN")).toBeInTheDocument();
    expect(within(setup()!).getByText(zh("welcome.onboarding_wrong_identity"))).toBeInTheDocument();
  });

  it("step 3: three theme radios — 跟随系统 follows the OS again, the others set it", async () => {
    mockUser = { ...JUDGE };
    renderPage();
    await waitFor(() => expect(setup()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "welcome.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "welcome.continue" }));
    expect(screen.getByTestId("welcome-theme-system")).toBeChecked();
    fireEvent.click(screen.getByTestId("welcome-theme-dark"));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    fireEvent.click(screen.getByTestId("welcome-theme-system"));
    // Already following the system: a click on the checked radio changes nothing.
    expect(mockFollowSystem).not.toHaveBeenCalled();
    expect(screen.getByLabelText("nav.language")).toHaveValue("en");
  });

  describe("step 2, 默认视图: saved on the server", () => {
    const LEGACY_KEY = "soulledger_default_view";
    async function atViewStep() {
      renderPage();
      await waitFor(() => expect(setup()).not.toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "welcome.continue" }));
    }
    beforeEach(() => {
      mockUser = { ...JUDGE };
    });

    it("saves the choice on the server, not in this browser", async () => {
      await atViewStep();
      fireEvent.click(screen.getByTestId("welcome-view-operator"));
      await waitFor(() => expect(mockedSavePrefs).toHaveBeenCalledWith({ default_view: "operator" }));
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
      expect(screen.getByTestId("welcome-view-operator")).toBeChecked();
      expect(screen.getByTestId("welcome-view-admin")).not.toBeChecked();
    });

    it("shows the value the server has, from any browser", async () => {
      mockedPrefs.mockResolvedValue({ data: { default_view: "operator" } });
      await atViewStep();
      await waitFor(() => expect(screen.getByTestId("welcome-view-operator")).toBeChecked());
      expect(mockedSavePrefs).not.toHaveBeenCalled();
    });

    it("migrates a value this browser stored before, once", async () => {
      localStorage.setItem(LEGACY_KEY, "operator");
      await atViewStep();
      await waitFor(() => expect(mockedSavePrefs).toHaveBeenCalledWith({ default_view: "operator" }));
      await waitFor(() => expect(localStorage.getItem(LEGACY_KEY)).toBeNull());
      expect(screen.getByTestId("welcome-view-operator")).toBeChecked();
    });

    it("keeps the local value for next time when the migration cannot be saved", async () => {
      localStorage.setItem(LEGACY_KEY, "operator");
      mockedSavePrefs.mockRejectedValue(new Error("offline"));
      await atViewStep();
      await waitFor(() => expect(mockedSavePrefs).toHaveBeenCalled());
      expect(localStorage.getItem(LEGACY_KEY)).toBe("operator");
    });

    it("lets the server's value win over a stale local one, and clears the local one", async () => {
      localStorage.setItem(LEGACY_KEY, "operator");
      mockedPrefs.mockResolvedValue({ data: { default_view: "admin" } });
      await atViewStep();
      await waitFor(() => expect(screen.getByTestId("welcome-view-admin")).toBeChecked());
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
      expect(mockedSavePrefs).not.toHaveBeenCalled();
    });

    it("puts the previous choice back when a save fails", async () => {
      mockedPrefs.mockResolvedValue({ data: { default_view: "admin" } });
      mockedSavePrefs.mockRejectedValue(new Error("offline"));
      await atViewStep();
      await waitFor(() => expect(screen.getByTestId("welcome-view-admin")).toBeChecked());
      fireEvent.click(screen.getByTestId("welcome-view-operator"));
      await waitFor(() => expect(screen.getByTestId("welcome-view-admin")).toBeChecked());
      expect(screen.getByTestId("welcome-view-operator")).not.toBeChecked();
    });
  });
});
