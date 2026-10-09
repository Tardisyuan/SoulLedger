/**
 * The users list's 「两步验证」 column and the admin reset (A12): three states, each glyph + text
 * (✓ 已开启 + dates / ○ 未开启 · 角色不要求 / ! 要求开启 · 未开启); 「重置两步验证」 only on enabled
 * rows; the filter chip sends `mfa=`; and the reset dialog's danger button is gated on BOTH a
 * reason and the typed account id, then posts the reason.
 *
 * Written 2026-10-09 and NOT run (user instruction: write, don't run).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";
import { MfaResetDialog } from "@/src/components/users/MfaResetDialog";

jest.mock("@soulledger/core/api", () => ({
  usersApi: { list: jest.fn(), delete: jest.fn(), activate: jest.fn(), deactivate: jest.fn(), resetMfa: jest.fn() },
  permApi: { roles: { list: jest.fn() } },
  PAGE_SIZE: 20,
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    formatDate: (iso: string) => `D(${iso})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
const mockTenant = { user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] } };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => mockTenant }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const list = usersApi.list as jest.Mock;
const resetMfa = usersApi.resetMfa as jest.Mock;

const row = (id: number, username: string, mfa: { enabled: boolean; required: boolean; confirmed_at: string | null; last_used_at: string | null }) => ({
  id,
  username,
  email: `${username}@x`,
  role: "JUDGE",
  tenant: null,
  is_active: true,
  mfa,
});
const ROWS = [
  row(1, "on-user", { enabled: true, required: true, confirmed_at: "2026-10-01", last_used_at: "2026-10-08" }),
  row(2, "off-user", { enabled: false, required: false, confirmed_at: null, last_used_at: null }),
  row(3, "missing-user", { enabled: false, required: true, confirmed_at: null, last_used_at: null }),
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UsersPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (permApi.roles.list as jest.Mock).mockResolvedValue({ data: [] });
  list.mockResolvedValue({ data: { count: ROWS.length, results: ROWS } });
});

describe("UsersPage · 两步验证 column", () => {
  it("renders the three states with glyph + text, dates only on the enabled one", async () => {
    renderPage();
    const on = (await screen.findByText("on-user")).closest("tr")!;
    expect(within(on).getByText("mfa.admin.state_on")).toBeTruthy();
    expect(on.querySelector('[data-mfa="on"]')!.textContent).toContain("✓");
    expect(on.textContent).toContain("D(2026-10-01) · D(2026-10-08)");

    const off = screen.getByText("off-user").closest("tr")!;
    expect(within(off).getByText("mfa.admin.state_off")).toBeTruthy();
    expect(within(off).getByText("mfa.admin.state_off_note")).toBeTruthy();
    expect(off.querySelector('[data-mfa="off"]')!.textContent).toContain("○");

    const missing = screen.getByText("missing-user").closest("tr")!;
    expect(within(missing).getByText("mfa.admin.state_missing")).toBeTruthy();
    expect(missing.querySelector('[data-mfa="missing"]')!.textContent).toContain("!");
    expect(within(missing).queryByText("mfa.admin.state_off")).toBeNull();
  });

  it("offers 重置两步验证 on the enabled row only", async () => {
    renderPage();
    const on = (await screen.findByText("on-user")).closest("tr")!;
    expect(within(on).getByRole("button", { name: "mfa.admin.reset" })).toBeTruthy();
    for (const name of ["off-user", "missing-user"]) {
      expect(within(screen.getByText(name).closest("tr")!).queryByRole("button", { name: "mfa.admin.reset" })).toBeNull();
    }
  });

  it("the filter chip sends mfa= to the list", async () => {
    renderPage();
    await screen.findByText("on-user");
    const chip = screen.getByLabelText("mfa.admin.column") as HTMLSelectElement;
    fireEvent.change(chip, { target: { value: "missing" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ mfa: "missing", page: 1 })));
  });
});

describe("MfaResetDialog", () => {
  function renderDialog() {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const onClose = jest.fn();
    render(
      <QueryClientProvider client={qc}>
        <MfaResetDialog user={ROWS[0] as never} onClose={onClose} />
      </QueryClientProvider>
    );
    return onClose;
  }

  it("lists three consequences and keeps the danger button off until reason AND account id are given", async () => {
    renderDialog();
    expect(screen.getByText("mfa.admin.reset_consequence_1")).toBeTruthy();
    expect(screen.getByText("mfa.admin.reset_consequence_2")).toBeTruthy();
    expect(screen.getByText("mfa.admin.reset_consequence_3")).toBeTruthy();
    const action = screen.getByTestId("mfa-reset-action") as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/common\.type_name_to_confirm\(on-user\)/), { target: { value: "on-user" } });
    expect(action.disabled).toBe(true); // name alone is not enough
    fireEvent.change(screen.getByLabelText(/mfa\.admin\.reset_reason/), { target: { value: "手机丢了" } });
    expect(action.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/common\.type_name_to_confirm\(on-user\)/), { target: { value: "on-use" } });
    expect(action.disabled).toBe(true); // a near miss is a miss
  });

  it("posts the reason and closes", async () => {
    resetMfa.mockResolvedValue({ data: { detail: "ok" } });
    const onClose = renderDialog();
    fireEvent.change(screen.getByLabelText(/mfa\.admin\.reset_reason/), { target: { value: "  手机丢了 " } });
    fireEvent.change(screen.getByLabelText(/common\.type_name_to_confirm\(on-user\)/), { target: { value: "on-user" } });
    fireEvent.click(screen.getByTestId("mfa-reset-action"));
    await waitFor(() => expect(resetMfa).toHaveBeenCalledWith(1, "手机丢了"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
