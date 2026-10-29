/**
 * Round 4's settings page and round 3's push, through the real navigator and
 * core's real soul client. The system side of push (permission, token, taps)
 * is the `expo-notifications` double in jest.setup.js; the EAS project id is
 * `expo-constants`' — absent unless a test sets it, as in a development build.
 */
import { LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Linking, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { PRIMER_SEEN_KEY, PUSH_TOKEN_KEY, landingOf, registerDevice, requestPermission } from "../push";
import { SessionProvider } from "../session";
import { PROFILE, application, life, pressTab, settleTabs, stubApi, type Reply, resetLoginMemory } from "./stubApi";

type NotificationsDouble = {
  status: string;
  answer: string;
  requests: number;
  token: string;
  tokenError: Error | null;
  lastResponse: unknown;
  responseListeners: Set<(r: unknown) => void>;
  tokenListeners: Set<(t: unknown) => void>;
};
const system = (Notifications as unknown as { __state: NotificationsDouble }).__state;
const constants = Constants as unknown as { expoConfig: { extra: Record<string, unknown> } };
const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const APP_ID ="3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const SETTINGS = { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" };
const STATEMENT = "我这一世无甚大功，唯有在一九九八年的水里，把一个不认识的孩子推上了岸。";

function renderApp() {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/** A signed-in soul with the routes every screen here reads. */
function signedIn(extra: Record<string, Reply | Reply[]> = {}) {
  secure.set(REFRESH_TOKEN_KEY, "R");
  return stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "GET /me/notification-settings/": { status: 200, data: SETTINGS },
    ...extra,
  });
}

let tapCount = 0;
/** A tap on a NEW notification: every real notification has its own identifier. */
const tap = (data: unknown) =>
  act(() => {
    const identifier = `tap-${++tapCount}`;
    for (const listener of system.responseListeners) listener({ notification: { request: { identifier, content: { data } } } });
  });

const route = () => navigationRef.getCurrentRoute();

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secure.clear();
  await AsyncStorage.clear();
  for (const key of [PUSH_TOKEN_KEY, PRIMER_SEEN_KEY, LOCALE_COOKIE]) persistentStore.remove(key);
  Object.assign(system, { status: "undetermined", answer: "granted", requests: 0, tokenError: null, lastResponse: null, canAskAgain: undefined });
  constants.expoConfig.extra = {};
});

describe("the settings page is the one place for language and sign-out", () => {
  it("the life tab no longer has a language switch or a sign-out button; the header icon opens settings", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.queryByTestId("logout")).toBeNull();
    expect(screen.queryByTestId(/^locale-/)).toBeNull();
    expect(screen.queryByTestId(/^language-/)).toBeNull();
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    expect(route()?.name).toBe("Settings");
    expect(screen.getByTestId("logout")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.props.testID)).toEqual(["language-zh-Hans", "language-en", "language-egy"]);
    expect(screen.getByTestId("language-zh-Hans").props.accessibilityState).toEqual({ checked: true });
    // Each row is read in its own language: Kemet's text is English, so it is read as `en`.
    expect(["zh-Hans", "en", "egy"].map((l) => screen.getByTestId(`language-${l}`).props.accessibilityLanguage)).toEqual(["zh-Hans", "en", "en"]);
    // Each row names its language the way the login screen's buttons do (LOCALE_LABELS) —
    // the bundles' own `language_name` said "Egyptian" and "中文" while login said "Kemet" and "简体中文".
    for (const name of ["简体中文", "English", "Kemet"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText("Egyptian")).toBeNull();
    await act(async () => {}); // the page's permission read settles before the test ends
  });

  it("at large text the 「当前」 badge sits under the language's text column, not beside it", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    const row = screen.getByTestId("language-zh-Hans");
    expect(within(within(row).getByTestId("language-zh-Hans-text")).getByTestId("language-zh-Hans-current")).toBeTruthy();
    expect(flat(within(row).getByTestId("language-zh-Hans-current"))).toMatchObject({ alignSelf: "flex-start", flexShrink: 0 });
    expect(flat(within(row).getByTestId("language-zh-Hans-text"))).toMatchObject({ flex: 1, minWidth: 0 });
    await act(async () => {});
  });

  it("第四十批 S-a: 朋友圈's bar ends with 「互动」 and its unread count, and opens 互动消息", async () => {
    signedIn({
      "/me/social/feed/": { status: 200, data: { count: 0, next: null, previous: null, results: [] } },
      "/me/social/status/": { status: 200, data: { user_id: 1, can_write: true, muted_until: null, reports_remaining: 5, unread_interactions: 3 } },
      "/me/social/interactions/": { status: 200, data: { count: 0, next: null, previous: null, results: [] } },
      "POST /me/social/interactions/read/": { status: 204 },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    await pressTab("tab-Circle");
    const entry = await screen.findByTestId("circle-inbox-open");
    expect(within(entry).getByText("互动")).toBeTruthy();
    expect(within(await screen.findByTestId("circle-inbox-open-badge")).getByText("3")).toBeTruthy();
    fireEvent.press(entry);
    await screen.findByTestId("circle-inbox-empty");
    expect(route()?.name).toBe("CircleInbox");
  });

  it("the same icon is on 本世 and 转生 (朋友圈 has search and my page there instead, 1a)", async () => {
    signedIn({
      "/me/past-lives/": { status: 200, data: [] },
      "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.getAllByTestId("header-account").length).toBeGreaterThan(0);
    for (const [tab, loaded] of [["tab-Applications", "eligibility"]]) {
      await pressTab(tab);
      expect(screen.getAllByTestId("header-account").length).toBeGreaterThan(0);
      await screen.findByTestId(loaded); // …and its request answered
    }
  });
});

describe("switching language", () => {
  it("takes effect at once, on the same screen, and changes no record content", async () => {
    const calls = signedIn({
      "/me/rebirth-applications/a1/": { status: 200, data: application({ statement: STATEMENT }) },
      "PATCH /me/notification-settings/": { status: 200, data: { ...SETTINGS, locale: "en" } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("ApplicationDetail", { id: "a1" }));
    const quote = await screen.findByText(STATEMENT);
    expect(quote).toBeTruthy();
    expect(screen.getByTestId("original-tag").props.children).toBe("原文 · 中文");
    expect(screen.queryByTestId("original-note")).toBeNull(); // interface and content agree: nothing to say
    act(() => navigationRef.navigate("Settings"));
    const card = await screen.findByTestId("settings");
    const skin = StyleSheet.flatten(card.props.style).backgroundColor;

    fireEvent.press(screen.getByTestId("language-en"));
    // Rule 一: now — before the account save has even answered — and without leaving the page.
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.queryByText("设置")).toBeNull();
    expect(route()?.name).toBe("Settings");
    expect(screen.getByTestId("language-en").props.accessibilityState).toEqual({ checked: true });
    await screen.findByTestId("language-saved");
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ locale: "en" }]);
    // Rule 三: the skin is the civilization's, not the language's.
    expect(StyleSheet.flatten(screen.getByTestId("settings").props.style).backgroundColor).toBe(skin);

    // Rule 二: back on the application, the statement is still exactly what was written.
    act(() => navigationRef.goBack());
    expect(await screen.findByText(STATEMENT)).toBeTruthy();
    expect(screen.getByText("Statement")).toBeTruthy();
    expect(screen.getByTestId("original-tag").props.children).toBe("Original · Chinese");
    expect(screen.getByTestId("original-note")).toBeTruthy();
    expect(screen.queryByTestId("login-submit")).toBeNull();
  });

  it("a failed account save keeps the new interface, says so, and offers retry or going back", async () => {
    const calls = signedIn({
      "PATCH /me/notification-settings/": [{ status: 500 }, { status: 200, data: SETTINGS }],
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    await screen.findByTestId("toggle-rebirth"); // the account's settings have loaded
    fireEvent.press(screen.getByTestId("language-en"));
    const failed = await screen.findByTestId("language-save-failed");
    expect(failed.props.children).toBe(
      "Could not save this to your account. The interface is English now, but another device will show 简体中文."
    );
    // The ⚠ is named and the row is an alert (FieldError), not a bare icon.
    expect(screen.UNSAFE_getAllByProps({ accessibilityRole: "alert" }).length).toBeGreaterThan(0);
    expect(screen.UNSAFE_getAllByProps({ accessibilityLabel: "Error" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Settings")).toBeTruthy(); // not taken back
    fireEvent.press(screen.getByTestId("language-revert"));
    expect(await screen.findByText("设置")).toBeTruthy();
    expect(screen.queryByTestId("language-save-failed")).toBeNull();
    // The account already said zh-Hans: going back needs no second save.
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });
});

describe("sign-out", () => {
  it("unregisters this device's push token BEFORE revoking the session", async () => {
    persistentStore.set(PUSH_TOKEN_KEY, "ExponentPushToken[device-0001]");
    const calls = signedIn({
      "/me/push-tokens/unregister/": { status: 204 },
      "/soul-auth/logout/": { status: 204 },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("logout"));
    fireEvent.press(await screen.findByTestId("logout-confirm"));
    await screen.findByTestId("login-submit");
    await waitFor(() => expect(calls.some((c) => c.url === "/soul-auth/logout/")).toBe(true));
    const order = calls.map((c) => c.url).filter((u) => u === "/me/push-tokens/unregister/" || u === "/soul-auth/logout/");
    expect(order).toEqual(["/me/push-tokens/unregister/", "/soul-auth/logout/"]);
    expect(calls.find((c) => c.url === "/me/push-tokens/unregister/")?.body).toEqual({ token: "ExponentPushToken[device-0001]" });
    expect(persistentStore.get(PUSH_TOKEN_KEY)).toBeNull();
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull();
  });

  it("a device that never registered signs out without an unregister call", async () => {
    const calls = signedIn({ "/soul-auth/logout/": { status: 204 } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("logout"));
    fireEvent.press(await screen.findByTestId("logout-confirm"));
    await waitFor(() => expect(calls.some((c) => c.url === "/soul-auth/logout/")).toBe(true));
    expect(calls.some((c) => c.url === "/me/push-tokens/unregister/")).toBe(false);
  });
});

describe("push registration", () => {
  it("without an EAS projectId: no token, no error, and the page says push is not enabled", async () => {
    system.status = "granted";
    const calls = signedIn();
    await expect(registerDevice()).resolves.toEqual({ ok: false, reason: "no_project_id" });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    expect(await screen.findByTestId("push-unavailable")).toBeTruthy();
    // No way into a system dialog for pushes this build cannot receive.
    expect(screen.queryByTestId("enable-push")).toBeNull();
    expect(calls.some((c) => c.url === "/me/push-tokens/")).toBe(false);
    expect(screen.queryByTestId("failure")).toBeNull();
    // …and the primer is never pushed on a build that cannot deliver.
    expect(route()?.name).toBe("Settings");
    // `usePermission()` settles after mount; everything above renders without it, so the test could
    // end first and the late update landed outside act (full-suite timing, 2026-10-08).
    await act(async () => {});
  });

  it("with a projectId and permission: registers at start-up, again on a token change, as IOS", async () => {
    constants.expoConfig.extra = { eas: { projectId: "p-123" } };
    system.status = "granted";
    const calls = signedIn({ "POST /me/push-tokens/": { status: 201, data: {} } });
    renderApp();
    await screen.findByTestId("profile-card");
    await waitFor(() => expect(calls.filter((c) => c.url === "/me/push-tokens/")).toHaveLength(1));
    expect(calls.find((c) => c.url === "/me/push-tokens/")?.body).toEqual({ token: "ExponentPushToken[test-device-0001]", platform: "IOS" });
    expect(persistentStore.get(PUSH_TOKEN_KEY)).toBe("ExponentPushToken[test-device-0001]");
    act(() => system.tokenListeners.forEach((l) => l({ type: "ios", data: "new" })));
    await waitFor(() => expect(calls.filter((c) => c.url === "/me/push-tokens/")).toHaveLength(2));
  });

  it("a token the system will not give is a quiet failure, not an error screen", async () => {
    constants.expoConfig.extra = { eas: { projectId: "p-123" } };
    system.status = "granted";
    system.tokenError = new Error("no aps-environment");
    await expect(registerDevice()).resolves.toEqual({ ok: false, reason: "token_failed" });
  });

  it("at sign-in the push language follows the interface language", async () => {
    persistentStore.set(LOCALE_COOKIE, "en");
    const calls = signedIn({ "PATCH /me/notification-settings/": { status: 200, data: { ...SETTINGS, locale: "en" } } });
    renderApp();
    await screen.findByTestId("profile-card");
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ locale: "en" }));
  });
});

describe("notification settings", () => {
  it("a switch writes back only its own field, and falls back when the save fails", async () => {
    const calls = signedIn({
      "PATCH /me/notification-settings/": [
        { status: 200, data: { ...SETTINGS, judgment: false } },
        { status: 500 },
      ],
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    const judgment = await screen.findByTestId("toggle-judgment");
    expect(judgment.props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(judgment);
    expect(screen.getByTestId("toggle-judgment").props.accessibilityState).toEqual({ checked: false });
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ judgment: false }]));

    fireEvent.press(screen.getByTestId("toggle-rebirth"));
    await waitFor(() => expect(screen.getByTestId("toggle-rebirth").props.accessibilityState).toEqual({ checked: true }));
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ judgment: false }, { rebirth: false }]);
    expect((await screen.findByTestId("toast")).props.children).toBe("没能保存这项设置，已恢复原样");
    // The judgment switch kept the value the server confirmed.
    expect(screen.getByTestId("toggle-judgment").props.accessibilityState).toEqual({ checked: false });
  });

  it("the letters switch is its own category: it writes back only `chat`", async () => {
    const calls = signedIn({ "PATCH /me/notification-settings/": { status: 200, data: { ...SETTINGS, chat: false } } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    const letters = await screen.findByTestId("toggle-chat");
    expect(within(letters).getByText("书信")).toBeTruthy();
    fireEvent.press(letters);
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ chat: false }]));
    expect(screen.getByTestId("toggle-chat").props.accessibilityState).toEqual({ checked: false });
  });

  it("第四十批 S-c: 朋友圈 has its two switches, each writing back only its own field; hall warnings say 不能关 and do nothing", async () => {
    const calls = signedIn({
      "GET /me/notification-settings/": { status: 200, data: { ...SETTINGS, social_comments: true, social_review: true } },
      "PATCH /me/notification-settings/": { status: 200, data: { ...SETTINGS, social_comments: false, social_review: true } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    const comments = await screen.findByTestId("toggle-social_comments");
    expect(within(comments).getByText("评论和回复")).toBeTruthy();
    expect(within(screen.getByTestId("toggle-social_review")).getByText("审核结果")).toBeTruthy();
    expect(within(screen.getByTestId("push-toggles")).getByText("朋友圈")).toBeTruthy();
    fireEvent.press(comments);
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ social_comments: false }]));
    const warning = screen.getByTestId("toggle-warning-locked");
    expect(within(warning).getByText("殿司警告")).toBeTruthy();
    expect(within(warning).getByText("不能关")).toBeTruthy();
    expect(warning.props.accessibilityState).toEqual({ checked: true, disabled: true });
    fireEvent.press(warning);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("第四十批 S-b: 账号安全 shows the masked contact email with 更改 and what it is for", async () => {
    signedIn({
      "GET /me/mfa/": { status: 200, data: { enabled: false } },
      "GET /me/sessions/": { status: 200, data: [] },
      "GET /me/contact-email/": { status: 200, data: { email_masked: "zh***@lingyun.cn", can_change: true, mfa_enabled: false } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    expect((await screen.findByTestId("email-masked")).props.children).toBe("zh***@lingyun.cn");
    expect(screen.getByTestId("email-action").props.children).toBe("更改 ›");
    expect(screen.getByTestId("email-hint").props.children).toBe("忘记密码时，验证码发到这里。");
  });

  it("a failed contact-email fetch keeps the row, says so, and a tap retries", async () => {
    signedIn({
      "GET /me/mfa/": { status: 500, data: {} },
      "GET /me/sessions/": { status: 200, data: [] },
      "GET /me/contact-email/": [
        { status: 500, data: {} },
        { status: 200, data: { email_masked: "zh***@lingyun.cn", can_change: true, mfa_enabled: false } },
      ],
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("email-load-failed"));
    expect((await screen.findByTestId("email-masked")).props.children).toBe("zh***@lingyun.cn");
    expect(screen.queryByTestId("email-load-failed")).toBeNull();
    expect(screen.getByTestId("open-mfa-state").props.children).toBe("加载失败");
  });

  it("第四十批 S-b: a hall that does not allow it has no 更改, and says to come in with the slip", async () => {
    signedIn({
      "GET /me/mfa/": { status: 200, data: { enabled: false } },
      "GET /me/sessions/": { status: 200, data: [] },
      "GET /me/contact-email/": { status: 200, data: { email_masked: "", can_change: false, mfa_enabled: false } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    expect((await screen.findByTestId("email-masked")).props.children).toBe("没有联系邮箱");
    expect(screen.queryByTestId("email-action")).toBeNull();
    expect(screen.getByTestId("email-hint").props.children).toBe("要改联系邮箱，请到本殿，带上交付单。");
  });

  it("第四十批 S-b: password → new address → the code sent there → done", async () => {
    const calls = signedIn({
      "GET /me/mfa/": { status: 200, data: { enabled: false } },
      "GET /me/sessions/": { status: 200, data: [] },
      "GET /me/contact-email/": { status: 200, data: { email_masked: "zh***@lingyun.cn", can_change: true, mfa_enabled: false } },
      "POST /me/contact-email/verify/": [{ status: 400, data: { detail: "密码不对。", code: "wrong_password", remaining_attempts: 4 } }, { status: 204 }],
      "POST /me/contact-email/": { status: 202, data: { sent_to: "new@example.org" } },
      "POST /me/contact-email/confirm/": [
        { status: 400, data: { detail: "验证码错误", code: "reset_code_wrong", attempts_left: 4 } },
        { status: 200, data: { email_masked: "ne***@example.org", can_change: true, mfa_enabled: false } },
      ],
    });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-contact-email"));
    fireEvent.changeText(await screen.findByTestId("contact-email-password"), "wrong");
    fireEvent.press(screen.getByTestId("contact-email-next"));
    expect(await screen.findByText("! 密码不对")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("contact-email-password"), "right");
    fireEvent.press(screen.getByTestId("contact-email-next"));
    fireEvent.changeText(await screen.findByTestId("contact-email-new"), " new@example.org ");
    fireEvent.press(screen.getByTestId("contact-email-send"));
    expect((await screen.findByTestId("contact-email-sent")).props.children).toBe("验证码已发到 new@example.org");
    fireEvent.changeText(screen.getByTestId("contact-email-code"), "111111");
    fireEvent.press(screen.getByTestId("contact-email-confirm"));
    expect((await screen.findByTestId("contact-email-code-error")).props.children).toBe("验证码不对 还可以再试 4 次。");
    fireEvent.changeText(screen.getByTestId("contact-email-code"), "123456");
    fireEvent.press(screen.getByTestId("contact-email-confirm"));
    expect((await screen.findByTestId("toast")).props.children).toBe("联系邮箱已改");
    expect(calls.filter((c) => c.method === "POST" && c.url.startsWith("/me/contact-email/")).map((c) => c.body)).toEqual([
      { password: "wrong" },
      { password: "right" },
      { email: "new@example.org" },
      { code: "111111" },
      { code: "123456" },
    ]);
  });

  it("system permission denied: the page says so, links to system settings, and the switches dim but still work", async () => {
    system.status = "denied";
    const calls = signedIn({ "PATCH /me/notification-settings/": { status: 200, data: { ...SETTINGS, rebirth: false } } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    expect(await screen.findByTestId("push-denied")).toBeTruthy();
    expect(screen.getByTestId("open-system-settings")).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId("push-toggles").props.style)).toMatchObject({ opacity: 0.55 });
    expect(screen.getByTestId("toggle-rebirth").props.accessibilityState).toEqual({ checked: true });
    expect(screen.queryByTestId("enable-push")).toBeNull();
    // Dimmed is not disabled: the choice is saved for when the system allows it.
    fireEvent.press(screen.getByTestId("toggle-rebirth"));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ rebirth: false }]));
  });

  it("Android 13+ reports a never-asked app as denied-but-askable: that is the primer, not 'system closed'", async () => {
    Object.assign(system, { status: "denied", canAskAgain: true });
    constants.expoConfig.extra = { eas: { projectId: "p-123" } };
    signedIn({ "POST /me/push-tokens/": { status: 201, data: {} } });
    renderApp();
    fireEvent.press(await screen.findByTestId("primer-yes"));
    await screen.findByTestId("profile-card");
    expect(system.requests).toBe(1);
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    // Until the permission read answers, perm is null and push-denied is absent whatever
    // the answer — the assertion below would pass without looking. Let it answer first.
    await act(async () => {});
    expect(screen.queryByTestId("push-denied")).toBeNull();
  });

  it("the primer explains first: 'not now' never calls the system dialog; 'yes' does, once", async () => {
    constants.expoConfig.extra = { eas: { projectId: "p-123" } };
    persistentStore.set(PRIMER_SEEN_KEY, "1"); // not auto-offered here: reached from the settings page
    signedIn({ "POST /me/push-tokens/": { status: 201, data: {} } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("enable-push"));
    await screen.findByTestId("push-primer");
    fireEvent.press(screen.getByTestId("primer-no"));
    await screen.findByTestId("settings");
    expect(system.requests).toBe(0);
    expect(persistentStore.get(PRIMER_SEEN_KEY)).toBe("1");

    fireEvent.press(screen.getByTestId("enable-push"));
    fireEvent.press(await screen.findByTestId("primer-yes"));
    await screen.findByTestId("settings");
    expect(system.requests).toBe(1);
    await waitFor(() => expect(screen.queryByTestId("enable-push")).not.toBeOnTheScreen());
  });

  it("with push available, the primer is offered once after sign-in — not again", async () => {
    constants.expoConfig.extra = { eas: { projectId: "p-123" } };
    signedIn();
    const first = renderApp();
    expect(await screen.findByTestId("push-primer")).toBeTruthy();
    fireEvent.press(screen.getByTestId("primer-no"));
    await screen.findByTestId("profile-card");
    first.unmount();
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => {});
    expect(screen.queryByTestId("push-primer")).toBeNull();
  });
});

describe("tapping a notification", () => {
  it("landingOf routes by screen alone; an unknown kind with a known screen still lands, junk lands nowhere", () => {
    expect(landingOf({ screen: "ApplicationDetail", application_id: APP_ID, kind: "rebirth_rejected" })).toEqual({ screen: "ApplicationDetail", id: APP_ID });
    // 第四十批 S-e: the residence block is washed.
    expect(landingOf({ screen: "Life", kind: "residence_approved" })).toEqual({ screen: "Life", focus: { residence: true } });
    // The backend's `chat_message` (a new letter, or the hall's reply) lands on that conversation.
    expect(landingOf({ screen: "Conversation", conversation_id: APP_ID, kind: "chat_message" })).toEqual({ screen: "Conversation", id: APP_ID });
    expect(landingOf({ screen: "ApplicationDetail", application_id: "../../me/" })).toEqual({ screen: "Life" });
    expect(landingOf({ screen: "ApplicationDetail" })).toEqual({ screen: "Life" });
    expect(landingOf({ screen: "Chat", kind: "dm_received" })).toBeNull();
    expect(landingOf({ kind: "rebirth_approved" })).toBeNull();
    expect(landingOf(null)).toBeNull();
    expect(landingOf("ApplicationDetail")).toBeNull();
  });

  it("第四十批: a comment push names its comment; judgment / disposition pushes name their row; junk ids are dropped", () => {
    const COMMENT = "22222222-2222-4222-8222-222222222222";
    expect(landingOf({ screen: "CirclePost", post_id: APP_ID, comment_id: COMMENT, kind: "comment" })).toEqual({ screen: "CirclePost", id: APP_ID, comment: COMMENT });
    expect(landingOf({ screen: "CirclePost", post_id: APP_ID, comment_id: "../x", kind: "reply" })).toEqual({ screen: "CirclePost", id: APP_ID });
    expect(landingOf({ screen: "Life", judgment_id: APP_ID, kind: "judgment_result" })).toEqual({ screen: "Life", focus: { judgment: APP_ID } });
    expect(landingOf({ screen: "Life", disposition_id: APP_ID, kind: "disposition_executed" })).toEqual({ screen: "Life", focus: { disposition: APP_ID } });
    expect(landingOf({ screen: "Life", judgment_id: "nope", kind: "judgment_result" })).toEqual({ screen: "Life" });
    // Returning ends the residence: no block to wash.
    expect(landingOf({ screen: "Life", kind: "residence_returned" })).toEqual({ screen: "Life" });
  });

  it("a judgment push washes that judgment's row on the life page, and only that one", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    const judgment = (id: string) => ({ id, court: "第五殿", judge: null, verdict: null, is_final: false });
    signedIn({ "/me/life/": { status: 200, data: life(1, { judgments: [judgment(APP_ID), judgment(OTHER)] }) } });
    renderApp();
    await screen.findByTestId("profile-card");
    tap({ screen: "Life", judgment_id: APP_ID, kind: "judgment_result" });
    await waitFor(() => expect(route()).toMatchObject({ name: "Life", params: { lifeFocus: { judgment: APP_ID } } }));
    expect(within(await screen.findByTestId(`judgment-${APP_ID}`)).getByTestId("landing-wash")).toBeTruthy();
    expect(within(screen.getByTestId(`judgment-${OTHER}`)).queryByTestId("landing-wash")).toBeNull();
  });

  it("opens the application it names, with the landing highlight", async () => {
    signedIn({ [`/me/rebirth-applications/${APP_ID}/`]: { status: 200, data: application({ id: APP_ID, status: "REJECTED", current_step: null }) } });
    renderApp();
    await screen.findByTestId("profile-card");
    tap({ screen: "ApplicationDetail", application_id: APP_ID, kind: "rebirth_rejected" });
    expect(await screen.findByTestId("landing-highlight")).toBeTruthy();
    expect(route()).toMatchObject({ name: "ApplicationDetail", params: { id: APP_ID, landed: true } });
    expect(screen.getByTestId("landing-tag").props.children).toBe("新结果");
    // The 3px rule is not part of the fade: it is a plain View, never animated away.
    expect(StyleSheet.flatten(screen.getByTestId("landing-rule").props.style)).toMatchObject({ width: 3 });
    expect(StyleSheet.flatten(screen.getByTestId("landing-rule").props.style).opacity).toBeUndefined();
  });

  it("residence_approved (the dispatch-approval kind) lands on the life tab", async () => {
    signedIn({ "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } } });
    renderApp();
    await screen.findByTestId("profile-card");
    await pressTab("tab-Applications");
    await screen.findByTestId("eligibility");
    tap({ screen: "Life", kind: "residence_approved" });
    await waitFor(() => expect(route()?.name).toBe("Life"));
    await settleTabs(); // the tap switched tabs
  });

  it("an application opened by hand is not highlighted", async () => {
    signedIn({ "/me/rebirth-applications/a1/": { status: 200, data: application() } });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("ApplicationDetail", { id: "a1" }));
    await screen.findByTestId("application-detail");
    expect(screen.queryByTestId("landing-highlight")).toBeNull();
  });

  it("an unknown screen (another branch's kind) leaves the app where it is, without an error", async () => {
    signedIn({ "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } } });
    renderApp();
    await screen.findByTestId("profile-card");
    await pressTab("tab-Applications");
    await screen.findByTestId("eligibility");
    tap({ screen: "Chat", kind: "dm_received", room: "!x" });
    await act(async () => {});
    expect(route()?.name).toBe("Applications");
    expect(screen.queryByTestId("failure")).toBeNull();
  });

  it("the tap that cold-started the app lands once the session is back — and only once", async () => {
    system.lastResponse = {
      notification: { request: { identifier: "cold-1", content: { data: { screen: "ApplicationDetail", application_id: APP_ID } } } },
    };
    const calls = signedIn({ [`/me/rebirth-applications/${APP_ID}/`]: { status: 200, data: application({ id: APP_ID }) } });
    const first = renderApp();
    expect(await screen.findByTestId("landing-highlight")).toBeTruthy();
    // Cleared on the OS side too: a JS reload empties HANDLED_TAPS, the OS's copy survives it.
    expect(system.lastResponse).toBeNull();
    // Some platforms hand the cold-start tap to the listener as well: same id, no second landing.
    act(() => {
      for (const listener of system.responseListeners)
        listener({ notification: { request: { identifier: "cold-1", content: { data: { screen: "Life" } } } } });
    });
    await act(async () => {});
    expect(route()?.name).toBe("ApplicationDetail");
    first.unmount();
    // The navigator mounts again (retryBoot does this; so did Fast Refresh on the simulator,
    // where the old tap re-landed another soul on 周芸's application): no second landing.
    renderApp();
    await screen.findByTestId("profile-card");
    await act(async () => {});
    expect(route()?.name).toBe("Life");
    expect(calls.filter((c) => c.url === `/me/rebirth-applications/${APP_ID}/`)).toHaveLength(1);
  });

  it("a tap that meets the login screen lands after sign-in, not before", async () => {
    stubApi({
      "/soul-auth/login/": { status: 200, data: { access: "A", refresh: "R", soul_code: PROFILE.soul_code, account: PROFILE.account } },
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      [`/me/rebirth-applications/${APP_ID}/`]: { status: 200, data: application({ id: APP_ID }) },
    });
    renderApp();
    await screen.findByTestId("login-submit");
    tap({ screen: "ApplicationDetail", application_id: APP_ID });
    await act(async () => {});
    expect(route()?.name).toBe("Login");
    fireEvent.changeText(screen.getByTestId("login-soul-code"), PROFILE.soul_code);
    fireEvent.changeText(screen.getByTestId("login-password"), "a-password");
    fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("landing-highlight")).toBeTruthy();
  });
});

describe("about / credits (spec v2 C16)", () => {
  it("settings opens it; a licence opens in the browser; no seal-edge scans, no v2 seal faces", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-about"));
    await screen.findByTestId("about");
    expect(route()?.name).toBe("About");

    fireEvent.press(within(screen.getByTestId("credit-Archivo")).getByText("SIL Open Font License 1.1 ↗\uFE0E"));
    expect(open).toHaveBeenCalledWith("https://openfontlicense.org/open-font-license-official-text/");
    // The four museum scans masked only v2's filled seal, which ships nowhere since 2026-10-03.
    expect(screen.queryByTestId("credit-Museo Egizio, Torino")).toBeNull();
    expect(screen.queryByText("The Metropolitan Museum of Art")).toBeNull();
    expect(screen.queryByText(/CC0|CC BY/)).toBeNull();
    // 纹样一节(Owen Jones)随 v2 匾纹带与分节纹一起撤掉(2026-10-03)。
    expect(screen.queryByText("Owen Jones")).toBeNull();
    expect(screen.getByText("Noto Sans Egyptian Hieroglyphs")).toBeTruthy();
    // v2 朱印's other three glyph faces ship nowhere since 2026-10-03, so they are not credited.
    for (const font of ["LXGW Seal", "UnifrakturMaguntia", "GFS Didot"]) expect(screen.queryByText(font)).toBeNull();
    open.mockRestore();
    await act(async () => {});
  });

  it("open-source groups start collapsed and open on tap; texts and services are listed", async () => {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-about"));
    await screen.findByTestId("about");

    for (const group of ["server", "web", "app", "shared"]) {
      expect(screen.getByTestId(`oss-${group}-toggle`).props.accessibilityState).toEqual({ expanded: false });
    }
    expect(screen.queryByTestId("oss-app-expo")).toBeNull();
    fireEvent.press(screen.getByTestId("oss-app-toggle"));
    expect(within(screen.getByTestId("oss-app-expo")).getByText("MIT")).toBeTruthy();
    expect(screen.queryByTestId("oss-app-@soulledger/core")).toBeNull();

    expect(within(screen.getByTestId("literature-Inferno IV-XXXIV")).getByText(/Longfellow 1867 translation/)).toBeTruthy();
    expect(within(screen.getByTestId("literature-《抱朴子·微旨》")).getByText("参照")).toBeTruthy();
    expect(within(screen.getByTestId("literature-《太微仙君功過格》")).queryByText("参照")).toBeNull();
    expect(within(screen.getByTestId("service-Anthropic Claude")).getByText("默认")).toBeTruthy();
    expect(within(screen.getByTestId("service-OpenAI Chat Completions")).queryByText("默认")).toBeNull();
    expect(screen.getByText("均按部署配置")).toBeTruthy();
    expect(screen.getByText("Claude Design")).toBeTruthy();
    await act(async () => {});
  });
});

describe("changing the password from settings", () => {
  it("opens the same screen by choice, hides the first-login story, and returns to settings on success", async () => {
    const calls = signedIn({ "POST /me/password/": { status: 200, data: { access: "A2", refresh: "R2" } } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-change-password"));
    await screen.findByTestId("old-password");
    expect(route()?.name).toBe("AccountPassword");
    // Not the forced flow: no first-login intro, no way "back to login".
    expect(screen.queryByText(/72/)).toBeNull();
    expect(screen.queryByText("返回登录")).toBeNull();

    fireEvent.changeText(screen.getByTestId("old-password"), "old-secret");
    fireEvent.changeText(screen.getByTestId("new-password"), "new-secret-123");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "new-secret-123");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await screen.findByTestId("settings");
    expect(route()?.name).toBe("Settings");
    expect(calls.find((c) => c.url === "/me/password/")?.body).toEqual({ old_password: "old-secret", new_password: "new-secret-123" });
    await act(async () => {});
  });
});

describe("the password checklist on the change-password screen (Design 第二十三批)", () => {
  async function openChange(extra: Record<string, Reply | Reply[]> = {}) {
    const calls = signedIn(extra);
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-change-password"));
    await screen.findByTestId("old-password");
    return calls;
  }
  const mark = (id: string) => screen.getByTestId(`pw-rules-${id}-mark`, { includeHiddenElements: true }).props.children as string;
  const matchMark = () => screen.getByTestId("pw-match-mark", { includeHiddenElements: true }).props.children as string;
  const posts = (calls: { url: string }[]) => calls.filter((c) => c.url === "/me/password/");

  it("lists three rows on arrival, all ○, and the old 「至少 8 位」 hint under the box is gone", async () => {
    await openChange();
    expect([mark("min_length"), mark("not_digits"), mark("not_current")]).toEqual(["○", "○", "○"]);
    expect(matchMark()).toBe("○");
    // The words 「至少 8 位」 are now the first row, and only that row: the hint line under the box is not also there.
    expect(screen.getAllByText("至少 8 位")).toHaveLength(1);
    expect(within(screen.getByTestId("pw-rules-min_length")).getByText("至少 8 位")).toBeTruthy();
  });

  it("ticks while typing without ever showing !, turns unmet into ! on leaving the box, and ticks again at once", async () => {
    await openChange();
    fireEvent.changeText(screen.getByTestId("old-password"), "old-secret");
    fireEvent.changeText(screen.getByTestId("new-password"), "old");
    expect([mark("min_length"), mark("not_digits"), mark("not_current")]).toEqual(["○", "✓", "✓"]);
    fireEvent(screen.getByTestId("new-password"), "blur");
    expect([mark("min_length"), mark("not_digits"), mark("not_current")]).toEqual(["!", "✓", "✓"]);
    fireEvent.changeText(screen.getByTestId("new-password"), "old-secret");
    expect([mark("min_length"), mark("not_digits"), mark("not_current")]).toEqual(["✓", "✓", "!"]);
    fireEvent.changeText(screen.getByTestId("new-password"), "new-secret-123");
    expect([mark("min_length"), mark("not_digits"), mark("not_current")]).toEqual(["✓", "✓", "✓"]);
  });

  it("saving with something unmet sends nothing and shows it as !; the old one-sentence local errors are gone", async () => {
    const calls = await openChange();
    fireEvent.changeText(screen.getByTestId("old-password"), "old-secret");
    fireEvent.changeText(screen.getByTestId("new-password"), "short");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "other");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await act(async () => {});
    expect(posts(calls)).toEqual([]);
    expect(mark("min_length")).toBe("!");
    expect(matchMark()).toBe("!");
    expect(screen.queryByTestId("change-password-error")).toBeNull();
    expect(screen.queryByText("新密码至少 8 位")).toBeNull();
    expect(screen.queryByText("两次输入的新密码不一致")).toBeNull();
  });

  it("saving without the current password sends nothing", async () => {
    const calls = await openChange();
    fireEvent.changeText(screen.getByTestId("new-password"), "new-secret-123");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "new-secret-123");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await act(async () => {});
    expect(posts(calls)).toEqual([]);
    expect(mark("not_current")).toBe("!");
  });

  it("the server refusing it as too common is said above the list, the ticks stay, and the old 「强度不足」 sentence is not shown", async () => {
    const calls = await openChange({ "POST /me/password/": { status: 400, data: { error: "x", code: "weak_password" } } });
    fireEvent.changeText(screen.getByTestId("old-password"), "old-secret");
    fireEvent.changeText(screen.getByTestId("new-password"), "password123");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "password123");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await screen.findByTestId("pw-rules-common");
    expect(posts(calls)).toHaveLength(1);
    expect(screen.getByText("! 这个密码太容易被猜到")).toBeTruthy();
    expect(screen.getByText("它在常见密码名单里，或和你的名字、编号太像。换一个再保存。")).toBeTruthy();
    expect([mark("min_length"), mark("not_digits"), mark("not_current"), matchMark()]).toEqual(["✓", "✓", "✓", "✓"]);
    expect(screen.queryByText(/强度不足/)).toBeNull();
    expect(screen.queryByTestId("change-password-error")).toBeNull();
    expect(screen.getByTestId("new-password").props.value).toBe("password123");
    expect(screen.getByTestId("confirm-password").props.value).toBe("password123");
  });
});

describe("the Android notification channel (RBAC A9)", () => {
  it("shows nothing of a notification's content on the lock screen", async () => {
    const { Platform } = jest.requireActual<typeof import("react-native")>("react-native");
    const os = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const channel = jest.spyOn(Notifications, "setNotificationChannelAsync");
    const removed = jest.spyOn(Notifications, "deleteNotificationChannelAsync");
    try {
      await requestPermission();
      expect(channel).toHaveBeenCalledWith("default-v2", expect.objectContaining({ lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE }));
      expect(channel).not.toHaveBeenCalledWith("default-v2", expect.objectContaining({ lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC }));
      // Visibility is fixed when a channel is created: the pre-A9 "default" is not re-made, it is removed.
      expect(channel).not.toHaveBeenCalledWith("default", expect.anything());
      expect(removed).toHaveBeenCalledWith("default");
    } finally {
      channel.mockRestore();
      removed.mockRestore();
      Object.defineProperty(Platform, "OS", { value: os, configurable: true });
    }
  });
});

describe("an answer that lands after requestPermissionsAsync returned (EMUI, phone QA 10-29b)", () => {
  afterEach(() => jest.useRealTimers());

  it("is waited for: granted, not denied; one never given stays undetermined", async () => {
    jest.useFakeTimers();
    system.answer = "undetermined";
    const asked = requestPermission();
    await jest.advanceTimersByTimeAsync(600);
    system.status = "granted";
    await jest.advanceTimersByTimeAsync(600);
    await expect(asked).resolves.toBe("granted");

    Object.assign(system, { status: "undetermined", answer: "undetermined" });
    const unanswered = requestPermission();
    await jest.advanceTimersByTimeAsync(5000);
    await expect(unanswered).resolves.toBe("undetermined");
  });

  it("a refusal is returned at once", async () => {
    system.answer = "denied";
    await expect(requestPermission()).resolves.toBe("denied");
  });
});
