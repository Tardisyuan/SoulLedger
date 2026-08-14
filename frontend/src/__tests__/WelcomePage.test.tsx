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
import { ledgerApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  ledgerApi: { statsOverview: jest.fn() },
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
  hoursSpy = jest.spyOn(Date.prototype, "getHours").mockReturnValue(10);
});

afterEach(() => {
  hoursSpy.mockRestore();
});

// ── Stats ────────────────────────────────────────────────────────────

describe("WelcomePage quick stats", () => {
  it("shows a placeholder for every stat until the request resolves", () => {
    let resolve: (v: unknown) => void = () => {};
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

describe("WelcomePage activity feed", () => {
  it("labels a just-created entry as 'just now' and older ones in hours", async () => {
    render(<WelcomePage />);

    expect(await screen.findByText("welcome.just_now")).toBeInTheDocument();
    expect(screen.getByText("welcome.hours_ago(1)")).toBeInTheDocument();
    expect(screen.getByText("welcome.hours_ago(2)")).toBeInTheDocument();
  });

  it("renders the agent panel including the task line only for agents that have one", async () => {
    render(<WelcomePage />);

    expect(await screen.findByText("soul-indexer")).toBeInTheDocument();
    expect(screen.getByText("索引新灵魂")).toBeInTheDocument();
    // ledger-decay is idle with no task, so it contributes no task line.
    expect(screen.getByText("ledger-decay")).toBeInTheDocument();
    expect(screen.getAllByText("welcome.running")).toHaveLength(2);
    expect(screen.getAllByText("welcome.idle")).toHaveLength(1);
    expect(screen.queryByText("welcome.working")).not.toBeInTheDocument();
  });

  it("links the quick actions to their routes", async () => {
    render(<WelcomePage />);

    const hrefs = (await screen.findAllByRole("link")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/souls", "/workflow", "/judgment", "/ledger", "/audit", "/settings"]));
  });
});
