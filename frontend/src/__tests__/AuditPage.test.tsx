/**
 * Tests for app/audit/page.tsx.
 *
 * The audit log is admin-only, and the guard here is the interesting part:
 * it must not merely hide the table, it must stop the request — a page that
 * renders "access denied" while still fetching the log has leaked it. That
 * is asserted directly (`auditApi.list` not called).
 *
 * The rest covers the filter plumbing: which filters become query params,
 * which one (search) is deliberately client-side only, and the page reset
 * that has to happen whenever a filter changes — otherwise the operator
 * lands on page 4 of a one-page result and sees nothing.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditPage from "@/app/audit/page";
import { auditApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  auditApi: { list: jest.fn() },
  PAGE_SIZE: 20,
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

let mockIsAdmin = true;

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ isAdmin: mockIsAdmin, user: { role: mockIsAdmin ? "ADMIN" : "JUDGE" } }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    formatDateTime: (v: string) => `dt(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));

const mockedList = auditApi.list as jest.Mock;

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    action: "CREATE",
    resource: "Soul",
    resource_id: "9",
    description: "created a soul",
    user: "admin",
    user_display: "admin",
    ip_address: "10.0.0.1",
    timestamp: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<AuditPage />, { wrapper: Wrapper });
}

/** The params object of the most recent auditApi.list call. */
const lastParams = () => mockedList.mock.calls[mockedList.mock.calls.length - 1][0];

/**
 * The filter chips are a custom listbox (§7 forbids native <select>), so
 * picking a value means opening the trigger then clicking the option.
 */
function pickChip(currentTriggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(currentTriggerLabel) }));
  fireEvent.click(within(screen.getByRole("listbox")).getByText(optionLabel));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = true;
  mockedList.mockResolvedValue({ data: { count: 1, results: [entry()] } });
});

// ── Admin gate ───────────────────────────────────────────────────────

describe("AuditPage access control", () => {
  it("refuses a non-admin and issues no request for the log", async () => {
    mockIsAdmin = false;

    renderPage();

    expect(await screen.findByText("audit.access_denied")).toBeInTheDocument();
    expect(screen.getByText("audit.admin_only")).toBeInTheDocument();
    expect(mockedList).not.toHaveBeenCalled();
  });

  it("renders no filter bar or table for a non-admin", async () => {
    mockIsAdmin = false;

    renderPage();

    await screen.findByText("audit.access_denied");
    expect(screen.queryByPlaceholderText("audit.search_placeholder")).not.toBeInTheDocument();
    expect(screen.queryByText("created a soul")).not.toBeInTheDocument();
  });

  it("fetches the log for an admin", async () => {
    renderPage();

    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    expect(await screen.findByText("created a soul")).toBeInTheDocument();
  });
});

// ── Request parameters ───────────────────────────────────────────────

describe("AuditPage request parameters", () => {
  it("sends page and page_size, and nothing else, when unfiltered", async () => {
    renderPage();

    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    expect(lastParams()).toEqual({ page: "1", page_size: "20" });
  });

  it("adds an action filter to the query", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());

    pickChip("audit.all_actions", "audit.actions.DELETE");

    await waitFor(() => expect(lastParams().action).toBe("DELETE"));
  });

  it("adds a resource filter to the query", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());

    pickChip("audit.all_resources", "User");

    await waitFor(() => expect(lastParams().resource).toBe("user"));
  });

  it("turns the 7d preset into a start_date and leaves end_date unset", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());

    pickChip("audit.date_all", "audit.date_7d");

    await waitFor(() => expect(lastParams().start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    expect(lastParams().end_date).toBeUndefined();
  });

  it("produces an earlier start_date for 30d than for 7d", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());

    pickChip("audit.date_all", "audit.date_7d");
    await waitFor(() => expect(lastParams().start_date).toBeDefined());
    const sevenDay = lastParams().start_date;

    pickChip("audit.date_7d", "audit.date_30d");
    await waitFor(() => expect(lastParams().start_date).not.toBe(sevenDay));

    expect(lastParams().start_date < sevenDay).toBe(true);
  });

  it("does not send the search box as a query param — it filters client-side", async () => {
    mockedList.mockResolvedValue({
      data: { count: 2, results: [entry({ id: 1 }), entry({ id: 2, description: "deleted a user", resource: "User" })] },
    });
    renderPage();
    await screen.findByText("created a soul");
    const callsBefore = mockedList.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText("audit.search_placeholder"), {
      target: { value: "deleted" },
    });

    await waitFor(() => expect(screen.queryByText("created a soul")).not.toBeInTheDocument());
    expect(screen.getByText("deleted a user")).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledTimes(callsBefore);
  });

  it("matches the search against the resource name as well as the description", async () => {
    mockedList.mockResolvedValue({
      data: { count: 2, results: [entry({ id: 1 }), entry({ id: 2, description: "x", resource: "Permission" })] },
    });
    renderPage();
    await screen.findByText("created a soul");

    fireEvent.change(screen.getByPlaceholderText("audit.search_placeholder"), {
      target: { value: "permis" },
    });

    await waitFor(() => expect(screen.queryByText("created a soul")).not.toBeInTheDocument());
  });
});

// ── Filter reset ─────────────────────────────────────────────────────

describe("AuditPage filter clearing", () => {
  it("offers no clear-all control until something is filtered", async () => {
    renderPage();

    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    expect(screen.queryByText("audit.clear_filters")).not.toBeInTheDocument();
  });

  it("clears every filter and returns to page one", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());

    pickChip("audit.all_actions", "audit.actions.DELETE");
    fireEvent.change(screen.getByPlaceholderText("audit.search_placeholder"), { target: { value: "zz" } });
    await waitFor(() => expect(screen.getByText("audit.clear_filters")).toBeInTheDocument());

    fireEvent.click(screen.getByText("audit.clear_filters"));

    await waitFor(() => expect(lastParams()).toEqual({ page: "1", page_size: "20" }));
    expect(screen.getByPlaceholderText("audit.search_placeholder")).toHaveValue("");
  });
});

// ── Table states ─────────────────────────────────────────────────────

describe("AuditPage table states", () => {
  it("renders the grouped row with its formatted timestamp and ip", async () => {
    renderPage();

    expect(await screen.findByText("created a soul")).toBeInTheDocument();
    expect(screen.getByText("dt(2026-01-01T00:00:00Z)")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
  });

  it("shows the empty message when the log has no entries", async () => {
    mockedList.mockResolvedValue({ data: { count: 0, results: [] } });

    renderPage();

    expect(await screen.findByText("audit.no_logs")).toBeInTheDocument();
  });

  it("offers a retry when the request fails, and re-issues it", async () => {
    mockedList.mockRejectedValue(new Error("500"));
    renderPage();

    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    const retry = await screen.findByText(/retry|重试/i);
    const callsBefore = mockedList.mock.calls.length;

    fireEvent.click(retry);

    await waitFor(() => expect(mockedList.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("sends an ordering param when a sortable column header is activated", async () => {
    renderPage();
    await screen.findByText("created a soul");

    fireEvent.click(screen.getByText("audit.timestamp"));

    await waitFor(() => expect(lastParams().ordering).toBeDefined());
  });
});
