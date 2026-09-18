/**
 * Round 4's settings page and round 3's push, through the real navigator and
 * core's real soul client. The system side of push (permission, token, taps)
 * is the `expo-notifications` double in jest.setup.js; the EAS project id is
 * `expo-constants`' — absent unless a test sets it, as in a development build.
 */
import { LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { PRIMER_SEEN_KEY, PUSH_TOKEN_KEY, landingOf, registerDevice } from "../push";
import { SessionProvider } from "../session";
import { PROFILE, application, life, stubApi, type Reply } from "./stubApi";

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

const APP_ID = "3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const SETTINGS = { rebirth: true, judgment: true, residence: true, locale: "zh-Hans" };
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
  secure.clear();
  await AsyncStorage.clear();
  for (const key of [PUSH_TOKEN_KEY, PRIMER_SEEN_KEY, LOCALE_COOKIE]) persistentStore.remove(key);
  Object.assign(system, { status: "undetermined", answer: "granted", requests: 0, tokenError: null, lastResponse: null });
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
  });

  it("the same icon is on all three tabs", async () => {
    signedIn({
      "/me/past-lives/": { status: 200, data: [] },
      "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    for (const tab of ["tab-PastLives", "tab-Applications"]) {
      fireEvent.press(screen.getByTestId(tab));
      expect(screen.getAllByTestId("header-account").length).toBeGreaterThan(0);
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
      "Could not save this to your account. The interface is English now, but another device will show 中文."
    );
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
    await waitFor(() => expect(screen.queryByTestId("enable-push")).toBeNull());
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
    expect(landingOf({ screen: "Life", kind: "residence_approved" })).toEqual({ screen: "Life" });
    expect(landingOf({ screen: "ApplicationDetail", application_id: "../../me/" })).toEqual({ screen: "Life" });
    expect(landingOf({ screen: "ApplicationDetail" })).toEqual({ screen: "Life" });
    expect(landingOf({ screen: "Chat", kind: "dm_received" })).toBeNull();
    expect(landingOf({ kind: "rebirth_approved" })).toBeNull();
    expect(landingOf(null)).toBeNull();
    expect(landingOf("ApplicationDetail")).toBeNull();
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
    fireEvent.press(screen.getByTestId("tab-Applications"));
    await screen.findByTestId("eligibility");
    tap({ screen: "Life", kind: "residence_approved" });
    await waitFor(() => expect(route()?.name).toBe("Life"));
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
    fireEvent.press(screen.getByTestId("tab-Applications"));
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
