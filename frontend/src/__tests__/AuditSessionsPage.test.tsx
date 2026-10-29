/**
 * /audit/sessions — the admin's online sessions, through the real route file with the real zh-Hans bundle (2026-10-29).
 *
 * The gate: without `session.manage` the page is denied, no request is made and the tab is absent. With it: officers
 * and souls are two tabs that each ask the server for their kind; a name narrows the list to that person; signing a
 * session out goes through a confirm dialog and calls the one-session endpoint; "sign out everywhere" calls the
 * per-user endpoint; the row of this admin's own session offers no button.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SessionsRoute from "@/app/audit/sessions/page";
import { AuditTabs } from "@/src/components/audit/AuditTabs";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  adminSessionsApi: { list: jest.fn(), revoke: jest.fn(), revokeUser: jest.fn() },
}));
const { adminSessionsApi } = jest.requireMock("@soulledger/core/api") as {
  adminSessionsApi: { list: jest.Mock; revoke: jest.Mock; revokeUser: jest.Mock };
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    formatDateTime: (v: string) => `dt(${v})`,
    formatDate: (v: string) => `day(${v})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

let mockPath = "/audit/sessions";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

function row(over: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    user_id: 7,
    username: "cn_judge",
    display_name: "",
    tenant_code: "CN_DIYU",
    label: "macOS · Safari",
    method: "password",
    ip_address: "198.51.100.7",
    created_at: "2026-10-29T08:00:00Z",
    last_seen_at: "2026-10-29T09:00:00Z",
    current: false,
    ...over,
  };
}
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionsRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/audit/sessions";
  mockUser = { id: 1, username: "root", role: "ADMIN", permissions: [] };
  adminSessionsApi.list.mockResolvedValue(
    page([row(), row({ id: "s-me", user_id: 1, username: "root", label: "Windows · Edge", ip_address: null, current: true })]),
  );
  adminSessionsApi.revoke.mockResolvedValue({ data: undefined });
  adminSessionsApi.revokeUser.mockResolvedValue({ data: { revoked: 2 } });
});

describe("access", () => {
  it("without session.manage: denied, no request, no tab", () => {
    mockUser = { id: 2, username: "mod", role: "MODERATOR", permissions: ["audit.read"] };
    renderRoute();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(adminSessionsApi.list).not.toHaveBeenCalled();
    mockPath = "/audit";
    render(<AuditTabs />);
    expect(screen.queryByRole("link", { name: tZh("audit.tabs.sessions") })).toBeNull();
  });

  it("a non-ADMIN granted session.manage gets the page and the tab", async () => {
    mockUser = { id: 3, username: "lead", role: "MODERATOR", permissions: ["session.manage"] };
    renderRoute();
    expect(screen.getByRole("link", { name: tZh("audit.tabs.sessions") })).toHaveAttribute("aria-current", "page");
    await screen.findByText("cn_judge");
  });
});

describe("listing", () => {
  it("officers first, souls on their own tab, the own session without a button", async () => {
    renderRoute();
    await screen.findByText("cn_judge");
    expect(adminSessionsApi.list).toHaveBeenCalledWith({ kind: "officer", page: "1" });
    const mine = screen.getAllByRole("row").find((r) => within(r).queryByText("Windows · Edge"))!;
    expect(within(mine).getByText(tZh("audit.sessions.current"))).toBeInTheDocument();
    expect(within(mine).queryByRole("button", { name: tZh("audit.sessions.revoke") })).toBeNull();
    expect(screen.getByText("198.51.100.7")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: tZh("audit.sessions.kind.soul") }));
    await waitFor(() => expect(adminSessionsApi.list).toHaveBeenLastCalledWith({ kind: "soul", page: "1" }));
  });

  it("a name narrows the list to that person", async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole("button", { name: "cn_judge" }));
    await waitFor(() => expect(adminSessionsApi.list).toHaveBeenLastCalledWith({ kind: "officer", page: "1", user: "7" }));
    expect(screen.getByText(tZh("audit.sessions.filtered_by", { name: "cn_judge" }))).toBeInTheDocument();
  });
});

describe("force sign-out", () => {
  it("one session, after confirming", async () => {
    renderRoute();
    await screen.findByText("macOS · Safari");
    const theirs = screen.getAllByRole("row").find((r) => within(r).queryByText("macOS · Safari"))!;
    fireEvent.click(within(theirs).getByRole("button", { name: tZh("audit.sessions.revoke") }));
    expect(adminSessionsApi.revoke).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("audit.sessions.revoke") }));
    await waitFor(() => expect(adminSessionsApi.revoke).toHaveBeenCalledWith("s-1"));
    expect(adminSessionsApi.revokeUser).not.toHaveBeenCalled();
  });

  it("every session of one person", async () => {
    renderRoute();
    fireEvent.click(await screen.findByRole("button", { name: "cn_judge" }));
    fireEvent.click(await screen.findByRole("button", { name: tZh("audit.sessions.revoke_all") }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("audit.sessions.revoke_all") }));
    await waitFor(() => expect(adminSessionsApi.revokeUser).toHaveBeenCalledWith(7));
    expect(adminSessionsApi.revoke).not.toHaveBeenCalled();
  });
});
