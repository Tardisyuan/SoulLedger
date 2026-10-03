/**
 * /audit/logins — the login log, through the real route file with the real
 * zh-Hans bundle.
 *
 * The gate is the interesting part, as on /audit: a non-ADMIN must not merely
 * see "denied" but issue no request, and must not be offered the tab on /audit
 * either. The rest is the filter plumbing: status and search go to the server
 * (the viewset filters them since 2026-10-04; before that `?status=` was
 * silently ignored), and every filter change resets to page 1.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginLogRoute from "@/app/audit/logins/page";
import { AuditTabs } from "@/src/components/audit/AuditTabs";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  loginLogsApi: { list: jest.fn() },
}));
const { loginLogsApi } = jest.requireMock("@soulledger/core/api") as { loginLogsApi: { list: jest.Mock } };

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    formatDateTime: (v: string) => `dt(${v})`,
    formatDate: (v: string) => `day(${new Date(v).getDate()})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

let mockPath = "/audit/logins";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    user: 1,
    username: "yama",
    status: "SUCCESS",
    ip_address: "10.0.0.1",
    user_agent: "Mozilla/5.0",
    failure_reason: "",
    timestamp: "2026-10-03T08:00:00Z",
    ...over,
  };
}
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginLogRoute />
    </QueryClientProvider>
  );
}

/** FilterChipSelect is a native <select> named by its dimension (see AuditPage.test). */
function pickChip(dimensionLabel: string, optionLabel: string) {
  const select = screen.getByRole("combobox", { name: dimensionLabel }) as HTMLSelectElement;
  const option = within(select).getByText(optionLabel) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/audit/logins";
  mockUser = { id: 1, username: "yama", role: "ADMIN", permissions: ["audit.read"] };
  loginLogsApi.list.mockResolvedValue(
    page([
      row(),
      row({ id: 2, username: "hacker", status: "FAILED", failure_reason: "密码错误", timestamp: "2026-10-03T09:00:00Z" }),
      row({ id: 3, username: "yama", timestamp: "2026-10-02T09:00:00Z", ip_address: null, user_agent: "" }),
    ])
  );
});

describe("access", () => {
  it("non-ADMIN with audit.read: denied, no request, and no login-log tab", () => {
    mockUser = { id: 2, username: "mod", role: "MODERATOR", permissions: ["audit.read"] };
    renderRoute();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(loginLogsApi.list).not.toHaveBeenCalled();

    mockPath = "/audit";
    render(<AuditTabs />);
    expect(screen.getByRole("link", { name: tZh("audit.tabs.audit") })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: tZh("audit.tabs.logins") })).toBeNull();
  });

  it("ADMIN: both tabs, rows grouped by day, a failure with its reason", async () => {
    renderRoute();
    expect(screen.getByRole("link", { name: tZh("audit.tabs.logins") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: tZh("audit.tabs.audit") })).toBeInTheDocument();
    await screen.findByText("hacker");
    expect(loginLogsApi.list).toHaveBeenCalledWith({ page: "1" });
    // Two rows on the 3rd share one day head; the 2nd gets its own.
    expect(screen.getAllByText("day(3)")).toHaveLength(1);
    expect(screen.getAllByText("day(2)")).toHaveLength(1);
    const failed = screen.getAllByRole("row").find((r) => within(r).queryByText("hacker"))!;
    expect(within(failed).getByText(tZh("audit.login_log.status.FAILED"))).toBeInTheDocument();
    expect(within(failed).getByText("密码错误")).toBeInTheDocument();
    // `selector: "span"`: the status chip's <option> carries the same label.
    expect(screen.getAllByText(tZh("audit.login_log.status.SUCCESS"), { selector: "span" })).toHaveLength(2);
    // Rows 1 and 2 carry the IP; row 3 (ip_address: null) renders a missing-value mark instead.
    expect(screen.getAllByText("10.0.0.1")).toHaveLength(2);
  });
});

describe("filters go to the server and reset the page", () => {
  it("status, then search, then clear", async () => {
    renderRoute();
    await screen.findByText("hacker");
    pickChip(tZh("audit.login_log.status_label"), tZh("audit.login_log.status.FAILED"));
    await waitFor(() => expect(loginLogsApi.list).toHaveBeenLastCalledWith({ page: "1", status: "FAILED" }));

    fireEvent.change(screen.getByRole("textbox", { name: tZh("audit.login_log.search_placeholder") }), { target: { value: "hac" } });
    await waitFor(() => expect(loginLogsApi.list).toHaveBeenLastCalledWith({ page: "1", status: "FAILED", search: "hac" }));

    fireEvent.click(screen.getByRole("button", { name: tZh("audit.clear_filters") }));
    await waitFor(() => expect(loginLogsApi.list).toHaveBeenLastCalledWith({ page: "1" }));
  });
});
