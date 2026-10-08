/**
 * /death-sync/webhooks — admin webhook management, through the real route file
 * with the real zh-Hans bundle.
 *
 * Asserted beyond a green render: the non-ADMIN half issues no webhook or
 * deliveries request and sees no tab; the checklist is fed by
 * `event-types/` (not a list in the client) and the create body carries only
 * what was ticked; the signing secret appears exactly once — in the dialog the
 * 201 opens — and is gone from the document when it closes; disable goes
 * through the confirm dialog and PATCHes `is_active: false` for that row only;
 * and the deliveries table renders status / attempt / error and narrows to
 * one webhook on request.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WebhooksRoute from "@/app/death-sync/webhooks/page";
import DeathSyncPage from "@/app/death-sync/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  deathSyncApi: {
    registrations: jest.fn(),
    summary: jest.fn(),
    apiKeys: jest.fn(),
    webhooks: jest.fn(),
    webhookEventTypes: jest.fn(),
    createWebhook: jest.fn(),
    updateWebhook: jest.fn(),
    disableWebhook: jest.fn(),
    webhookDeliveries: jest.fn(),
  },
}));
const { deathSyncApi } = jest.requireMock("@soulledger/core/api") as { deathSyncApi: Record<string, jest.Mock> };

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
let mockPath = "/death-sync/webhooks";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const SECRET = "whsec_one_time_SECRET_7c2e";
const EVENT_TYPES = ["SOUL_CREATED", "DEATH_SYNC_PROCESSED", "SCHEDULER_RUN_FAILED"];

function hook(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    api_key: "k1",
    api_key_name: "市立医院",
    url: "https://hooks.example.org/a",
    is_active: true,
    events: ["DEATH_SYNC_PROCESSED"],
    max_retries: 5,
    timeout_seconds: 10,
    create_time: "2026-10-08T01:00:00Z",
    update_time: "2026-10-08T01:00:00Z",
    ...over,
  };
}
function delivery(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    webhook: "w1",
    webhook_url: "https://hooks.example.org/a",
    domain: "death_sync",
    event_type: "DEATH_SYNC_PROCESSED",
    status: "FAILED",
    attempt: 3,
    response_status: 502,
    error: "RuntimeError: HTTP 502",
    delivered_at: null,
    create_time: "2026-10-08T02:00:00Z",
    update_time: "2026-10-08T02:00:00Z",
    ...over,
  };
}
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });

function renderRoute(ui: ReactNode = <WebhooksRoute />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/death-sync/webhooks";
  mockUser = { id: 1, username: "yama", role: "ADMIN", permissions: [] };
  deathSyncApi.webhooks.mockResolvedValue(page([hook(), hook({ id: "w2", url: "https://hooks.example.org/old", is_active: false, events: [] })]));
  deathSyncApi.webhookEventTypes.mockResolvedValue({ data: EVENT_TYPES });
  deathSyncApi.apiKeys.mockResolvedValue(
    page([
      { id: "k1", name: "市立医院", key_prefix: "sk_abcd1", is_active: true },
      { id: "k0", name: "旧钥", key_prefix: "sk_old00", is_active: false },
    ])
  );
  deathSyncApi.webhookDeliveries.mockResolvedValue(page([delivery(), delivery({ id: "d2", webhook: "w2", webhook_url: "https://hooks.example.org/old", status: "SUCCESS", attempt: 1, response_status: 200, error: "" })]));
  deathSyncApi.registrations.mockResolvedValue(page([]));
  deathSyncApi.summary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 0 } });
});

describe("access", () => {
  it("non-ADMIN: denied, no request, and no webhooks tab on /death-sync", async () => {
    mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: ["audit.read"] };
    const denied = renderRoute();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(deathSyncApi.webhooks).not.toHaveBeenCalled();
    expect(deathSyncApi.webhookDeliveries).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: tZh("death_sync.tabs.webhooks") })).toBeNull();
    denied.unmount();

    mockPath = "/death-sync";
    renderRoute(<DeathSyncPage />);
    await waitFor(() => expect(deathSyncApi.registrations).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.registrations") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: tZh("death_sync.tabs.webhooks") })).toBeNull();
  });

  it("ADMIN: three tabs, the rows, disable only on an active webhook", async () => {
    renderRoute();
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.webhooks") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.api_keys") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.registrations") })).toBeInTheDocument();
    await screen.findByText("https://hooks.example.org/a");
    const rows = screen.getAllByRole("row");
    const active = rows.find((r) => within(r).queryByText("https://hooks.example.org/a"))!;
    const disabled = rows.find((r) => within(r).queryByText("https://hooks.example.org/old"))!;
    expect(within(active).getByText(tZh("death_sync.webhooks.status.ACTIVE"))).toBeInTheDocument();
    expect(within(active).getByText("DEATH_SYNC_PROCESSED")).toBeInTheDocument();
    expect(within(active).getByText("市立医院")).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: tZh("death_sync.webhooks.disable") })).toBeInTheDocument();
    expect(within(disabled).getByText(tZh("death_sync.webhooks.status.DISABLED"))).toBeInTheDocument();
    expect(within(disabled).getByText(tZh("death_sync.webhooks.all_events"))).toBeInTheDocument();
    expect(within(disabled).queryByRole("button", { name: tZh("death_sync.webhooks.disable") })).toBeNull();
    expect(within(disabled).getByRole("button", { name: tZh("death_sync.webhooks.enable") })).toBeInTheDocument();
    expect(deathSyncApi.webhooks).toHaveBeenCalledWith({ page: "1" });
  });
});

describe("create: the checklist comes from the server and the secret is shown once", () => {
  it("POSTs url, key and the ticked events; shows _signing_secret in the dialog the 201 opens, and nowhere after", async () => {
    deathSyncApi.createWebhook.mockResolvedValue({ data: hook({ id: "w3", url: "https://hooks.example.org/new", _signing_secret: SECRET }) });
    renderRoute();
    await screen.findByText("https://hooks.example.org/a");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.webhooks.create") }));
    const form = await screen.findByRole("dialog");
    // The checklist is the server's enum, rendered by wire name.
    for (const ev of EVENT_TYPES) await within(form).findByLabelText(ev);
    expect(deathSyncApi.webhookEventTypes).toHaveBeenCalled();
    // Exactly the server's list — a copy of the enum in the client would show more.
    expect(within(form).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).labels?.[0]?.textContent?.trim())).toEqual(EVENT_TYPES);
    // Only active keys are offered.
    const select = within(form).getByLabelText(tZh("death_sync.webhooks.api_key")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["k1"]);

    fireEvent.change(within(form).getByLabelText(new RegExp(tZh("death_sync.webhooks.url"))), { target: { value: " https://hooks.example.org/new " } });
    fireEvent.click(within(form).getByLabelText("SOUL_CREATED"));
    fireEvent.click(within(form).getByLabelText("SCHEDULER_RUN_FAILED"));
    fireEvent.click(within(form).getByLabelText("SOUL_CREATED")); // untick again
    fireEvent.click(within(form).getByRole("button", { name: tZh("common.create") }));

    await waitFor(() =>
      expect(deathSyncApi.createWebhook).toHaveBeenCalledWith({
        url: "https://hooks.example.org/new",
        api_key: "k1",
        events: ["SCHEDULER_RUN_FAILED"],
      })
    );
    const shown = await screen.findByTestId("revealed-webhook-secret");
    expect(shown).toHaveTextContent(SECRET);
    expect(screen.getByRole("alert")).toHaveTextContent(tZh("death_sync.webhooks.shown_warning"));

    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.api_keys.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
    expect(deathSyncApi.webhooks.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a non-http(s) URL cannot be submitted, and a refused create stays in the form with no secret", async () => {
    deathSyncApi.createWebhook.mockRejectedValue(new Error("HTTP 400"));
    renderRoute();
    await screen.findByText("https://hooks.example.org/a");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.webhooks.create") }));
    const form = await screen.findByRole("dialog");
    await within(form).findByLabelText(tZh("death_sync.webhooks.api_key"));
    const urlField = within(form).getByLabelText(new RegExp(tZh("death_sync.webhooks.url")));
    fireEvent.change(urlField, { target: { value: "ftp://hooks.example.org/x" } });
    expect(within(form).getByRole("button", { name: tZh("common.create") })).toBeDisabled();
    fireEvent.change(urlField, { target: { value: "http://hooks.example.org/x" } });
    fireEvent.click(within(form).getByRole("button", { name: tZh("common.create") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("death_sync.webhooks.save_failed"), "error"));
    expect(screen.queryByTestId("revealed-webhook-secret")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("edit and disable", () => {
  it("edit PATCHes url and events for that row, without an api_key", async () => {
    deathSyncApi.updateWebhook.mockResolvedValue({ data: hook({ url: "https://hooks.example.org/b" }) });
    renderRoute();
    await screen.findByText("https://hooks.example.org/a");
    const row = screen.getAllByRole("row").find((r) => within(r).queryByText("https://hooks.example.org/a"))!;
    fireEvent.click(within(row).getByRole("button", { name: tZh("common.edit") }));
    const form = await screen.findByRole("dialog");
    expect(within(form).queryByLabelText(tZh("death_sync.webhooks.api_key"))).toBeNull();
    expect(deathSyncApi.apiKeys).not.toHaveBeenCalled();
    expect((await within(form).findByLabelText("DEATH_SYNC_PROCESSED")) as HTMLInputElement).toBeChecked();
    fireEvent.change(within(form).getByLabelText(new RegExp(tZh("death_sync.webhooks.url"))), { target: { value: "https://hooks.example.org/b" } });
    fireEvent.click(within(form).getByLabelText("SOUL_CREATED"));
    fireEvent.click(within(form).getByRole("button", { name: tZh("common.save") }));
    await waitFor(() =>
      expect(deathSyncApi.updateWebhook).toHaveBeenCalledWith("w1", {
        url: "https://hooks.example.org/b",
        events: ["DEATH_SYNC_PROCESSED", "SOUL_CREATED"],
      })
    );
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("death_sync.webhooks.saved_ok"), "success"));
    expect(screen.queryByTestId("revealed-webhook-secret")).toBeNull();
  });

  it("disable confirms first, then PATCHes is_active=false for that webhook only", async () => {
    deathSyncApi.disableWebhook.mockResolvedValue({ data: hook({ is_active: false }) });
    renderRoute();
    await screen.findByText("https://hooks.example.org/a");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.webhooks.disable") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(tZh("death_sync.webhooks.disable_title", { url: "https://hooks.example.org/a" }));
    expect(deathSyncApi.disableWebhook).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("death_sync.webhooks.disable") }));
    await waitFor(() => expect(deathSyncApi.disableWebhook).toHaveBeenCalledWith("w1"));
    expect(deathSyncApi.disableWebhook).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("death_sync.webhooks.disabled_ok"), "success"));
  });

  it("enable on a disabled row PATCHes is_active=true without a dialog", async () => {
    deathSyncApi.updateWebhook.mockResolvedValue({ data: hook({ id: "w2", is_active: true }) });
    renderRoute();
    await screen.findByText("https://hooks.example.org/old");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.webhooks.enable") }));
    await waitFor(() => expect(deathSyncApi.updateWebhook).toHaveBeenCalledWith("w2", { is_active: true }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("deliveries", () => {
  it("renders status, attempts, response and error; narrows to one webhook and back", async () => {
    renderRoute();
    await screen.findByText("RuntimeError: HTTP 502");
    expect(deathSyncApi.webhookDeliveries).toHaveBeenCalledWith({ page: "1" });
    const rows = screen.getAllByRole("row");
    const failed = rows.find((r) => within(r).queryByText("RuntimeError: HTTP 502"))!;
    expect(within(failed).getByText(tZh("death_sync.webhooks.delivery.status.FAILED"))).toBeInTheDocument();
    expect(within(failed).getByText("3")).toBeInTheDocument();
    expect(within(failed).getByText("502")).toBeInTheDocument();
    expect(within(failed).getByText("dt(2026-10-08T02:00:00Z)")).toBeInTheDocument();
    const ok = rows.find((r) => within(r).queryByText("https://hooks.example.org/old") && within(r).queryByText("200"))!;
    expect(within(ok).getByText(tZh("death_sync.webhooks.delivery.status.SUCCESS"))).toBeInTheDocument();

    // Narrow to w1.
    deathSyncApi.webhookDeliveries.mockResolvedValue(page([delivery()]));
    const hookRow = screen.getAllByRole("row").find((r) => within(r).queryByText("市立医院"))!;
    fireEvent.click(within(hookRow).getByRole("button", { name: tZh("death_sync.webhooks.deliveries") }));
    await waitFor(() => expect(deathSyncApi.webhookDeliveries).toHaveBeenCalledWith({ page: "1", webhook: "w1" }));
    await screen.findByText(tZh("death_sync.webhooks.deliveries_for", { url: "https://hooks.example.org/a" }));
    await waitFor(() => expect(screen.queryByText("200")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.webhooks.all_deliveries") }));
    await screen.findByText(tZh("death_sync.webhooks.deliveries"), { selector: "h2, h3" });
    expect(deathSyncApi.webhookDeliveries).toHaveBeenLastCalledWith({ page: "1" });
  });
});
