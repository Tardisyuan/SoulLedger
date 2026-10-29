/**
 * 管理员重置密码(2026-10-29 用户决定第 8 条):显示一次性设置链接,不再显示密码;对另一位管理员,
 * 服务端答 403 `second_factor_required` 时弹出验证码输入,错码留在输入框里说剩几次,对了才带着证明重发。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PasswordResetDialog } from "@/src/components/users/PasswordResetDialog";
import { usersApi, type User } from "@soulledger/core/api";
import { tZh, zh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, string>) => tZh(key, params), locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@soulledger/core/api", () => ({ usersApi: { resetPassword: jest.fn() } }));
jest.mock("@soulledger/core/query_keys", () => ({ userKeys: { all: ["users"] } }));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const reset = usersApi.resetPassword as jest.Mock;
const LINK = "https://desk.example/accept-invite?uid=MQ&token=abc&kind=reset";
const refusal = (status: number, data: object) => Object.assign(new Error("refused"), { response: { status, data } });

function renderDialog(user: Partial<User>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PasswordResetDialog user={{ id: 7, username: "mengpo", email: "", role: "JUDGE", is_active: true, ...user } as User} onClose={jest.fn()} />
    </QueryClientProvider>
  );
}

beforeEach(() => reset.mockReset());

it("shows the one-time link and never a password", async () => {
  reset.mockResolvedValue({ data: { link: LINK, expires_in: 86400 } });
  renderDialog({});
  fireEvent.click(screen.getByTestId("password-reset-confirm"));
  expect(await screen.findByTestId("reset-password-link")).toHaveTextContent(LINK);
  expect(reset).toHaveBeenCalledWith(7, undefined);
  expect(screen.queryByTestId("reset-password-value")).not.toBeInTheDocument();
  expect(screen.getByText(zh("users.reset_password.link_warning", { hours: "24" }))).toBeInTheDocument();
});

it("asks for the caller's own code when the target is another administrator", async () => {
  reset
    .mockRejectedValueOnce(refusal(403, { code: "second_factor_required" }))
    .mockRejectedValueOnce(refusal(400, { code: "wrong", remaining_attempts: 4 }))
    .mockResolvedValueOnce({ data: { link: LINK, expires_in: 86400 } });
  renderDialog({ role: "ADMIN", username: "yama" });
  fireEvent.click(screen.getByTestId("password-reset-confirm"));

  const code = await screen.findByTestId("second-factor-code");
  expect(screen.queryByTestId("reset-password-link")).not.toBeInTheDocument();
  fireEvent.change(code, { target: { value: "000000" } });
  fireEvent.click(screen.getByTestId("second-factor-submit"));
  expect(await screen.findByText(zh("users.second_factor.wrong", { n: "4" }))).toBeInTheDocument();
  expect(screen.queryByTestId("reset-password-link")).not.toBeInTheDocument();

  fireEvent.change(screen.getByTestId("second-factor-code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByTestId("second-factor-submit"));
  expect(await screen.findByTestId("reset-password-link")).toHaveTextContent(LINK);
  expect(reset).toHaveBeenNthCalledWith(3, 7, { mfa_method: "totp", mfa_code: "123456" });
  await waitFor(() => expect(screen.queryByTestId("second-factor-code")).not.toBeInTheDocument());
});
