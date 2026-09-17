/**
 * app/soul-credentials/page.tsx — the pending-delivery list and the
 * one-time password reveal.
 *
 * `RequirePermission` / `usePermissions` run for real against a stubbed
 * `useTenant` (see SchedulerPage.test.tsx for why). Copy is the real zh-Hans
 * bundle, so a key the page asks for that the bundle lacks shows up as a miss.
 *
 * The reveal tests assert ABSENCE as much as presence: the plaintext must not
 * be in the query cache, the mutation cache, local/session storage, or the
 * document once the dialog is closed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulCredentialsPage from "@/app/soul-credentials/page";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  soulAccountsApi: {
    credentials: jest.fn(),
    revealCredential: jest.fn(),
    markDelivered: jest.fn(),
    retry: jest.fn(),
  },
}));
const { soulAccountsApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"credentials" | "revealCredential" | "markDelivered" | "retry", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const mockI18n = {
  t: tZh,
  formatDateTime: (v: string) => `dt(${v})`,
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const SECRET = "Zq7-one-time-SECRET";
const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

function credential(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    account: "a1",
    soul: "s1",
    soul_code: "ABCDEFGH23",
    soul_name: "张三",
    cycle: 0,
    channel: "",
    status: "PENDING",
    expires_at: FUTURE,
    attempts: 0,
    last_error: "",
    created_at: "2026-09-17T00:00:00Z",
    sent_at: null,
    revealed_at: null,
    revealed_by: null,
    delivered_at: null,
    delivered_by: null,
    ...over,
  };
}

const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<SoulCredentialsPage />, { wrapper: Wrapper });
}

const asRole = (...permissions: string[]) => (mockUser = { id: 2, username: "op", role: "GUARDIAN", permissions });
const asManager = () => asRole("soul_account.read", "soul_account.manage");

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  soulAccountsApi.credentials.mockResolvedValue(page([credential()]));
});

describe("access", () => {
  it("refuses the page without soul_account.read and asks the API nothing", () => {
    asRole("soul.read");
    renderPage();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(soulAccountsApi.credentials).not.toHaveBeenCalled();
  });

  it("read-only: the rows, but no reveal, retry, deliver or reset control", async () => {
    asRole("soul_account.read");
    soulAccountsApi.credentials.mockResolvedValue(
      page([credential(), credential({ id: "c2", status: "REVEALED" }), credential({ id: "c3", status: "VOID", expires_at: PAST })])
    );
    renderPage();
    await screen.findAllByText("张三");
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") })).toBeNull();
    expect(screen.queryByRole("link", { name: tZh("soul_accounts.credentials.actions.go_reset") })).toBeNull();
    expect(screen.getByText(new RegExp(tZh("soul_accounts.credentials.manage_hint").replace(/\./g, "\\.")))).toBeInTheDocument();
  });

  it("manage: each control on the row whose status allows it, and only there", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(
      page([credential(), credential({ id: "c2", status: "REVEALED" }), credential({ id: "c3", status: "VOID", expires_at: PAST })])
    );
    const { container } = renderPage();
    await screen.findAllByText("张三");
    const row = (id: string) => within(container.querySelector(`[data-credential-id="${id}"]`) as HTMLElement);
    expect(row("c1").getByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeInTheDocument();
    expect(row("c1").getByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") })).toBeInTheDocument();
    expect(row("c1").queryByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") })).toBeNull();
    expect(row("c2").getByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") })).toBeInTheDocument();
    expect(row("c2").queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
    // The expired row: a status, the reason, and the way out — never a reveal.
    expect(row("c3").getByText(tZh("soul_accounts.credentials.reason.expired"))).toBeInTheDocument();
    expect(row("c3").getByRole("link", { name: tZh("soul_accounts.credentials.actions.go_reset") })).toHaveAttribute(
      "href",
      "/souls/s1#soul-account"
    );
    expect(row("c3").queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
  });
});

describe("reveal: once, and gone when the dialog closes", () => {
  async function openConfirm() {
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") }));
    return screen.findByRole("dialog");
  }

  it("confirms first and says it is one time only; nothing is requested before the confirm", async () => {
    asManager();
    renderPage();
    const dialog = await openConfirm();
    expect(within(dialog).getByText(/只能查看一次/)).toBeInTheDocument();
    expect(soulAccountsApi.revealCredential).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(soulAccountsApi.revealCredential).not.toHaveBeenCalled();
  });

  it("shows the plaintext once, keeps it out of every cache and store, and cannot show it again after closing", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockResolvedValue({ data: { soul_code: "ABCDEFGH23", password: SECRET, expires_at: FUTURE } });
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    expect(await screen.findByTestId("revealed-password")).toHaveTextContent(SECRET);
    expect(soulAccountsApi.revealCredential).toHaveBeenCalledTimes(1);
    expect(soulAccountsApi.revealCredential).toHaveBeenCalledWith("c1");

    // Not in any cache or store while it is on screen.
    const cached = JSON.stringify([
      client.getQueryCache().getAll().map((q) => q.state.data),
      client.getMutationCache().getAll().map((m) => m.state.data),
    ]);
    expect(cached).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.reveal.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(SECRET)).toBeNull();

    // Opening the same row again starts from the confirmation, not from the plaintext.
    await openConfirm();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByTestId("revealed-password")).toBeNull();
    expect(soulAccountsApi.revealCredential).toHaveBeenCalledTimes(1);
  });

  it("a second reveal (409) says it was already viewed and shows no password", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockRejectedValue(
      http(409, { detail: "明文已被查看过或已发送", code: "credential_not_revealable" })
    );
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.reveal.already_revealed"), "error"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("revealed-password")).toBeNull();
    // The list is asked again so the row shows its new status.
    await waitFor(() => expect(soulAccountsApi.credentials).toHaveBeenCalledTimes(2));
  });

  it("an expired credential (410) points at reset", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockRejectedValue(http(410, { detail: "过期", code: "credential_expired" }));
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.expired_go_reset"), "error")
    );
  });

  it("marks delivered straight from the shown password, then closes", async () => {
    asManager();
    soulAccountsApi.revealCredential.mockResolvedValue({ data: { soul_code: "ABCDEFGH23", password: SECRET, expires_at: FUTURE } });
    soulAccountsApi.markDelivered.mockResolvedValue({ data: credential({ status: "DELIVERED" }) });
    renderPage();
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.reveal.confirm") }));
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.reveal.deliver_and_close") }));
    await waitFor(() => expect(soulAccountsApi.markDelivered).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(SECRET)).toBeNull();
  });
});

describe("retry and deliver", () => {
  it("retry that went out says sent; one that did not says why", async () => {
    asManager();
    soulAccountsApi.retry.mockResolvedValueOnce({ data: credential({ status: "SENT", channel: "EMAIL" }) });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.retry_sent"), "success"));

    soulAccountsApi.retry.mockResolvedValueOnce({ data: credential({ status: "PENDING", last_error: "SMTPException", attempts: 2 }) });
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.retry") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        tZh("soul_accounts.credentials.reason.send_failed", { error: "SMTPException", attempts: "2" }),
        "info"
      )
    );
  });

  it("deliver refused (409) is reported by its code", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(page([credential({ status: "REVEALED" })]));
    soulAccountsApi.markDelivered.mockRejectedValue(http(409, { detail: "x", code: "credential_not_revealed" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.credentials.actions.mark_delivered") }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.credentials.deliver_not_revealed"), "error")
    );
  });
});

describe("loading, error, empty and filtered are different screens", () => {
  it("a failed request shows the error with a retry, not the empty state", async () => {
    asManager();
    soulAccountsApi.credentials.mockRejectedValue(http(500));
    renderPage();
    expect(await screen.findByRole("button", { name: tZh("error.retry") })).toBeInTheDocument();
    expect(screen.queryByText(tZh("soul_accounts.credentials.empty.pending"))).toBeNull();
  });

  it("nothing pending says so, and a filter with nothing says something else", async () => {
    asManager();
    soulAccountsApi.credentials.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText(tZh("soul_accounts.credentials.empty.pending"))).toBeInTheDocument();
    expect(soulAccountsApi.credentials).toHaveBeenLastCalledWith({ status: "PENDING", page: 1 });
    fireEvent.click(screen.getByRole("button", { name: tZh("soul_accounts.credentials.filters.DELIVERED") }));
    expect(await screen.findByText(tZh("soul_accounts.credentials.empty.filtered"))).toBeInTheDocument();
    expect(screen.queryByText(tZh("soul_accounts.credentials.empty.pending"))).toBeNull();
    expect(soulAccountsApi.credentials).toHaveBeenLastCalledWith({ status: "DELIVERED", page: 1 });
  });
});

it("an unknown status renders as unrecognized with the raw member in title", async () => {
  asManager();
  soulAccountsApi.credentials.mockResolvedValue(page([credential({ status: "LOST_IN_DUAT" })]));
  renderPage();
  const badge = await screen.findByTitle("LOST_IN_DUAT");
  expect(badge).toHaveTextContent(tZh("common.value.unrecognized"));
  expect(screen.queryByText("LOST_IN_DUAT")).toBeNull();
  // An unknown status offers no action at all.
  expect(screen.queryByRole("button", { name: tZh("soul_accounts.credentials.actions.reveal") })).toBeNull();
});
