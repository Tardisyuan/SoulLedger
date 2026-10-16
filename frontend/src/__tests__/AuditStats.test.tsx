/**
 * /audit/stats (第三十七批 W-9b), through the real route file with the real
 * zh-Hans bundle.
 *
 * Pinned: the scope line names the global admin's 「全部殿」 and everyone
 * else's 「本殿」; action bars run from most to fewest and a zero-count action
 * draws no bar but is counted in `zero_actions` (against all `AuditAction`
 * members from `/audit-logs/actions/`); top resources sort by count, ties by
 * name, and each row links to the list pre-filtered by that resource.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditStatsPage from "@/app/audit/stats/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  auditApi: { stats: jest.fn(), actions: jest.fn() },
}));
const { auditApi } = jest.requireMock("@soulledger/core/api") as {
  auditApi: { stats: jest.Mock; actions: jest.Mock };
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
let mockTenantCode: string | null = "CN_DIYU";
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser, tenantCode: mockTenantCode }) }));

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    formatDateTime: (v: string) => `dt(${v})`,
    formatDate: (v: string) => `day(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/audit/stats",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

/** All sixteen `AuditAction` members (backend/apps/audit/models.py). */
const ALL_ACTIONS = [
  "CREATE", "UPDATE", "DELETE", "EXECUTE", "READ", "LOGIN", "LOGOUT", "VIEW", "EXPORT", "IMPORT",
  "PERMISSION_CHANGE", "BATCH_CREATE", "BATCH_UPDATE", "BATCH_DELETE", "IMPERSONATE_START", "IMPERSONATE_END",
];

const STATS = {
  total_logs: 12408,
  action_distribution: [
    { action: "CREATE", count: 3224 },
    { action: "UPDATE", count: 6210 },
    { action: "EXPORT", count: 1180 },
    { action: "LOGIN", count: 0 },
  ],
  top_resources: [
    { resource: "role", count: 40 },
    { resource: "soul", count: 88 },
    { resource: "menu", count: 40 },
  ],
};

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditStatsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, username: "mod", role: "MODERATOR", permissions: ["audit.read"] };
  mockTenantCode = "CN_DIYU";
  auditApi.stats.mockResolvedValue({ data: STATS });
  auditApi.actions.mockResolvedValue({ data: ALL_ACTIONS.map((value) => ({ value, label: "模型中文" })) });
});

it("without audit.read: refused, and no request", () => {
  mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: [] };
  renderRoute();
  expect(screen.getByText(tZh("audit.needs_audit_read"))).toBeInTheDocument();
  expect(auditApi.stats).not.toHaveBeenCalled();
});

it("a hall-bound reader (moderator here) sees 「本殿」 with the total, and the note", async () => {
  renderRoute();
  expect(await screen.findByTestId("stats-scope")).toHaveTextContent(tZh("audit.stats.scope_hall", { count: "12,408" }));
  expect(screen.getByText(tZh("audit.stats.scope_note"))).toBeInTheDocument();
  expect(auditApi.stats).toHaveBeenCalledWith();
});

it("the global admin (ADMIN, no hall) sees 「全部殿」; a hall-bound ADMIN does not", async () => {
  mockUser = { id: 3, username: "root", role: "ADMIN", permissions: [] };
  mockTenantCode = null;
  const { unmount } = renderRoute();
  expect(await screen.findByTestId("stats-scope")).toHaveTextContent(tZh("audit.stats.scope_all", { count: "12,408" }));
  unmount();

  mockTenantCode = "CN_DIYU";
  renderRoute();
  expect(await screen.findByTestId("stats-scope")).toHaveTextContent(tZh("audit.stats.scope_hall", { count: "12,408" }));
});

it("action bars run most → fewest; zero-count actions draw no bar and are counted in zero_actions", async () => {
  renderRoute();
  await screen.findByTestId("stats-scope");
  const bars = screen.getAllByTestId("stats-action");
  expect(bars.map((b) => b.querySelector("[data-enum-state]")?.getAttribute("title"))).toEqual(["UPDATE", "CREATE", "EXPORT"]);
  expect(within(bars[0]).getByText(tZh("audit.actions.UPDATE"))).toBeInTheDocument();
  expect(within(bars[0]).getByText("6,210")).toBeInTheDocument();
  // 16 members, 3 drawn (LOGIN's 0 is not drawn) → 13.
  expect(screen.getByText(tZh("audit.stats.zero_actions", { n: "13" }))).toBeInTheDocument();
});

it("top resources: by count, ties by name; each row opens the list filtered by that resource", async () => {
  renderRoute();
  await screen.findByTestId("stats-scope");
  const rows = screen.getAllByTestId("stats-resource");
  const links = rows.map((r) => within(r).getByRole("link"));
  expect(links.map((a) => a.getAttribute("href"))).toEqual(["/audit?resource=soul", "/audit?resource=menu", "/audit?resource=role"]);
  expect(links[0]).toHaveAccessibleName(tZh("audit.stats.row_label", { name: tZh("audit.resources.soul") }));
  expect(within(rows[0]).getByText("88")).toBeInTheDocument();
});

it("empty: reuses audit.no_logs, with no scope line", async () => {
  auditApi.stats.mockResolvedValue({ data: { total_logs: 0, action_distribution: [], top_resources: [] } });
  renderRoute();
  expect(await screen.findByText(tZh("audit.no_logs"))).toBeInTheDocument();
  expect(screen.queryByTestId("stats-scope")).toBeNull();
});

it("failure: stats.failed and a retry", async () => {
  auditApi.stats.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: STATS });
  renderRoute();
  expect(await screen.findByText(tZh("audit.stats.failed"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: tZh("error.retry") }));
  expect(await screen.findByTestId("stats-scope")).toBeInTheDocument();
});
