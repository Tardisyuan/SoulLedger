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
import { ledgerApi } from "@/lib/api";

const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearch,
}));

jest.mock("@/lib/api", () => ({
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
  state_distribution: [
    { state: "ALIVE", label: "Alive", count: 2 },
    { state: "JUDGING", label: "Judging", count: 1 },
    { state: "DISPOSED", label: "Disposed", count: 1 },
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
    const cardValues = screen
      .getAllByText(/^\d+$/)
      .filter((el) => el.className.includes("text-2xl font-bold"))
      .map((el) => el.textContent);
    // The four summary cards come first: total / alive / judging / disposed.
    expect(cardValues.slice(0, 4)).toEqual(["4", "2", "1", "1"]);
  });

  it("falls back to zero for a state the payload omits", async () => {
    mockedStats.mockResolvedValue({ ...baseStats, data: { ...baseStats, state_distribution: [] } });

    renderPage();

    await waitFor(() => expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3));
  });

  it("shows the API label in the pie legend when no translation exists", async () => {
    renderPage();

    expect(await screen.findByTestId("pie")).toHaveTextContent("Alive|Judging|Disposed");
  });

  it("shows the translated state name when one exists", async () => {
    mockT.mockImplementation((key: string) => (key === "souls.states.ALIVE" ? "存活" : key));

    renderPage();

    expect(await screen.findByTestId("pie")).toHaveTextContent("存活|Judging|Disposed");
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

  it("hides the export button from a user lacking karma.export", async () => {
    mockUser = { role: "JUDGE", permissions: ["souls.read"] };

    renderPage();

    await screen.findByText("dashboard.tab_overview");
    expect(screen.queryByText("dashboard.export_stats")).not.toBeInTheDocument();
  });

  it("shows the export button to a user holding karma.export without being admin", async () => {
    mockUser = { role: "JUDGE", permissions: ["karma.export"] };

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
});
