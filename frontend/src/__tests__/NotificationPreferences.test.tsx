/**
 * 个人中心「通知」的开关(审计 2026-11-26 B5):点下去这一格当场翻过去,不等往返;在途时别的格照样能点;
 * 失败只把这一格放回去并提示,不碰同时在途的另一格。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { NotificationPreferences } from "@/src/components/profile/NotificationPreferences";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  authApi: { preferences: jest.fn(), updatePreferences: jest.fn() },
  notificationsApi: { emailStatus: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", formatDateTime: (s: string) => s }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { role: "officer" } }) }));
jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const { authApi, notificationsApi } = require("@soulledger/core/api");
const { showToast } = require("@/src/components/ui/Toast");

const PREFS = {
  notifications: {
    account_security: { site: true, mail: true },
    approval: { site: false, mail: false },
    approval_timeout: { site: true, mail: false },
    reassign: { site: false, mail: false },
    password_help: { site: true, mail: true },
    dispatch: { site: false, mail: false },
    letter_handoff: { site: false, mail: false },
    city_god: { site: false, mail: false },
  },
};

function deferred() {
  let resolve!: (_v: unknown) => void;
  let reject!: (_e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sw = (name: string) => screen.getByRole("switch", { name: `profile.notifications.categories.${name}` });

beforeEach(() => {
  jest.clearAllMocks();
  authApi.preferences.mockResolvedValue({ data: PREFS });
  notificationsApi.emailStatus.mockResolvedValue({ data: { last_failure: null } });
});

async function renderPrefs() {
  renderWithProviders(<NotificationPreferences hasAddress />, { i18n: false });
  await screen.findAllByRole("switch", { name: "profile.notifications.categories.approval · profile.notifications.site" });
}

it("flips the switch at once, keeps the others usable, and rolls back only that switch on failure", async () => {
  const first = deferred();
  const second = deferred();
  authApi.updatePreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await renderPrefs();

  const approvalSite = sw("approval · profile.notifications.site");
  const dispatchMail = sw("dispatch · profile.notifications.mail");
  fireEvent.click(approvalSite);
  // 乐观:请求还在途,这一格已经翻过去;别的格没有一起变灰。
  await waitFor(() => expect(approvalSite).toHaveAttribute("aria-checked", "true"));
  expect(dispatchMail).not.toBeDisabled();

  fireEvent.click(dispatchMail);
  await waitFor(() => expect(dispatchMail).toHaveAttribute("aria-checked", "true"));

  // 第一格失败:只它放回去,同时在途的第二格不动。
  await act(async () => first.reject(new Error("boom")));
  await waitFor(() => expect(approvalSite).toHaveAttribute("aria-checked", "false"));
  expect(dispatchMail).toHaveAttribute("aria-checked", "true");
  expect(showToast).toHaveBeenCalledWith("profile.profile_update_failed", "error");

  const after = { notifications: { ...PREFS.notifications, dispatch: { site: false, mail: true } } };
  await act(async () => second.resolve({ data: after }));
  expect(dispatchMail).toHaveAttribute("aria-checked", "true");
  expect(approvalSite).toHaveAttribute("aria-checked", "false");
});
