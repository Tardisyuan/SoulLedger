/**
 * 官员邮件语言跟界面语言走(`useSyncEmailLocale`):界面语言变动时,任一格邮件开着(锁定的恒开)且记的语言不同才 PATCH
 * `email_locale`;首次渲染不发请求;读不到通知表时不改;egy 界面落到 en。
 */
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSyncEmailLocale } from "@/src/components/layout/EmailLocaleSync";

jest.mock("@soulledger/core/api", () => ({
  authApi: { preferences: jest.fn(), updatePreferences: jest.fn() },
}));

let mockLocale = "zh-Hans";
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ locale: mockLocale }),
}));

const { authApi } = require("@soulledger/core/api");

// 服务端永远回整张表,锁定的邮件格恒为开;「全关」只会是缺这个字段的旧响应。
const ALL_MAIL_ON = { account_security: { site: true, mail: true }, approval: { site: true, mail: false } };

function Probe() {
  useSyncEmailLocale();
  return null;
}

function mount() {
  const client = new QueryClient();
  const ui = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { change: (locale: string) => { mockLocale = locale; view.rerender(ui()); } };
}

beforeEach(() => {
  mockLocale = "zh-Hans";
  (authApi.preferences as jest.Mock).mockReset();
  (authApi.updatePreferences as jest.Mock).mockReset().mockResolvedValue({ data: {} });
});

it("sends nothing on first render", () => {
  mount();
  expect(authApi.preferences).not.toHaveBeenCalled();
});

it("moves email_locale to the new UI language when emails are on", async () => {
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: { notifications: ALL_MAIL_ON, email_locale: "zh-Hans" } });
  mount().change("en");
  await waitFor(() => expect(authApi.updatePreferences).toHaveBeenCalledWith({ email_locale: "en" }));
});

it("maps egy to en", async () => {
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: { notifications: ALL_MAIL_ON, email_locale: "zh-Hans" } });
  mount().change("egy");
  await waitFor(() => expect(authApi.updatePreferences).toHaveBeenCalledWith({ email_locale: "en" }));
});

it("leaves it alone when emails are off or the language already matches", async () => {
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: { email_locale: "zh-Hans" } });
  mount().change("en");
  await waitFor(() => expect(authApi.preferences).toHaveBeenCalled());
  (authApi.preferences as jest.Mock).mockResolvedValue({ data: { notifications: ALL_MAIL_ON, email_locale: "en" } });
  mockLocale = "zh-Hans";
  mount().change("en");
  await waitFor(() => expect(authApi.preferences).toHaveBeenCalledTimes(2));
  expect(authApi.updatePreferences).not.toHaveBeenCalled();
});
