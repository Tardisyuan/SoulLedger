/**
 * 官员「忘记密码」(邮箱重置链接)的四个页面落点,2026-10-09:
 * /forgot-password(申请 → 「已发送」)、/reset-password(链接里的令牌 → 新密码)、
 * /verify-email(链接落点),以及资料页的「邮箱验证」一行。
 *
 * 申请页对任何输入给同一句话(账号存在与否不可见),只按状态码分支;
 * 令牌读出来之后从地址栏抹掉;邮箱验证链接只用一次,严格模式下 effect 跑两遍也只发一个请求。
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import { EmailVerificationRow } from "@/src/components/profile/EmailVerificationRow";
import { authApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  authApi: {
    requestOfficerReset: jest.fn(),
    confirmOfficerReset: jest.fn(),
    verifyEmail: jest.fn(),
    sendEmailVerification: jest.fn(),
  },
}));

const mockShowToast = jest.fn();
jest.mock("@/src/components/ui/Toast", () => ({ showToast: (...args: unknown[]) => mockShowToast(...args) }));
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

const request = authApi.requestOfficerReset as jest.Mock;
const confirm = authApi.confirmOfficerReset as jest.Mock;
const verify = authApi.verifyEmail as jest.Mock;
const sendVerification = authApi.sendEmailVerification as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, "", "/");
});

describe("/forgot-password", () => {
  const ask = (who: string) => {
    fireEvent.change(screen.getByLabelText(/auth\.forgot_email_label/), { target: { value: who } });
    fireEvent.click(screen.getByRole("button", { name: "auth.forgot_email_submit" }));
  };

  it("sends the identifier and shows the one 'sent' sentence, whatever the 200 body says", async () => {
    const seen: string[] = [];
    for (const body of [{ detail: "a" }, { detail: "账号不存在" }, {}]) {
      request.mockResolvedValueOnce({ data: body });
      const view = render(<ForgotPasswordPage />);
      ask("yama");
      seen.push((await screen.findByTestId("officer-reset-sent")).textContent ?? "");
      view.unmount();
    }
    expect(request).toHaveBeenCalledWith("yama");
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain("auth.forgot_email_sent");
  });

  it("offers the admin-notification fallback before and after sending", async () => {
    request.mockResolvedValue({ data: {} });
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("link", { name: "auth.forgot_notify_admin" })).toHaveAttribute("href", "/login?help=1");
    ask("yama");
    await screen.findByTestId("officer-reset-sent");
    expect(screen.getByRole("link", { name: "auth.forgot_notify_admin" })).toHaveAttribute("href", "/login?help=1");
  });

  it("says 'too frequent' on a 429 and stays on the form", async () => {
    request.mockRejectedValue({ response: { status: 429 } });
    render(<ForgotPasswordPage />);
    ask("yama");
    expect(await screen.findByRole("alert")).toHaveTextContent("auth.rate_limited");
    expect(screen.getByTestId("officer-reset-form")).toBeInTheDocument();
  });

  it("does not submit an empty identifier", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("button", { name: "auth.forgot_email_submit" })).toBeDisabled();
  });
});

describe("/reset-password", () => {
  const open = (query: string) => {
    window.history.pushState({}, "", `/reset-password${query}`);
    return render(<ResetPasswordPage />);
  };
  const fill = (a: string, b: string) => {
    fireEvent.change(screen.getByLabelText(/profile\.new_password/), { target: { value: a } });
    fireEvent.change(screen.getByLabelText(/profile\.confirm_password/), { target: { value: b } });
    fireEvent.click(screen.getByRole("button", { name: "auth.reset_submit" }));
  };

  it("reads uid and token from the URL, wipes them from the address bar, and posts them", async () => {
    confirm.mockResolvedValue({ data: { detail: "ok" } });
    open("?uid=MQ&token=abc-123");
    expect(await screen.findByTestId("officer-reset-password-form")).toBeInTheDocument();
    expect(window.location.search).toBe("");

    fill("N0t-Guessable!2026", "N0t-Guessable!2026");

    await screen.findByTestId("officer-reset-done");
    expect(confirm).toHaveBeenCalledWith({ uid: "MQ", token: "abc-123", new_password: "N0t-Guessable!2026" });
  });

  it("without a token it is the invalid-link state, not a form", async () => {
    open("");
    expect(await screen.findByTestId("officer-reset-invalid")).toBeInTheDocument();
    expect(screen.queryByTestId("officer-reset-password-form")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "auth.reset_request_again" })).toHaveAttribute("href", "/forgot-password");
  });

  it("a mismatch or a short password never reaches the server", async () => {
    open("?uid=MQ&token=t");
    await screen.findByTestId("officer-reset-password-form");
    fill("N0t-Guessable!2026", "different-one-here");
    expect(await screen.findByRole("alert")).toHaveTextContent("profile.password_mismatch");
    fill("short", "short");
    expect(screen.getByRole("alert")).toHaveTextContent("profile.password_too_short");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("an expired link turns the page into the invalid-link state", async () => {
    confirm.mockRejectedValue({ response: { status: 400, data: { code: "reset_link_invalid", error: "x" } } });
    open("?uid=MQ&token=t");
    await screen.findByTestId("officer-reset-password-form");
    fill("N0t-Guessable!2026", "N0t-Guessable!2026");
    expect(await screen.findByTestId("officer-reset-invalid")).toBeInTheDocument();
  });

  it("a weak password keeps the form and lists each reason by its code, not the server's English", async () => {
    confirm.mockRejectedValue({
      response: {
        status: 400,
        data: {
          code: "weak_password",
          error: "This password is too common.",
          new_password: [
            { code: "password_too_common", message: "This password is too common." },
            { code: "password_entirely_numeric", message: "This password is entirely numeric." },
          ],
        },
      },
    });
    open("?uid=MQ&token=t");
    await screen.findByTestId("officer-reset-password-form");
    fill("12345678", "12345678");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("auth.reset_weak · profile.password_reason_common · profile.password_reason_numeric");
    expect(alert).not.toHaveTextContent("This password");
    expect(screen.getByTestId("officer-reset-password-form")).toBeInTheDocument();
  });
});

describe("/verify-email", () => {
  it("verifies once from the link and says so", async () => {
    verify.mockResolvedValue({ data: { detail: "ok" } });
    window.history.pushState({}, "", "/verify-email?uid=MQ&token=tok");
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByTestId("verify-email")).toHaveAttribute("data-phase", "done"));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith({ uid: "MQ", token: "tok" });
    expect(window.location.search).toBe("");
  });

  it("an invalid link or a missing token is the invalid state", async () => {
    verify.mockRejectedValue({ response: { status: 400 } });
    window.history.pushState({}, "", "/verify-email?uid=MQ&token=bad");
    const view = render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByTestId("verify-email")).toHaveAttribute("data-phase", "invalid"));
    view.unmount();

    verify.mockClear();
    window.history.pushState({}, "", "/verify-email");
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByTestId("verify-email")).toHaveAttribute("data-phase", "invalid"));
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("profile · 邮箱验证 row", () => {
  function renderRow(props: { hasEmail: boolean; verified: boolean }) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <dl>{children}</dl>
      </QueryClientProvider>
    );
    return render(<EmailVerificationRow {...props} />, { wrapper: Wrapper });
  }

  it("shows 已验证 and no send button when verified", () => {
    renderRow({ hasEmail: true, verified: true });
    expect(screen.getByTestId("email-verification")).toHaveTextContent("profile.email_verified");
    expect(screen.queryByRole("button", { name: "profile.email_send_verification" })).not.toBeInTheDocument();
  });

  it("shows 未验证 with 发送验证邮件, which calls the endpoint and toasts", async () => {
    sendVerification.mockResolvedValue({ data: { detail: "ok" } });
    renderRow({ hasEmail: true, verified: false });
    expect(screen.getByTestId("email-verification")).toHaveTextContent("profile.email_unverified");
    fireEvent.click(screen.getByRole("button", { name: "profile.email_send_verification" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("profile.email_verification_sent", "success"));
    expect(sendVerification).toHaveBeenCalledTimes(1);
  });

  it("a 429 says 'too frequent'; any other failure says it could not send", async () => {
    sendVerification.mockRejectedValueOnce({ response: { status: 429 } });
    renderRow({ hasEmail: true, verified: false });
    fireEvent.click(screen.getByRole("button", { name: "profile.email_send_verification" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("auth.rate_limited", "error"));
    sendVerification.mockRejectedValueOnce({ response: { status: 500 } });
    fireEvent.click(screen.getByRole("button", { name: "profile.email_send_verification" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("profile.email_verification_failed", "error"));
  });

  it("draws nothing when the account has no email", () => {
    renderRow({ hasEmail: false, verified: false });
    expect(screen.queryByTestId("email-verification")).not.toBeInTheDocument();
  });
});
