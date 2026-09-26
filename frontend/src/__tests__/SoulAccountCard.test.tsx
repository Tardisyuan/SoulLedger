/**
 * src/components/soul-accounts/SoulAccountCard.tsx — the 灵魂账号 card on a
 * soul's detail page: this life's account, the chain, provision and reset.
 *
 * Permissions run for real (stubbed `useTenant` only). Every manage-gated
 * control is asserted absent without `soul_account.manage` and present with it.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SoulAccountCard } from "@/src/components/soul-accounts/SoulAccountCard";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  soulAccountsApi: { accounts: jest.fn(), provision: jest.fn(), resetCredential: jest.fn() },
}));
const { soulAccountsApi } = jest.requireMock("@soulledger/core/api") as {
  soulAccountsApi: Record<"accounts" | "provision" | "resetCredential", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, formatDateTime: (v: string) => `dt(${v})`, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const FUTURE = "2999-01-01T00:00:00Z";

function account(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    soul: "s1",
    soul_code: "ABCDEFGH23",
    soul_name: "张三",
    cycle: 1,
    previous_account: "a0",
    origin: "DEATH_SYNC",
    username: "soul.ABCDEFGH23.1",
    must_change_password: true,
    initial_password_expires_at: FUTURE,
    retired_at: null,
    created_at: "2026-09-17T00:00:00Z",
    last_login: null,
    contact_email_masked: "z***@example.com",
    contact_phone_masked: "",
    email_not_synced: null,
    ...over,
  };
}
const PAST_LIFE = account({ id: "a0", cycle: 0, previous_account: null, origin: "BACKFILL", retired_at: "2026-01-01T00:00:00Z", must_change_password: false, initial_password_expires_at: null });

const soul = (over: Record<string, unknown> = {}) =>
  ({ id: "s1", name: "张三", civilization: "CHINESE", current_state: "DISPOSED", life_index: 1, ...over }) as never;

const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderCard(s = soul()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<SoulAccountCard soul={s} />, { wrapper: Wrapper });
}

const asRole = (...permissions: string[]) => (mockUser = { id: 2, username: "op", role: "GUARDIAN", permissions });

beforeEach(() => {
  jest.clearAllMocks();
  soulAccountsApi.accounts.mockResolvedValue(page([PAST_LIFE, account()]));
});

it("shows this life's account and the chain, asked for this soul only", async () => {
  asRole("soul_account.read");
  renderCard();
  const current = await screen.findByTestId("current-soul-account");
  expect(soulAccountsApi.accounts).toHaveBeenCalledWith({ soul: "s1" });
  expect(within(current).getByText(tZh("soul_accounts.life", { n: "2" }))).toBeInTheDocument();
  expect(within(current).getByText(tZh("soul_accounts.account.must_change"))).toBeInTheDocument();
  expect(within(current).getByText("z***@example.com")).toBeInTheDocument();
  expect(within(current).getByText(tZh("soul_accounts.origin.DEATH_SYNC"))).toBeInTheDocument();
  const chain = screen.getByTestId("soul-account-chain");
  expect(within(chain).getAllByRole("listitem")).toHaveLength(2);
  expect(within(chain).getByText(tZh("soul_accounts.account.retired"))).toBeInTheDocument();
});

it("an expired initial password is flagged", async () => {
  asRole("soul_account.read");
  soulAccountsApi.accounts.mockResolvedValue(page([account({ initial_password_expires_at: "2000-01-01T00:00:00Z" })]));
  renderCard();
  expect(await screen.findByText(tZh("soul_accounts.account.initial_expired"))).toBeInTheDocument();
});

describe("manage controls", () => {
  it("without soul_account.manage: no reset, no provision", async () => {
    asRole("soul_account.read");
    soulAccountsApi.accounts.mockResolvedValue(page([PAST_LIFE]));
    renderCard();
    await screen.findByText(tZh("soul_accounts.account.none"));
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.account.actions.provision") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.account.actions.reset") })).toBeNull();
  });

  it("with manage: reset on a current account, and no provision while this life has one", async () => {
    asRole("soul_account.read", "soul_account.manage");
    renderCard();
    expect(await screen.findByRole("button", { name: tZh("soul_accounts.account.actions.reset") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.account.actions.provision") })).toBeNull();
  });

  it("with manage: provision when this life has no account, but never for a living soul", async () => {
    asRole("soul_account.read", "soul_account.manage");
    soulAccountsApi.accounts.mockResolvedValue(page([PAST_LIFE]));
    const { unmount } = renderCard();
    expect(await screen.findByRole("button", { name: tZh("soul_accounts.account.actions.provision") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.account.actions.reset") })).toBeNull();
    unmount();

    renderCard(soul({ current_state: "ALIVE" }));
    expect(await screen.findByText(tZh("soul_accounts.account.alive_no_account"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: tZh("soul_accounts.account.actions.provision") })).toBeNull();
  });
});

describe("provision and reset", () => {
  it("reset sends no blank contact (a blank would clear the one on file) and reports where the password went", async () => {
    asRole("soul_account.read", "soul_account.manage");
    soulAccountsApi.resetCredential.mockResolvedValue({ data: { id: "c9", status: "PENDING" } });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.account.actions.reset") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tZh("soul_accounts.account.contact_phone")), { target: { value: "+8613800000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.account.actions.reset") }));
    await waitFor(() => expect(soulAccountsApi.resetCredential).toHaveBeenCalledWith("a1", { contact_phone: "+8613800000000" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.account.reset_pending"), "success"));
  });

  it("a 400 on a contact lands next to that field and does not close the dialog", async () => {
    asRole("soul_account.read", "soul_account.manage");
    soulAccountsApi.accounts.mockResolvedValue(page([PAST_LIFE]));
    soulAccountsApi.provision.mockRejectedValue(http(400, { contact_email: ["请输入合法的邮件地址。"] }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.account.actions.provision") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tZh("soul_accounts.account.contact_email")), { target: { value: "nope" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.account.actions.provision") }));
    expect(await within(dialog).findByText("请输入合法的邮件地址。")).toBeInTheDocument();
    expect(soulAccountsApi.provision).toHaveBeenCalledWith("s1", { contact_email: "nope" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("provision on a life that already had an account (200) says no password was re-sent", async () => {
    asRole("soul_account.read", "soul_account.manage");
    soulAccountsApi.accounts.mockResolvedValue(page([PAST_LIFE]));
    soulAccountsApi.provision.mockResolvedValue({ status: 200, data: account() });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.account.actions.provision") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.account.actions.provision") }));
    await waitFor(() => expect(soulAccountsApi.provision).toHaveBeenCalledWith("s1", {}));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.account.provision_existing"), "info"));
  });

  it("a retired account (409) is reported by its code", async () => {
    asRole("soul_account.read", "soul_account.manage");
    soulAccountsApi.resetCredential.mockRejectedValue(http(409, { detail: "x", code: "account_retired" }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: tZh("soul_accounts.account.actions.reset") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("soul_accounts.account.actions.reset") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("soul_accounts.account.retired_cannot_reset"), "error"));
  });
});

it("one soul's chain never shows on another soul's card (keys are per soul)", async () => {
  asRole("soul_account.read");
  soulAccountsApi.accounts.mockImplementation(({ soul: id }: { soul: string }) =>
    Promise.resolve(page(id === "s1" ? [account()] : [account({ id: "b1", soul: "s2", soul_code: "ZZZZZZZZ99", soul_name: "李四", cycle: 0 })]))
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { rerender } = render(<SoulAccountCard soul={soul()} />, { wrapper: Wrapper });
  expect(await screen.findByText("ABCDEFGH23")).toBeInTheDocument();
  rerender(<SoulAccountCard soul={soul({ id: "s2", name: "李四", life_index: 0 })} />);
  expect(await screen.findByText("ZZZZZZZZ99")).toBeInTheDocument();
  expect(screen.queryByText("ABCDEFGH23")).toBeNull();
});

it("loading failure shows a retry, not 'no account'", async () => {
  asRole("soul_account.read");
  soulAccountsApi.accounts.mockRejectedValue(http(500));
  renderCard();
  expect(await screen.findByRole("button", { name: tZh("error.retry") })).toBeInTheDocument();
  expect(screen.queryByText(tZh("soul_accounts.account.none"))).toBeNull();
});

it("an unknown origin renders as unrecognized with the raw member in title", async () => {
  asRole("soul_account.read");
  soulAccountsApi.accounts.mockResolvedValue(page([account({ origin: "TELEPORTED" })]));
  renderCard();
  const [first] = await screen.findAllByTitle("TELEPORTED");
  expect(first).toHaveTextContent(tZh("common.value.unrecognized"));
  expect(screen.queryByText("TELEPORTED")).toBeNull();
});
