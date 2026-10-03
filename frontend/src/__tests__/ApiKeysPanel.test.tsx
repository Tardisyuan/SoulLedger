/**
 * /death-sync/api-keys — Death-Sync API keys, through the real route file with
 * the real zh-Hans bundle.
 *
 * Three things are asserted that a green render would not cover on its own:
 * the non-ADMIN half must not merely see "denied" but issue no request and see
 * no tab; the plaintext key must appear exactly once — in the dialog the 201
 * opens — and be gone from the document when that dialog closes, with the list
 * refetch carrying only the prefix; and the revoke control is absent on a
 * revoked row, not disabled.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ApiKeysRoute from "@/app/death-sync/api-keys/page";
import DeathSyncPage from "@/app/death-sync/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  deathSyncApi: {
    registrations: jest.fn(),
    summary: jest.fn(),
    apiKeys: jest.fn(),
    createApiKey: jest.fn(),
    revokeApiKey: jest.fn(),
  },
}));
const { deathSyncApi } = jest.requireMock("@soulledger/core/api") as {
  deathSyncApi: Record<"registrations" | "summary" | "apiKeys" | "createApiKey" | "revokeApiKey", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

let mockPath = "/death-sync/api-keys";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const SECRET = "sk_live_one_time_SECRET_9f3a";

function key(over: Record<string, unknown> = {}) {
  return {
    id: "k1",
    name: "市立医院",
    system_type: "HOSPITAL",
    key_prefix: "sk_abcd1",
    is_active: true,
    expires_at: null,
    rate_limit_per_minute: 60,
    rate_limit_per_hour: 1000,
    allowed_ips: [],
    can_register_death: true,
    can_query_status: true,
    can_manage_webhooks: false,
    last_used_at: null,
    usage_count: 3,
    ...over,
  };
}
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });

function renderRoute(ui: ReactNode = <ApiKeysRoute />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = "/death-sync/api-keys";
  mockUser = { id: 1, username: "yama", role: "ADMIN", permissions: [] };
  deathSyncApi.apiKeys.mockResolvedValue(page([key(), key({ id: "k2", name: "旧钥", is_active: false })]));
  deathSyncApi.registrations.mockResolvedValue(page([]));
  deathSyncApi.summary.mockResolvedValue({ data: { anomaly_status: "FAILED", anomaly_count: 0 } });
});

describe("access", () => {
  it("non-ADMIN: denied, no request, and no keys tab on /death-sync", async () => {
    mockUser = { id: 2, username: "judge", role: "JUDGE", permissions: ["audit.read"] };
    const denied = renderRoute();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(deathSyncApi.apiKeys).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: tZh("death_sync.tabs.api_keys") })).toBeNull();
    denied.unmount();

    mockPath = "/death-sync";
    renderRoute(<DeathSyncPage />);
    await waitFor(() => expect(deathSyncApi.registrations).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.registrations") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: tZh("death_sync.tabs.api_keys") })).toBeNull();
  });

  it("ADMIN: both tabs, the rows, revoke only on an active key", async () => {
    renderRoute();
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.api_keys") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: tZh("death_sync.tabs.registrations") })).toBeInTheDocument();
    await screen.findByText("市立医院");
    const rows = screen.getAllByRole("row");
    const active = rows.find((r) => within(r).queryByText("市立医院"))!;
    const revoked = rows.find((r) => within(r).queryByText("旧钥"))!;
    expect(within(active).getByText(tZh("death_sync.api_keys.status.ACTIVE"))).toBeInTheDocument();
    expect(within(active).getByText(tZh("death_sync.api_keys.system_type.HOSPITAL"))).toBeInTheDocument();
    expect(within(active).getByText(/sk_abcd1/)).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: tZh("death_sync.api_keys.revoke") })).toBeInTheDocument();
    expect(within(revoked).getByText(tZh("death_sync.api_keys.status.REVOKED"))).toBeInTheDocument();
    expect(within(revoked).queryByRole("button", { name: tZh("death_sync.api_keys.revoke") })).toBeNull();
    expect(deathSyncApi.apiKeys).toHaveBeenCalledWith({ page: "1" });
  });
});

describe("create: the key is shown once", () => {
  it("shows _raw_key in the dialog the 201 opens, and nowhere after it closes", async () => {
    deathSyncApi.createApiKey.mockResolvedValue({ data: key({ id: "k3", name: "新钥", _raw_key: SECRET }) });
    renderRoute();
    await screen.findByText("市立医院");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.api_keys.create") }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(new RegExp(tZh("death_sync.api_keys.name"))), { target: { value: " 新钥 " } });
    fireEvent.change(within(form).getByLabelText(tZh("death_sync.api_keys.system_type_label")), { target: { value: "GOVERNMENT" } });
    fireEvent.click(within(form).getByLabelText(tZh("death_sync.api_keys.can_manage_webhooks")));
    // The list refetch after a create must carry the prefix only.
    deathSyncApi.apiKeys.mockResolvedValue(page([key(), key({ id: "k3", name: "新钥", key_prefix: "sk_live_" })]));
    fireEvent.click(within(form).getByRole("button", { name: tZh("common.create") }));

    await waitFor(() =>
      expect(deathSyncApi.createApiKey).toHaveBeenCalledWith({
        name: "新钥",
        system_type: "GOVERNMENT",
        can_register_death: true,
        can_query_status: true,
        can_manage_webhooks: true,
      })
    );
    const shown = await screen.findByTestId("revealed-api-key");
    expect(shown).toHaveTextContent(SECRET);
    expect(screen.getByRole("alert")).toHaveTextContent(tZh("death_sync.api_keys.shown_warning"));

    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.api_keys.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByText("新钥");
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(deathSyncApi.apiKeys.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a refused create stays in the form and shows no key", async () => {
    deathSyncApi.createApiKey.mockRejectedValue(new Error("HTTP 400"));
    renderRoute();
    await screen.findByText("市立医院");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.api_keys.create") }));
    const form = await screen.findByRole("dialog");
    fireEvent.change(within(form).getByLabelText(new RegExp(tZh("death_sync.api_keys.name"))), { target: { value: "x" } });
    fireEvent.click(within(form).getByRole("button", { name: tZh("common.create") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("death_sync.api_keys.create_failed"), "error"));
    expect(screen.queryByTestId("revealed-api-key")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("revoke", () => {
  it("confirms, then PATCHes is_active=false for that key only", async () => {
    deathSyncApi.revokeApiKey.mockResolvedValue({ data: key({ is_active: false }) });
    renderRoute();
    await screen.findByText("市立医院");
    fireEvent.click(screen.getByRole("button", { name: tZh("death_sync.api_keys.revoke") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(tZh("death_sync.api_keys.revoke_title", { name: "市立医院" }));
    expect(deathSyncApi.revokeApiKey).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("death_sync.api_keys.revoke") }));
    await waitFor(() => expect(deathSyncApi.revokeApiKey).toHaveBeenCalledWith("k1"));
    expect(deathSyncApi.revokeApiKey).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("death_sync.api_keys.revoked_ok"), "success"));
  });
});
