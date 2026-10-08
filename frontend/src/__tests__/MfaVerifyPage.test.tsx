/**
 * `/login/verify` (A12 登录第二步): the pending token comes from sessionStorage and the page
 * sends the operator back to /login without one; the five states (wrong with tries left,
 * expired, locked with the input and button disabled, network with a retry, a dead pending
 * token); the recovery-code mode; and success storing the tokens through the platform ports,
 * clearing the hand-over and honouring 「不再询问」.
 *
 * Written 2026-10-09 and NOT run (user instruction: write, don't run).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginVerifyPage from "@/app/(auth)/login/verify/page";
import { mfaApi } from "@soulledger/core/api";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { MFA_PENDING_KEY, readMfaPending, storeMfaPending } from "@/src/lib/mfaPending";

jest.mock("@soulledger/core/api", () => ({
  mfaApi: { verify: jest.fn() },
  authApi: { preferences: jest.fn() },
}));
jest.mock("@soulledger/core/platform", () => ({ setAccessToken: jest.fn(), setRefreshToken: jest.fn() }));
jest.mock("@/src/lib/defaultView", () => ({ defaultViewRoute: jest.fn().mockResolvedValue("/dashboard") }));

const mockShowToast = jest.fn();
const mockSetUser = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ setUser: mockSetUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: jest.requireActual("@/src/contexts/I18nContext").LOCALE_LABELS,
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}(${Object.values(params).join(",")})` : key,
    formatDate: (d: Date) => `T${d.getTime()}`,
    locale: "zh-Hans",
    hydrated: true,
    setLocale: jest.fn(),
  }),
}));

const verify = mfaApi.verify as jest.Mock;
const PENDING = { pending_token: "pending.jwt", username: "yama" };
const TOKENS = { access: "a", refresh: "r", user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: [], mfa_enabled: true, mfa_required: true } };

const location = { replace: jest.fn(), assign: jest.fn(), href: "" };
beforeAll(() => {
  Object.defineProperty(window, "location", { value: location, writable: true });
});
beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  storeMfaPending(PENDING);
});

const codeInput = () => screen.getByLabelText(/mfa\.verify\.code_label/) as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: /mfa\.verify\.(submit|submitting)/ });
const refusal = (status: number, data: Record<string, unknown>) => Promise.reject({ response: { status, data } });

describe("LoginVerifyPage", () => {
  it("goes back to /login when there is no pending hand-over", () => {
    sessionStorage.clear();
    render(<LoginVerifyPage />);
    expect(location.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByTestId("mfa-verify-form")).toBeNull();
  });

  it("shows the account in the subtitle and the 换个账号 way back", () => {
    render(<LoginVerifyPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("mfa.verify.title");
    expect(screen.getByText("mfa.verify.subtitle(yama)")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /mfa\.verify\.back/ }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("login-statute")).toBeTruthy(); // the A9 left column is kept on wide screens
  });

  it("auto-submits at six digits and lands the tokens through the ports", async () => {
    verify.mockResolvedValueOnce({ data: TOKENS });
    render(<LoginVerifyPage />);
    fireEvent.change(codeInput(), { target: { value: "123456" } });
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(verify).toHaveBeenCalledWith({ pending_token: "pending.jwt", code: "123456", remember_device: false });
    await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith("a"));
    expect(setRefreshToken).toHaveBeenCalledWith("r");
    expect(mockSetUser).toHaveBeenCalledWith(TOKENS.user);
    expect(readMfaPending()).toBeNull();
    expect(sessionStorage.getItem(MFA_PENDING_KEY)).toBeNull();
    await waitFor(() => expect(location.href).toBe("/dashboard"));
  });

  it("sends remember_device when the 30-day box is ticked", async () => {
    verify.mockResolvedValueOnce({ data: TOKENS });
    render(<LoginVerifyPage />);
    fireEvent.click(screen.getByLabelText(/mfa\.verify\.remember_device\(30\)/));
    fireEvent.change(codeInput(), { target: { value: "123456" } });
    await waitFor(() => expect(verify).toHaveBeenCalledWith(expect.objectContaining({ remember_device: true })));
  });

  it("wrong: ! danger alert with the tries left, input cleared and refocused", async () => {
    verify.mockImplementationOnce(() => refusal(400, { code: "wrong", remaining_attempts: 3, lock_minutes: 15 }));
    render(<LoginVerifyPage />);
    fireEvent.change(codeInput(), { target: { value: "000000" } });
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("wrong");
    expect(alert.textContent).toContain("mfa.verify.error_wrong");
    expect(alert.textContent).toContain("mfa.verify.error_wrong_body(3,15)");
    expect(codeInput().value).toBe("");
    expect(codeInput().disabled).toBe(false);
    expect(codeInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("expired: ◐ warning, told apart from wrong", async () => {
    verify.mockImplementationOnce(() => refusal(400, { code: "expired" }));
    render(<LoginVerifyPage />);
    fireEvent.change(codeInput(), { target: { value: "000000" } });
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("expired");
    expect(alert.textContent).toContain("mfa.verify.error_expired");
    expect(alert.textContent).not.toContain("error_wrong");
  });

  it("locked: ◐ warning with the time, input and button disabled until it lapses", async () => {
    jest.useFakeTimers();
    try {
      verify.mockImplementationOnce(() => refusal(429, { code: "locked", retry_after: 2 }));
      render(<LoginVerifyPage />);
      fireEvent.change(codeInput(), { target: { value: "000000" } });
      const alert = await screen.findByRole("alert");
      expect(alert.getAttribute("data-kind")).toBe("locked");
      expect(alert.textContent).toContain("mfa.verify.error_locked");
      expect(codeInput().disabled).toBe(true);
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(2100);
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(codeInput().disabled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("network: ! danger with a 重试 that resends the same code", async () => {
    verify.mockImplementationOnce(() => Promise.reject({}));
    verify.mockResolvedValueOnce({ data: TOKENS });
    render(<LoginVerifyPage />);
    fireEvent.change(codeInput(), { target: { value: "123456" } });
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("network");
    expect(codeInput().value).toBe("123456");
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ code: "123456" }));
  });

  it("a dead pending token clears the hand-over and says to sign in again", async () => {
    verify.mockImplementationOnce(() => refusal(401, { code: "pending_invalid" }));
    render(<LoginVerifyPage />);
    fireEvent.change(codeInput(), { target: { value: "123456" } });
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("pending");
    expect(readMfaPending()).toBeNull();
    expect(codeInput().disabled).toBe(true);
  });

  it("recovery mode: different title, 8-char case-insensitive input, no auto-submit, sends recovery_code", async () => {
    verify.mockResolvedValueOnce({ data: TOKENS });
    render(<LoginVerifyPage />);
    fireEvent.click(screen.getByRole("button", { name: "mfa.verify.use_recovery" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("mfa.verify.recovery_title");
    expect(screen.getByTestId("mfa-verify-form").getAttribute("data-mode")).toBe("recovery");
    const input = screen.getByLabelText(/mfa\.verify\.recovery_label/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCD-EFGH" } });
    expect(input.value).toBe("abcdefgh");
    expect(verify).not.toHaveBeenCalled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(verify).toHaveBeenCalledWith({ pending_token: "pending.jwt", recovery_code: "abcdefgh", remember_device: false }));
    // and the way back to the authenticator code
    expect(screen.getByRole("button", { name: "mfa.verify.use_totp" })).toBeTruthy();
  });
});
