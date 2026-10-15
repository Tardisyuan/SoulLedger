/**
 * /profile 修改密码: the server's refusal is shown under the field it is about, one line per reason
 * by its code (never Django's English sentence), and a success says the other devices were signed out.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProfilePage from "@/app/profile/page";

jest.mock("@soulledger/core/api", () => ({
  authApi: {
    profile: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    preferences: jest.fn().mockResolvedValue({ data: { notifications: {} } }),
    updatePreferences: jest.fn(),
  },
  notificationsApi: { emailStatus: jest.fn().mockResolvedValue({ data: { last_failure: null } }) },
  mfaApi: { status: jest.fn().mockResolvedValue({ data: { enabled: false, required: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 } }) },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { username: "u", role: "JUDGE", tenant: { display_name: "中国地府" } }, setUser: jest.fn() }),
}));
const mockToast = jest.fn();
jest.mock("@/src/components/ui/Toast", () => ({ showToast: (...a: unknown[]) => mockToast(...a) }));

const { authApi } = require("@soulledger/core/api");

async function openForm(next = "N0t-Guessable!2026", confirm = next, submit = true) {
  (authApi.profile as jest.Mock).mockResolvedValue({ data: { username: "u", email: "", role: "JUDGE" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>
  );
  fireEvent.click((await screen.findAllByRole("button", { name: "profile.change_password" }))[0]);
  const [oldInput, newInput, confirmInput] = Array.from(document.querySelectorAll('input[type="password"]'));
  fireEvent.change(oldInput, { target: { value: "oldpw-123" } });
  fireEvent.change(newInput, { target: { value: next } });
  fireEvent.change(confirmInput, { target: { value: confirm } });
  if (submit) fireEvent.submit(oldInput.closest("form")!);
  return { oldInput, newInput: newInput as HTMLInputElement, confirmInput };
}

const state = (rule: string) => screen.getByTestId(`password-rule-${rule}`).getAttribute("data-state");

beforeEach(() => jest.clearAllMocks());

it("a 'too common' refusal replaces the reasons and the old sentence with the checklist's own line, keeping the ticks", async () => {
  (authApi.changePassword as jest.Mock).mockRejectedValue({
    response: {
      status: 400,
      data: { new_password: [{ code: "password_too_common", message: "This password is too common." }] },
    },
  });
  const { newInput } = await openForm("password-123");
  const common = await screen.findByTestId("password-rules-common");
  expect(common).toHaveTextContent("password_rules.common_title");
  expect(common).toHaveTextContent("password_rules.common_body");
  expect(document.body).not.toHaveTextContent("This password");
  expect(document.body).not.toHaveTextContent("profile.password_reason");
  for (const rule of ["min_length", "not_digits", "not_current", "match"]) expect(state(rule)).toBe("ok");
  expect(newInput).toHaveAttribute("aria-invalid", "true");
  expect(newInput).toHaveFocus();
  expect(newInput.value).toBe("password-123");
  expect(mockToast).not.toHaveBeenCalled();
});

it("is all unmarked on arrival and typing never shows '!'", async () => {
  const { newInput } = await openForm("abc", "", false);
  expect(["min_length", "not_digits", "not_current"].map(state)).toEqual(["idle", "ok", "ok"]);
  expect(screen.getByTestId("password-rules-list").textContent).not.toContain("!");
  expect(screen.queryByTestId("password-rules-announce")).not.toBeInTheDocument();
  fireEvent.blur(newInput);
  expect(state("min_length")).toBe("bad");
  fireEvent.change(newInput, { target: { value: "N0t-Guessable!2026" } });
  expect(state("min_length")).toBe("ok");
});

it("saving with an unmet rule sends nothing, marks it, focuses the box and announces the summary", async () => {
  const { newInput } = await openForm("1234567");
  expect(authApi.changePassword).not.toHaveBeenCalled();
  expect(state("min_length")).toBe("bad");
  expect(newInput).toHaveFocus();
  expect(newInput).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByTestId("password-rules-announce")).toHaveTextContent("password_rules.summary");
  expect(mockToast).not.toHaveBeenCalled();
});

it("a mismatch sends nothing and focuses the confirm box", async () => {
  const { confirmInput } = await openForm("N0t-Guessable!2026", "other");
  expect(authApi.changePassword).not.toHaveBeenCalled();
  expect(state("match")).toBe("bad");
  expect(confirmInput).toHaveFocus();
});

it("a clean form sends the request", async () => {
  (authApi.changePassword as jest.Mock).mockResolvedValue({ data: { detail: "ok" } });
  await openForm();
  await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledWith("oldpw-123", "N0t-Guessable!2026"));
});

it("a wrong old password shows under the old-password field", async () => {
  (authApi.changePassword as jest.Mock).mockRejectedValue({
    response: { status: 400, data: { old_password: ["旧密码不正确"] } },
  });
  await openForm();
  expect(await screen.findByRole("alert")).toHaveTextContent("profile.password_old_wrong");
});

it("a success says the other devices were signed out", async () => {
  (authApi.changePassword as jest.Mock).mockResolvedValue({ data: { detail: "ok", access: "a", refresh: "r" } });
  await openForm();
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("profile.password_changed_others_out", "success"));
});
