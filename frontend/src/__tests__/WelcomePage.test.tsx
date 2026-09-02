/**
 * Tests for app/welcome/page.tsx.
 *
 * The page is deliberately unguarded — middleware.ts treats /welcome as
 * public and `user` is null during the first render, so an auth guard here
 * used to bounce signed-in visitors to /login. That regression is pinned
 * below ("renders for an anonymous visitor"). The rest covers the two bits
 * of real logic: the hour-of-day greeting and the relative timestamp.
 */
import { render, screen, waitFor } from "@testing-library/react";
import WelcomePage from "@/app/welcome/page";
import { auditApi, ledgerApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  ledgerApi: { statsOverview: jest.fn() },
  auditApi: { list: jest.fn() },
}));

let mockUser: Record<string, unknown> | null = null;

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    formatDate: () => "FORMATTED_DATE",
    formatDateTime: () => "FORMATTED_DATETIME",
    locale: "en",
    hydrated: true,
  }),
}));

const mockedStats = ledgerApi.statsOverview as jest.Mock;

const stats = {
  total_souls: 77,
  state_distribution: [
    { state: "JUDGING", count: 4 },
    { state: "ALIVE", count: 60 },
    { state: "DISPOSED", count: 13 },
  ],
};

let hoursSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  mockedStats.mockResolvedValue({ data: stats });
  // A default so tests that are not about the feed do not have to configure
  // it. The feed tests override this with what they actually assert on.
  (auditApi.list as jest.Mock).mockResolvedValue({ data: { results: [], count: 0 } });
  hoursSpy = jest.spyOn(Date.prototype, "getHours").mockReturnValue(10);
});

afterEach(() => {
  hoursSpy.mockRestore();
});

// ── Stats ────────────────────────────────────────────────────────────

describe("WelcomePage quick stats", () => {
  it("shows a placeholder for every stat until the request resolves", () => {
    let resolve: (_v: unknown) => void = () => {};
    mockedStats.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<WelcomePage />);

    expect(screen.getAllByText("...")).toHaveLength(4);
    resolve({ data: stats });
  });

  it("fills each stat card from the state distribution once loaded", async () => {
    render(<WelcomePage />);

    expect(await screen.findByText("77")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
  });

  it("falls back to a dash for a state the backend did not report", async () => {
    mockedStats.mockResolvedValue({ data: { total_souls: 9, state_distribution: [] } });

    render(<WelcomePage />);

    expect(await screen.findByText("9")).toBeInTheDocument();
    expect(screen.getAllByText("-")).toHaveLength(3);
  });

  it("stops the loading placeholder and shows dashes when the stats call fails", async () => {
    mockedStats.mockRejectedValue(new Error("500"));

    render(<WelcomePage />);

    await waitFor(() => expect(screen.queryAllByText("...")).toHaveLength(0));
    expect(screen.getAllByText("-")).toHaveLength(4);
  });
});

// ── Greeting ─────────────────────────────────────────────────────────

describe("WelcomePage greeting", () => {
  it.each([
    [3, "nav.greeting_night"],
    [9, "nav.greeting_morning"],
    [14, "nav.greeting_afternoon"],
    [21, "nav.greeting_evening"],
  ])("uses the %s o'clock greeting bucket", async (hour, expectedKey) => {
    hoursSpy.mockReturnValue(hour as number);

    render(<WelcomePage />);

    expect(await screen.findByText(new RegExp(expectedKey as string))).toBeInTheDocument();
  });

  it("treats midnight as night and noon as afternoon at the bucket edges", async () => {
    hoursSpy.mockReturnValue(0);
    const { unmount } = render(<WelcomePage />);
    expect(await screen.findByText(/nav\.greeting_night/)).toBeInTheDocument();
    unmount();

    hoursSpy.mockReturnValue(12);
    render(<WelcomePage />);
    expect(await screen.findByText(/nav\.greeting_afternoon/)).toBeInTheDocument();
  });
});

// ── Identity fallbacks ───────────────────────────────────────────────

describe("WelcomePage identity", () => {
  it("renders for an anonymous visitor without redirecting or crashing", async () => {
    mockUser = null;

    render(<WelcomePage />);

    expect(await screen.findByText(/Admin/)).toBeInTheDocument();
    expect(screen.getByText("SoulLedger")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
  });

  it("prefers display_name over username", async () => {
    mockUser = { display_name: "阎罗", username: "yama", role: "JUDGE" };

    render(<WelcomePage />);

    expect(await screen.findByText(/阎罗/)).toBeInTheDocument();
    expect(screen.queryByText(/yama/)).not.toBeInTheDocument();
  });

  it("falls back to username when display_name is empty", async () => {
    mockUser = { display_name: "", username: "yama", role: "JUDGE" };

    render(<WelcomePage />);

    expect(await screen.findByText(/yama/)).toBeInTheDocument();
  });

  it("shows the tenant display name and role when the user carries them", async () => {
    mockUser = {
      username: "yama",
      role: "GUARDIAN",
      tenant: { display_name: "地府" },
    };

    render(<WelcomePage />);

    expect(await screen.findByText("地府")).toBeInTheDocument();
    expect(screen.getByText("GUARDIAN")).toBeInTheDocument();
  });
});

// ── Activity feed ────────────────────────────────────────────────────

/**
 * The activity feed, and the two tests that used to certify inventions.
 *
 * This block previously asserted three hard-coded rows ("新灵魂 张三 入库",
 * by "admin") and an agent panel listing "soul-indexer" / "ledger-decay" /
 * "judgment-assistant" with a pulsing "running" dot — **none of which existed**.
 * The page fabricated them, and these tests held them in place. `/welcome` is
 * on `PUBLIC_PATHS`, so that fiction was shown to unauthenticated visitors.
 * A third test pinned `/settings` among the quick-action hrefs, a route that
 * has never existed (`ls app/settings` → nothing).
 *
 * A test that asserts invented content is worse than no test: it makes the
 * invention look load-bearing, and it goes red when someone removes it.
 */
describe("WelcomePage activity feed", () => {
  const entry = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    action: "SOUL_CREATE",
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

  it("renders entries returned by the audit API, not invented ones", async () => {
    mockUser = { username: "yama", role: "JUDGE" };
    (auditApi.list as jest.Mock).mockResolvedValue({
      data: {
        results: [
          entry({ id: 1, description: "真实条目 A" }),
          entry({ id: 2, description: "真实条目 B", timestamp: new Date(Date.now() - 3600000).toISOString() }),
        ],
        count: 2,
      },
    });

    render(<WelcomePage />);

    expect(await screen.findByText("真实条目 A")).toBeInTheDocument();
    expect(screen.getByText("welcome.just_now")).toBeInTheDocument();
    expect(screen.getByText("welcome.hours_ago(1)")).toBeInTheDocument();
    // Assert the absence too — the old fixtures must not be reachable.
    expect(screen.queryByText(/张三/)).not.toBeInTheDocument();
  });

  it("shows at most three, because the first page is twenty", async () => {
    mockUser = { username: "yama", role: "JUDGE" };
    (auditApi.list as jest.Mock).mockResolvedValue({
      data: {
        results: Array.from({ length: 20 }, (_, i) => entry({ id: i + 1, description: `条目 ${i + 1}` })),
        count: 20,
      },
    });

    render(<WelcomePage />);

    await screen.findByText("条目 1");
    expect(screen.getByText("条目 3")).toBeInTheDocument();
    expect(screen.queryByText("条目 4")).not.toBeInTheDocument();
    // And it must not ask for a page size the backend ignores: DRF runs a
    // plain PageNumberPagination with no page_size_query_param.
    expect((auditApi.list as jest.Mock).mock.calls[0]?.[0]).toBeUndefined();
  });

  it("asks for nothing, and invents nothing, for an anonymous visitor", async () => {
    mockUser = null;
    (auditApi.list as jest.Mock).mockResolvedValue({ data: { results: [], count: 0 } });

    render(<WelcomePage />);

    await waitFor(() => expect(ledgerApi.statsOverview).toHaveBeenCalled());
    // The audit log needs a session. Showing nothing is the honest answer to
    // "what has been happening?" when we are not allowed to know.
    expect(auditApi.list).not.toHaveBeenCalled();
    expect(screen.queryByText(/张三/)).not.toBeInTheDocument();
  });

  it("no longer claims a fleet of agents is running", async () => {
    mockUser = { username: "yama", role: "JUDGE" };
    (auditApi.list as jest.Mock).mockResolvedValue({ data: { results: [], count: 0 } });

    render(<WelcomePage />);

    await waitFor(() => expect(ledgerApi.statsOverview).toHaveBeenCalled());
    for (const invented of ["soul-indexer", "ledger-decay", "judgment-assistant"]) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("welcome.agent_status")).not.toBeInTheDocument();
  });

  it("links the quick actions to routes that exist", async () => {
    mockUser = { username: "yama", role: "JUDGE" };
    (auditApi.list as jest.Mock).mockResolvedValue({ data: { results: [], count: 0 } });

    render(<WelcomePage />);

    const hrefs = (await screen.findAllByRole("link")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/souls", "/workflow", "/judgment", "/ledger", "/audit"]));
    // `/settings` was in this list and has never been a route.
    expect(hrefs).not.toContain("/settings");
  });
});
