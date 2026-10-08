/**
 * 个人中心「两步验证」(A12, `src/components/profile/MfaSection.tsx`): the off state (badge, the
 * explanation, the 开启 button, and the role-required note only when the role is required), the on
 * state (开启于 / 最近一次使用 / 恢复码剩几个 with 重新生成 / 关闭), the 关闭 dialog's danger button
 * gated on a code or password, and 完成 in the wizard flipping the cached user's `mfa_enabled`.
 *
 * Written 2026-10-09 and NOT run (user instruction: write, don't run).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mfaApi } from "@soulledger/core/api";
import { MfaSection } from "@/src/components/profile/MfaSection";

jest.mock("@soulledger/core/api", () => ({
  mfaApi: { status: jest.fn(), setup: jest.fn(), cancelSetup: jest.fn(), confirm: jest.fn(), complete: jest.fn(), regenerateRecoveryCodes: jest.fn(), disable: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    formatDateTime: (iso: string) => `D(${iso})`,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
const mockSetUser = jest.fn();
const mockUser = { id: 1, username: "yama", role: "JUDGE", tenant: null, permissions: [] as string[], mfa_enabled: false, mfa_required: false };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser, setUser: mockSetUser }) }));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const status = mfaApi.status as jest.Mock;
const disable = mfaApi.disable as jest.Mock;
const regenerate = mfaApi.regenerateRecoveryCodes as jest.Mock;

const OFF = { enabled: false, required: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 };
const ON = { enabled: true, required: true, confirmed_at: "2026-10-01T00:00:00Z", last_used_at: "2026-10-08T00:00:00Z", last_used_method: "recovery", recovery_codes_remaining: 7 };

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MfaSection />
    </QueryClientProvider>
  );
  return qc;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MfaSection — off", () => {
  it("shows ○ 未开启, the explanation and 开启; no required note when the role is not required", async () => {
    status.mockResolvedValue({ data: OFF });
    renderSection();
    const badge = await screen.findByTestId("mfa-badge");
    expect(badge.textContent).toContain("mfa.badge_off");
    expect(badge.textContent).toContain("○");
    expect(screen.getByText("mfa.manage.off_body")).toBeTruthy();
    expect(screen.getByRole("button", { name: "mfa.setup.open" })).toBeTruthy();
    expect(screen.queryByTestId("mfa-required-note")).toBeNull();
    expect(screen.queryByText("mfa.manage.enabled_at")).toBeNull();
  });

  it("names the role in the required note when the hall requires it", async () => {
    status.mockResolvedValue({ data: { ...OFF, required: true } });
    renderSection();
    const note = await screen.findByTestId("mfa-required-note");
    expect(note.textContent).toContain("mfa.manage.required_note(users.roles.JUDGE)");
  });

  it("开启 opens the wizard, and 完成 there flips the cached user to mfa_enabled", async () => {
    status.mockResolvedValue({ data: OFF });
    (mfaApi.setup as jest.Mock).mockResolvedValue({ data: { secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP" } });
    (mfaApi.confirm as jest.Mock).mockResolvedValue({ data: { recovery_codes: Array.from({ length: 10 }, (_, i) => `code-${i}`) } });
    (mfaApi.complete as jest.Mock).mockResolvedValue({ data: { ...ON } });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "mfa.setup.open" }));
    expect(await screen.findByTestId("mfa-wizard")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mfa.setup.next" }));
    await screen.findByTestId("mfa-manual-key");
    fireEvent.click(screen.getByRole("button", { name: "mfa.setup.next" }));
    fireEvent.change(screen.getByLabelText(/mfa\.verify\.code_label/), { target: { value: "123456" } });
    await screen.findByTestId("mfa-recovery-codes");
    fireEvent.click(screen.getByLabelText("mfa.setup.saved_check"));
    fireEvent.click(screen.getByTestId("mfa-finish"));
    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({ mfa_enabled: true })));
  });
});

describe("MfaSection — on", () => {
  it("shows ✓ 已开启 and the three rows with method, codes left, 重新生成 and 关闭", async () => {
    status.mockResolvedValue({ data: ON });
    renderSection();
    const badge = await screen.findByTestId("mfa-badge");
    expect(badge.textContent).toContain("mfa.badge_on");
    expect(badge.textContent).toContain("✓");
    expect(screen.getByText("D(2026-10-01T00:00:00Z)")).toBeTruthy();
    expect(screen.getByText("D(2026-10-08T00:00:00Z) · mfa.manage.method_recovery")).toBeTruthy();
    expect(screen.getByTestId("mfa-codes-left").textContent).toBe("mfa.manage.codes_left_value(7)");
    expect(screen.getByRole("button", { name: "mfa.manage.regenerate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "mfa.manage.disable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "mfa.setup.open" })).toBeNull();
  });

  it("重新生成 asks first (old codes voided), then shows the new set", async () => {
    status.mockResolvedValue({ data: ON });
    regenerate.mockResolvedValue({ data: { recovery_codes: Array.from({ length: 10 }, (_, i) => `new-${i}`) } });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "mfa.manage.regenerate" }));
    expect(regenerate).not.toHaveBeenCalled();
    expect(await screen.findByText("mfa.manage.regenerate_body")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "mfa.manage.regenerate" }).at(-1)!);
    await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("mfa-recovery-codes")).toBeTruthy();
    expect(screen.getByText("new-9")).toBeTruthy();
  });

  it("关闭: the danger button is disabled until a 6-digit code (or a password) is given, and sends the chosen method", async () => {
    status.mockResolvedValue({ data: ON });
    disable.mockResolvedValue({ data: OFF });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "mfa.manage.disable" }));
    const action = (await screen.findByTestId("mfa-disable-confirm")) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/mfa\.verify\.code_label/), { target: { value: "12345" } });
    expect(action.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/mfa\.verify\.code_label/), { target: { value: "123456" } });
    expect(action.disabled).toBe(false);
    // switch to the password segment: the code no longer counts
    fireEvent.click(screen.getByRole("radio", { name: "mfa.manage.confirm_by_password" }));
    expect((screen.getByTestId("mfa-disable-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/auth\.password/), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("mfa-disable-confirm"));
    await waitFor(() => expect(disable).toHaveBeenCalledWith({ method: "password", password: "pw" }));
    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({ mfa_enabled: false })));
  });

  it("a refused 关闭 stays open and says so", async () => {
    status.mockResolvedValue({ data: ON });
    disable.mockRejectedValue({ response: { status: 400, data: { code: "wrong" } } });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "mfa.manage.disable" }));
    fireEvent.change(await screen.findByLabelText(/mfa\.verify\.code_label/), { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("mfa-disable-confirm"));
    expect((await screen.findByRole("alert")).textContent).toContain("mfa.manage.disable_failed");
    expect(mockSetUser).not.toHaveBeenCalled();
  });
});
