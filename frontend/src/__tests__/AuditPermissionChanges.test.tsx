/**
 * /audit/permissions — the permission-change timeline (第三十七批 W-9a), through
 * the real route file with the real zh-Hans bundle.
 *
 * What is pinned: entries grouped by local day; each entry shows at most three
 * change rows and 「另 N 项」 for the rest; a create lists field names only (no
 * "before"); 「显示更多」 walks the limit 50 → 200 → 500 and the 500th row turns
 * the button into `cap_reached`; the two empty sentences split on the date
 * preset; a failure offers a retry. No ×N folding: two identical updates are
 * two entries.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PermissionChangesPage from "@/app/audit/permissions/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  auditApi: { timeline: jest.fn(), actions: jest.fn() },
}));
const { auditApi } = jest.requireMock("@soulledger/core/api") as {
  auditApi: { timeline: jest.Mock; actions: jest.Mock };
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
let mockReady = true;
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser, tenantCode: "CN_DIYU", permissionsReady: mockReady }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    formatDateTime: (v: string) => `dt(${v})`,
    // Day heads ask for year/month/day; the entry's own time asks for hour/minute only.
    formatDate: (v: string, o?: Intl.DateTimeFormatOptions) =>
      o?.year ? `day(${new Date(v).getDate()})` : `time(${new Date(v).getHours()})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/audit/permissions",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

/** Local wall-clock time, so the day grouping (local calendar day) is what the test says. */
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();

let nextId = 1;
function log(over: Record<string, unknown> = {}) {
  return {
    id: nextId++,
    action: "UPDATE",
    resource: "rolepermission",
    resource_id: "41",
    changes: { permissions: { old: ["souls.read"], new: ["souls.read", "souls.write"] } },
    ip_address: null,
    description: "",
    timestamp: at(17, 14),
    username: "cui",
    tenant_code: "CN_DIYU",
    user_display: "崔判官",
    trace_id: "",
    ...over,
  };
}
const many = (n: number) => Array.from({ length: n }, () => log());

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionChangesPage />
    </QueryClientProvider>
  );
}

const lastParams = () => auditApi.timeline.mock.calls[auditApi.timeline.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();
  nextId = 1;
  mockReady = true;
  mockUser = { id: 1, username: "mod", role: "MODERATOR", permissions: ["audit.read"] };
  auditApi.actions.mockResolvedValue({ data: ["CREATE", "UPDATE", "DELETE"].map((value) => ({ value, label: "模型中文" })) });
});

it("without audit.read: refused, and no request", () => {
  mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: [] };
  renderRoute();
  expect(screen.getByText(tZh("audit.needs_audit_read"))).toBeInTheDocument();
  expect(auditApi.timeline).not.toHaveBeenCalled();
  expect(screen.queryByTestId("permissions-pending")).not.toBeInTheDocument();
});

it("while permissions are still on their way, a skeleton — not the refusal, and no request", () => {
  // Same rule as the other three audit pages: "no code yet" is not "no right".
  mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: [] };
  mockReady = false;
  const { rerender } = renderRoute();
  expect(screen.getByTestId("permissions-pending")).toBeInTheDocument();
  expect(screen.queryByText(tZh("audit.needs_audit_read"))).not.toBeInTheDocument();
  expect(auditApi.timeline).not.toHaveBeenCalled();

  // The codes arrive without audit.read: now it is a refusal.
  mockReady = true;
  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <PermissionChangesPage />
    </QueryClientProvider>
  );
  expect(screen.getByText(tZh("audit.needs_audit_read"))).toBeInTheDocument();
  expect(screen.queryByTestId("permissions-pending")).not.toBeInTheDocument();
});

it("groups by local day, keeps every step (no ×N), and links each entry to its detail", async () => {
  auditApi.timeline.mockResolvedValue({
    data: [log({ timestamp: at(17, 14) }), log({ timestamp: at(17, 9) }), log({ timestamp: at(15, 17), action: "DELETE" })],
  });
  renderRoute();
  await screen.findAllByTestId("timeline-entry");
  expect(lastParams()).toEqual({ limit: 50 });
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["day(17)", "day(15)"]);
  // Two identical updates on the 17th stay two entries.
  expect(screen.getAllByTestId("timeline-entry")).toHaveLength(3);
  const links = screen.getAllByRole("link", { name: tZh("audit.timeline.details") });
  expect(links.map((a) => a.getAttribute("href"))).toEqual(["/audit/1", "/audit/2", "/audit/3"]);
  expect(screen.getAllByText(tZh("audit.resources.rolepermission"), { selector: "span" })).toHaveLength(3);
});

it("shows at most three change rows, then 「另 N 项」; update dots are filled", async () => {
  const changes = { a: ["1", "2"], b: ["1", "2"], c: ["1", "2"], d: ["1", "2"], e: ["1", "2"] };
  auditApi.timeline.mockResolvedValue({ data: [log({ changes })] });
  renderRoute();
  const entry = await screen.findByTestId("timeline-entry");
  expect(within(entry).getAllByTestId("timeline-change")).toHaveLength(3);
  expect(within(entry).queryByText("d")).toBeNull();
  expect(within(entry).getByText(tZh("audit.timeline.more_fields", { n: "2" }), { exact: false })).toBeInTheDocument();
  expect(entry.querySelector("[data-dot]")).toHaveAttribute("data-dot", "filled");
});

it("a create has no before: field names only, hollow dot", async () => {
  auditApi.timeline.mockResolvedValue({
    data: [log({ action: "CREATE", resource: "menubutton", changes: { name: [null, "导出处置"], code: [null, "export"] } })],
  });
  renderRoute();
  const entry = await screen.findByTestId("timeline-entry");
  expect(within(entry).getByTestId("timeline-fields")).toHaveTextContent("name · code");
  expect(within(entry).queryAllByTestId("timeline-change")).toHaveLength(0);
  expect(within(entry).queryByText("导出处置")).toBeNull();
  expect(entry.querySelector("[data-dot]")).toHaveAttribute("data-dot", "hollow");
  // Fewer than three fields: no 「另 N 项」.
  expect(within(entry).queryByText(/另 \d+ 项/)).toBeNull();
});

// Renders up to 500 rows: 0.5 s alone, but over 5 s inside the full jest run on a loaded machine (2026-10-23, the
// pre-push run timed out at load ~19). The longer timeout is for that load, not for a slow page.
it("「显示更多」 raises the limit 50 → 200 → 500; at 500 rows it says cap_reached instead", async () => {
  auditApi.timeline.mockImplementation(async ({ limit }: { limit: number }) => ({ data: many(limit) }));
  renderRoute();
  fireEvent.click(await screen.findByRole("button", { name: tZh("audit.timeline.show_more") }));
  await waitFor(() => expect(lastParams()).toEqual({ limit: 200 }));
  await waitFor(() => expect(screen.getAllByTestId("timeline-entry")).toHaveLength(200));
  fireEvent.click(screen.getByRole("button", { name: tZh("audit.timeline.show_more") }));
  await waitFor(() => expect(lastParams()).toEqual({ limit: 500 }));
  expect(await screen.findByText(tZh("audit.timeline.cap_reached"))).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: tZh("audit.timeline.show_more") })).toBeNull();
}, 20_000);

it("fewer rows than the limit: no 「显示更多」 and no cap note", async () => {
  auditApi.timeline.mockResolvedValue({ data: many(12) });
  renderRoute();
  await screen.findAllByTestId("timeline-entry");
  expect(screen.queryByRole("button", { name: tZh("audit.timeline.show_more") })).toBeNull();
  expect(screen.queryByText(tZh("audit.timeline.cap_reached"))).toBeNull();
});

it("filters: only the six permission resources; the pick goes to the server as the exact resource", async () => {
  auditApi.timeline.mockResolvedValue({ data: [log({ resource: "role", resource_id: "3" })] });
  renderRoute();
  await screen.findAllByTestId("timeline-entry");
  const select = screen.getByRole("combobox", { name: tZh("audit.filter_resource") }) as HTMLSelectElement;
  expect(Array.from(select.options).map((o) => o.value)).toEqual([
    "", "role", "rolepermission", "menu", "menubutton", "fieldpermission", "permission",
  ]);
  fireEvent.change(select, { target: { value: "role" } });
  await waitFor(() => expect(lastParams()).toEqual({ limit: 50, resource: "role" }));
});

it("draws exactly what the server returned: no client-side re-filter, so 「显示更多」 counts the rows shown", async () => {
  // The backend matches `resource` exactly (2026-10-17). Whatever it returns is drawn — even a row whose
  // resource is not the one picked — so the page cannot hide rows that 「显示更多」 / cap_reached counted.
  auditApi.timeline.mockImplementation(async ({ resource }: { resource?: string }) => ({
    data: resource
      ? [...many(49), log({ resource: "rolepermission", resource_id: "41" })]
      : [log({ resource: "role", resource_id: "3" })],
  }));
  renderRoute();
  await screen.findAllByTestId("timeline-entry");
  fireEvent.change(screen.getByRole("combobox", { name: tZh("audit.filter_resource") }), { target: { value: "role" } });
  await waitFor(() => expect(screen.getAllByTestId("timeline-entry")).toHaveLength(50));
  expect(screen.getAllByText("#41").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: tZh("audit.timeline.show_more") })).toBeInTheDocument();
});

it("empty: 「还没有」 when the date is 全部, 「这段时间没有」 with a preset (which sends start_date)", async () => {
  auditApi.timeline.mockResolvedValue({ data: [] });
  renderRoute();
  expect(await screen.findByText(tZh("audit.timeline.empty_all"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: tZh("audit.date_7d") }));
  expect(await screen.findByText(tZh("audit.timeline.empty"))).toBeInTheDocument();
  expect(lastParams()).toEqual({ limit: 50, start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(screen.queryByText(tZh("audit.timeline.empty_all"))).toBeNull();
});

it("failure: the timeline's own sentence and a retry", async () => {
  auditApi.timeline.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: [log()] });
  renderRoute();
  expect(await screen.findByText(tZh("audit.timeline.failed"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: tZh("error.retry") }));
  expect(await screen.findByTestId("timeline-entry")).toBeInTheDocument();
});
