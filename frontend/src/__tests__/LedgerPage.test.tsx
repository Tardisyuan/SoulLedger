/**
 * Tests for app/ledger/page.tsx — the ledger statistics screen.
 *
 * This page renders three independent sections that each have to survive a
 * failed or empty stats call on their own. The interesting failure is the
 * quiet one: a section that renders zeros instead of an error, or a realm /
 * activity block that shows an empty shell when the backend returned
 * nothing. Both the error path and the "section must not appear" path are
 * asserted below.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LedgerPage from "@/app/ledger/page";
import { ledgerApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  ledgerApi: { statsOverview: jest.fn() },
}));

// `permissions` 现在是必需的:页面外面包了
// `<RequirePermission permissions="ledger.read">`。这个套件测的是账本数字怎么
// 渲染,不是权限 —— 给足权限,让它继续测它自己的东西。门本身由
// `backend/tests/test_page_gates_match_the_backend.py` 守。
type MockUser = { id: number; role?: string; permissions?: string[] };
let mockUser: MockUser | null = { id: 1, role: "VIEWER", permissions: ["ledger.read"] };
const mockT = jest.fn((key: string) => key);

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => mockT(key),
    formatDateTime: (value: string) => `dt(${value})`,
    locale: "en",
    hydrated: true,
  }),
}));

// The bar chart is a next/dynamic import; stub it so the assertions are
// about the page's own branching, not recharts' internals.
jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazyBarChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="bar-chart">{data.length}</div>
  ),
}));

const mockedStats = ledgerApi.statsOverview as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<LedgerPage />, { wrapper: Wrapper });
}

const fullStats = {
  total_souls: 128,
  state_distribution: [
    { state: "ALIVE", label: "Alive", count: 40 },
    { state: "JUDGING", label: "Judging", count: 12 },
    { state: "DISPOSED", label: "Disposed", count: 30 },
    { state: "REINCARNATING", label: "Reincarnating", count: 5 },
    { state: "SETTLED", label: "Settled", count: 8 },
    { state: "UNKNOWN_STATE", label: "Mystery", count: 1 },
  ],
  karma_distribution: [
    { name: "0-100", count: 3 },
    { name: "100-200", count: 7 },
  ],
  souls_by_realm: [
    { realm_code: "R1", realm_name: "Diyu", civilization: "CHINESE", count: 20 },
    { realm_code: "R2", realm_name: "Duat", civilization: "EGYPTIAN", count: 11 },
  ],
  recent_activity: [
    {
      id: 1,
      action: "CREATE",
      description: "Soul added",
      user: "admin",
      resource: "Soul",
      resource_id: "9",
      timestamp: "2026-01-01T00:00:00Z",
    },
    {
      id: 2,
      action: "DELETE",
      description: "",
      user: "clerk",
      resource: "Soul",
      resource_id: "10",
      timestamp: "2026-01-02T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, role: "VIEWER", permissions: ["ledger.read"] };
  mockT.mockImplementation((key: string) => key);
  mockedStats.mockResolvedValue({ data: fullStats });
});

// ── Data path ────────────────────────────────────────────────────────

describe("LedgerPage with data", () => {
  it("renders the headline totals from the stats payload", async () => {
    renderPage();

    expect(await screen.findByText("128")).toBeInTheDocument();
    // ALIVE and JUDGING counts feed the other two overview cards.
    expect(screen.getAllByText("40").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("renders one row per state, including a state it has no colour for", async () => {
    renderPage();

    for (const label of ["Alive", "Judging", "Disposed", "Reincarnating", "Settled", "Mystery"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("prefers the backend label when the i18n key has no translation", async () => {
    renderPage();

    expect(await screen.findByText("Alive")).toBeInTheDocument();
    expect(screen.queryByText("souls.states.ALIVE")).not.toBeInTheDocument();
  });

  it("prefers the translation when one exists for the state key", async () => {
    mockT.mockImplementation((key: string) => (key === "souls.states.ALIVE" ? "存活" : key));

    renderPage();

    expect(await screen.findByText("存活")).toBeInTheDocument();
    expect(screen.queryByText("Alive")).not.toBeInTheDocument();
  });

  it("feeds the karma distribution into the bar chart", async () => {
    renderPage();

    expect(await screen.findByTestId("bar-chart")).toHaveTextContent("2");
  });

  it("renders the realm section with its civilization annotations", async () => {
    renderPage();

    expect(await screen.findByText("Diyu")).toBeInTheDocument();
    // Raw enum in `title`, translated copy in the text node (BRIEF §4.6).
    expect(screen.getByTitle("EGYPTIAN")).toBeInTheDocument();
  });

  it("renders recent activity, falling back to the action label when the description is blank", async () => {
    renderPage();

    expect(await screen.findByText("Soul added")).toBeInTheDocument();
    // The DELETE row has an empty description, so it shows the action label
    // in the body as well as in the badge — hence two matches. Since BRIEF
    // §4.6 both go through <DomainEnum>, which carries the raw member in
    // `title` and translated copy in the text node (`t` is mocked to echo its
    // key here, so the visible copy is the convention's unrecognized string).
    expect(screen.getAllByTitle("DELETE")).toHaveLength(2);
    expect(screen.queryByText("DELETE")).not.toBeInTheDocument();
  });

  it("makes the audit row's record id copyable rather than dead text", async () => {
    // This page is the one registered IDENTIFIER_POLICY_EXCEPTIONS entry: an
    // audit line's content IS the record it touched, so the id stays in a list
    // — but the clause it does NOT get to break is copyability, and it used to
    // render as `#9` inside a plain span.
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderPage();

    const idButton = await screen.findByTitle("9");
    expect(idButton.tagName).toBe("BUTTON");
    expect(idButton).toHaveTextContent("#9");

    fireEvent.click(idButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("9"));
  });

  it("formats activity timestamps through the i18n formatter", async () => {
    renderPage();

    expect(await screen.findByText("dt(2026-01-01T00:00:00Z)")).toBeInTheDocument();
  });
});

// ── Empty / partial payloads ─────────────────────────────────────────

describe("LedgerPage with a sparse payload", () => {
  it("omits the realm section entirely when the list is empty", async () => {
    mockedStats.mockResolvedValue({ data: { ...fullStats, souls_by_realm: [] } });

    renderPage();

    await screen.findByText("128");
    expect(screen.queryByText("ledger.souls_by_realm")).not.toBeInTheDocument();
  });

  it("omits the activity section entirely when the list is empty", async () => {
    mockedStats.mockResolvedValue({ data: { ...fullStats, recent_activity: [] } });

    renderPage();

    await screen.findByText("128");
    expect(screen.queryByText("ledger.recent_activity")).not.toBeInTheDocument();
  });

  it("shows zero rather than blank when a count is missing from the payload", async () => {
    mockedStats.mockResolvedValue({ data: { total_souls: 5, state_distribution: [] } });

    renderPage();

    await screen.findByText("5");
    // active + judging overview figures both fall back to 0.
    //
    // Selected by `data-overview-figure` rather than by the figure's size
    // class, which is what this line used to do (`text-3xl`). That coupling
    // broke on the eight-step type migration for a reason worth keeping out of
    // the next selector: `text-3xl` is not merely a different size, it is one
    // of the classes `design-system/type-scale` now forbids, so the assertion
    // was pinned to a class the design system had committed to deleting. Naming
    // `text-07` here would buy the same debt at the next scale change. The hook
    // says "this element is an overview figure", which is the thing the
    // assertion is actually about and is stable across restyling.
    const overviewZeros = screen
      .getAllByText("0")
      .filter((el) => el.hasAttribute("data-overview-figure"));
    expect(overviewZeros).toHaveLength(2);
  });

  it("caps the activity list at ten rows", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: i,
      action: "UPDATE",
      description: `activity-${i}`,
      user: "u",
      resource: "Soul",
      resource_id: String(i),
      timestamp: "2026-01-01T00:00:00Z",
    }));
    mockedStats.mockResolvedValue({ data: { ...fullStats, recent_activity: many } });

    renderPage();

    expect(await screen.findByText("activity-0")).toBeInTheDocument();
    expect(screen.getByText("activity-9")).toBeInTheDocument();
    expect(screen.queryByText("activity-10")).not.toBeInTheDocument();
  });
});

// ── Failure and gating ───────────────────────────────────────────────

describe("LedgerPage failure handling", () => {
  it("shows an error message in each section instead of empty data", async () => {
    mockedStats.mockRejectedValue(new Error("boom"));

    renderPage();

    await waitFor(() => expect(screen.getAllByText("common.error").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("still renders the page header when the stats call fails", async () => {
    mockedStats.mockRejectedValue(new Error("boom"));

    renderPage();

    expect(await screen.findByText("ledger.title")).toBeInTheDocument();
  });

  it("does not call the stats endpoint at all when there is no user", async () => {
    /* 「没有用户就不发请求」这件事仍然成立,只是现在由页级的
       `<RequirePermission permissions="ledger.read">` 完成 —— `usePermissions`
       在没有 user 时对任何码名返回 false,门直接渲染 PermissionDenied。
       所以断言从「页头还在」改成「页头不在、且没发请求」:页头还在才是旧行为,
       那时页面渲染了自己、只是查询被 `enabled` 关掉了。 */
    mockUser = null;

    renderPage();

    await waitFor(() => expect(mockedStats).not.toHaveBeenCalled());
    expect(screen.queryByText("ledger.title")).not.toBeInTheDocument();
  });
});
