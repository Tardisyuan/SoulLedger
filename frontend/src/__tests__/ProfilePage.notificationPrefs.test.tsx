/**
 * /profile 的邮件通知开关:读 `preferences.email_notifications`(默认关),开的那一刻把界面语言
 * 记成 `email_locale`,关只发 `email_notifications: false`;旁边显示 `/notifications/email-status/`
 * 的上次失败,没失败过不显示;账号没邮箱时说明开了也不发。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProfilePage from "@/app/profile/page";

jest.mock("@soulledger/core/api", () => ({
  authApi: { profile: jest.fn(), updateProfile: jest.fn(), changePassword: jest.fn(), preferences: jest.fn(), updatePreferences: jest.fn() },
  notificationsApi: { emailStatus: jest.fn() },
  mfaApi: { status: jest.fn().mockResolvedValue({ data: { enabled: false, required: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 } }) },
}));

let mockLocale = "zh-Hans";
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join("|")}` : key),
    locale: mockLocale,
    hydrated: true,
    formatDateTime: (v: string) => `at(${v})`,
  }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { username: "u", role: "ADMIN", email: "" }, setUser: jest.fn() }),
}));

jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const { authApi, notificationsApi } = require("@soulledger/core/api");

const PREFS = { default_view: null, onboarded: false, email_notifications: false, email_locale: null };

function renderPage(profile: Record<string, unknown> = { username: "u", email: "u@example.com", role: "ADMIN" }) {
  (authApi.profile as jest.Mock).mockResolvedValue({ data: profile });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockLocale = "zh-Hans";
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: PREFS });
  (authApi.updatePreferences as jest.Mock).mockReset();
  (notificationsApi.emailStatus as jest.Mock).mockResolvedValue({ data: { last_failure: null } });
});

it("reads the preference as off, and turning it on sends the switch plus the UI language", async () => {
  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: { ...PREFS, email_notifications: true, email_locale: "zh-Hans" } });
  renderPage();
  const toggle = await screen.findByRole("switch", { name: "profile.email_notifications" });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("profile.email_notifications_no_address")).toBeNull();

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(authApi.updatePreferences).toHaveBeenCalledWith({ email_notifications: true, email_locale: "zh-Hans" });

  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: PREFS });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  expect(authApi.updatePreferences).toHaveBeenLastCalledWith({ email_notifications: false });
});

it("an egy interface asks for English mail; a stored on-state reads as on", async () => {
  mockLocale = "egy";
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: { ...PREFS, email_notifications: true, email_locale: "en" } });
  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: { ...PREFS, email_notifications: true, email_locale: "en" } });
  renderPage();
  const toggle = await screen.findByRole("switch", { name: "profile.email_notifications" });
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  fireEvent.click(toggle);
  await waitFor(() => expect(authApi.updatePreferences).toHaveBeenCalledWith({ email_notifications: false }));
});

it("shows the last failed send next to the switch, and says so when the account has no address", async () => {
  (notificationsApi.emailStatus as jest.Mock).mockResolvedValue({
    data: { last_failure: { error: "smtp down", at: "2026-10-08T01:02:03Z" } },
  });
  renderPage({ username: "u", email: "", role: "ADMIN" });
  expect(await screen.findByRole("status")).toHaveTextContent("profile.email_last_failure:smtp down|at(2026-10-08T01:02:03Z)");
  expect(screen.getByText("profile.email_notifications_no_address")).toBeInTheDocument();
});
