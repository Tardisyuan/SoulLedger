/**
 * /profile 的「通知」表(Design 第二十八批 W3):类别 × 站内 / 邮件。可关的格是开关,点一下 PATCH 那一格;
 * 锁定的格(账号安全两列、密码求助两列、审批超时的站内)是禁用的 switch 写着「必收」;
 * 密码求助只给管理员看;旧的「邮件通知」总开关不再出现。上次发送失败与「没有邮箱」的说明保留。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProfilePage from "@/app/profile/page";

jest.mock("@soulledger/core/api", () => ({
  authApi: { profile: jest.fn(), updateProfile: jest.fn(), changePassword: jest.fn(), preferences: jest.fn(), updatePreferences: jest.fn() },
  notificationsApi: { emailStatus: jest.fn() },
  sessionsApi: { list: jest.fn().mockResolvedValue({ data: [] }) },
  mfaApi: { status: jest.fn().mockResolvedValue({ data: { enabled: false, required: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 } }) },
}));

let mockLocale = "zh-Hans";
let mockRole = "ADMIN";
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join("|")}` : key),
    locale: mockLocale,
    hydrated: true,
    formatDateTime: (v: string) => `at(${v})`,
  }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { username: "u", role: mockRole, email: "" }, setUser: jest.fn() }),
}));

jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const { authApi, notificationsApi } = require("@soulledger/core/api");

const cell = (site: boolean, mail: boolean) => ({ site, mail });
const TABLE = {
  account_security: cell(true, true),
  approval: cell(true, false),
  approval_timeout: cell(true, false),
  reassign: cell(true, false),
  password_help: cell(true, true),
  dispatch: cell(true, false),
  letter_handoff: cell(true, false),
  city_god: cell(true, false),
};
const PREFS = { default_view: null, onboarded: false, notifications: TABLE, email_locale: null };
const withCell = (category: keyof typeof TABLE, value: { site: boolean; mail: boolean }) => ({
  ...PREFS,
  notifications: { ...TABLE, [category]: value },
});

const label = (category: string, channel: "site" | "mail") =>
  `profile.notifications.categories.${category} · profile.notifications.${channel}`;
const lockedLabel = (category: string, channel: "site" | "mail") => `${label(category, channel)} · profile.notifications.locked`;

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
  mockRole = "ADMIN";
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: PREFS });
  (authApi.updatePreferences as jest.Mock).mockReset();
  (notificationsApi.emailStatus as jest.Mock).mockResolvedValue({ data: { last_failure: null } });
});

it("renders the table with the section titled 通知 and no old 邮件通知 switch", async () => {
  renderPage();
  const toggle = await screen.findByRole("switch", { name: label("approval", "mail") });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(screen.getByRole("heading", { name: /profile\.notifications\.title/ })).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "profile.notifications.title" });
  expect(within(table).getAllByRole("row")).toHaveLength(1 + 8); // header + eight categories (admin)
  // absence: neither the old switch nor its heading/note remain
  expect(screen.queryByRole("switch", { name: "profile.email_notifications" })).toBeNull();
  expect(screen.queryByText("profile.email_notifications")).toBeNull();
  expect(screen.queryByText("profile.email_notifications_note")).toBeNull();
});

it("locked cells are disabled, checked and say 必收; the others are live switches", async () => {
  renderPage();
  await screen.findByRole("switch", { name: label("approval", "mail") });
  for (const [category, channel] of [
    ["account_security", "site"], ["account_security", "mail"],
    ["password_help", "site"], ["password_help", "mail"],
    ["approval_timeout", "site"],
  ] as const) {
    const locked = screen.getByRole("switch", { name: lockedLabel(category, channel) });
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("aria-checked", "true");
    expect(locked).toHaveTextContent("profile.notifications.locked");
    expect(screen.queryByRole("switch", { name: label(category, channel) })).toBeNull();
  }
  // approval_timeout's mail column is switchable, and so is every other cell
  expect(screen.getByRole("switch", { name: label("approval_timeout", "mail") })).not.toBeDisabled();
  expect(screen.getAllByRole("switch").filter((el) => !(el as HTMLButtonElement).disabled)).toHaveLength(8 * 2 - 5);
});

it("turning a mail cell on PATCHes only that cell plus the UI language; turning it off sends only the cell", async () => {
  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: withCell("approval", cell(true, true)) });
  renderPage();
  const toggle = await screen.findByRole("switch", { name: label("approval", "mail") });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByRole("status")).toBeNull();

  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(authApi.updatePreferences).toHaveBeenCalledWith({ notifications: { approval: { mail: true } }, email_locale: "zh-Hans" });

  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: PREFS });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  expect(authApi.updatePreferences).toHaveBeenLastCalledWith({ notifications: { approval: { mail: false } } });
});

it("a site cell sends no language; an egy interface asks for English mail", async () => {
  mockLocale = "egy";
  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: withCell("dispatch", cell(false, false)) });
  renderPage();
  const site = await screen.findByRole("switch", { name: label("dispatch", "site") });
  await waitFor(() => expect(site).not.toBeDisabled());
  fireEvent.click(site);
  await waitFor(() => expect(authApi.updatePreferences).toHaveBeenCalledWith({ notifications: { dispatch: { site: false } } }));

  (authApi.updatePreferences as jest.Mock).mockResolvedValue({ data: withCell("letter_handoff", cell(true, true)) });
  fireEvent.click(screen.getByRole("switch", { name: label("letter_handoff", "mail") }));
  await waitFor(() =>
    expect(authApi.updatePreferences).toHaveBeenLastCalledWith({ notifications: { letter_handoff: { mail: true } }, email_locale: "en" })
  );
});

it("password help is shown to administrators only", async () => {
  mockRole = "MODERATOR";
  renderPage({ username: "u", email: "u@example.com", role: "MODERATOR" });
  await screen.findByRole("switch", { name: label("approval", "mail") });
  const table = screen.getByRole("table", { name: "profile.notifications.title" });
  expect(within(table).getAllByRole("row")).toHaveLength(1 + 7);
  expect(screen.queryByText("profile.notifications.categories.password_help")).toBeNull();
});

it("shows the last failed send, and says so when the account has no address", async () => {
  (notificationsApi.emailStatus as jest.Mock).mockResolvedValue({
    data: { last_failure: { error: "smtp down", at: "2026-10-08T01:02:03Z" } },
  });
  renderPage({ username: "u", email: "", role: "ADMIN" });
  expect(await screen.findByRole("status")).toHaveTextContent("profile.email_last_failure:smtp down|at(2026-10-08T01:02:03Z)");
  expect(screen.getByText("profile.email_notifications_no_address")).toBeInTheDocument();
});

it("has the single-key shortcuts switch, on by default, and turning it off is remembered in this browser", async () => {
  localStorage.removeItem("soulledger_single_key_shortcuts");
  renderPage();
  const box = await screen.findByRole("checkbox", { name: /shortcuts.single_keys/ });
  expect(box).toBeChecked();
  fireEvent.click(box);
  expect(box).not.toBeChecked();
  expect(localStorage.getItem("soulledger_single_key_shortcuts")).toBe("off");
  fireEvent.click(box);
  expect(localStorage.getItem("soulledger_single_key_shortcuts")).toBeNull();
});
