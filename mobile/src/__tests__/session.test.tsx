/**
 * The session rules end to end: real providers, real navigator, core's real
 * soul client, the mobile platform ports — only the network and the two native
 * stores are doubles.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { OUTBOX_KEY } from "../chat";
import { installMobilePlatform, persistentStore, sessionStore } from "../platform";
import { SessionProvider } from "../session";
import { themeFor } from "../theme";
import { PROFILE, application, heldReply, life, pressTab, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

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

beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  sessionStore.remove("soulledger_access");
  await AsyncStorage.clear();
});

async function signIn(mustChange: boolean) {
  fireEvent.changeText(screen.getByTestId("login-soul-code"), "SL-CN-000042");
  fireEvent.changeText(screen.getByTestId("login-password"), "initial-pass");
  fireEvent.press(screen.getByTestId("login-submit"));
  if (mustChange) await screen.findByTestId("change-password-submit");
}

describe("login", () => {
  it("stores the refresh token in the secure store and nothing in AsyncStorage", async () => {
    stubApi({
      "/soul-auth/login/": {
        status: 200,
        data: { access: "A", refresh: "R", soul_code: "SL-CN-000042", account: { ...PROFILE.account, must_change_password: true } },
      },
    });
    renderApp();
    await signIn(true);
    expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R");
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("must_change_password mounts ONLY the change-password screen", async () => {
    stubApi({
      "/soul-auth/login/": {
        status: 200,
        data: { access: "A", refresh: "R", soul_code: "SL-CN-000042", account: { ...PROFILE.account, must_change_password: true } },
      },
    });
    renderApp();
    await signIn(true);
    expect(navigationRef.getRootState()?.routeNames).toEqual(["ChangePassword"]);
    expect(screen.queryByText("本世")).toBeNull();
    expect(screen.queryByText("前世")).toBeNull();
    expect(screen.queryByTestId("login-submit")).toBeNull();
  });

  it("after the password change the new token pair replaces the old one and the tabs appear", async () => {
    const calls = stubApi({
      "/soul-auth/login/": {
        status: 200,
        data: { access: "A", refresh: "R", soul_code: "SL-CN-000042", account: { ...PROFILE.account, must_change_password: true } },
      },
      "/me/password/": { status: 200, data: { access: "A2", refresh: "R2" } },
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
    });
    renderApp();
    await signIn(true);
    fireEvent.changeText(screen.getByTestId("old-password"), "initial-pass");
    fireEvent.changeText(screen.getByTestId("new-password"), "a-new-password");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "a-new-password");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await screen.findByTestId("profile-card");
    expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R2");
    expect(calls.find((c) => c.url === "/me/password/")?.body).toEqual({
      old_password: "initial-pass",
      new_password: "a-new-password",
    });
  });

  it("shows the server's refusal as copy, not as a code", async () => {
    stubApi({ "/soul-auth/login/": { status: 401, data: { detail: "x", code: "initial_password_expired" } } });
    renderApp();
    await signIn(false);
    expect((await screen.findByTestId("login-error")).props.children).toBe("初始密码已过期,请联系官员重置");
  });
});

describe("a stored session", () => {
  /**
   * The refusal that ends the session is held until the refresh is on the wire, then given inside act().
   * Waiting for the login screen instead failed two ways under load (2026-09-24, 12 busy processes on
   * 4 cores). The first was a findBy past its budget with login-submit already in the tree it printed.
   * The second was findBy passing on the commit that swaps the stacks, with the navigator's follow-up
   * (BaseNavigationContainer, PreventRemoveProvider) landing after it, outside act. act() flushes the
   * answer and all that follows before it returns.
   */
  async function refuseRefresh(calls: { url: string }[], refresh: ReturnType<typeof heldReply>) {
    await waitFor(() => expect(calls.some((c) => c.url === "/soul-auth/refresh/")).toBe(true));
    await act(async () => refresh.answer({ status: 401, data: { code: "token_not_valid" } }));
  }

  it("401 whose refresh the server refuses → back to the login stack, tokens gone", async () => {
    secure.set(REFRESH_TOKEN_KEY, "stale");
    const refresh = heldReply();
    const calls = stubApi({
      "/me/": { status: 401, data: { code: "token_not_valid" } },
      "/soul-auth/refresh/": refresh.reply,
    });
    renderApp();
    await refuseRefresh(calls, refresh);
    expect(screen.getByTestId("login-submit")).toBeOnTheScreen();
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull();
  });

  it("a 401 on a LATER request (not the boot /me/) also returns to login — that path is onUnauthorized alone", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const refresh = heldReply();
    const calls = stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 401, data: { code: "token_not_valid" } },
      "/soul-auth/refresh/": refresh.reply,
    });
    renderApp();
    await refuseRefresh(calls, refresh);
    expect(screen.getByTestId("login-submit")).toBeOnTheScreen();
    expect(screen.queryByTestId("profile-card")).not.toBeOnTheScreen();
  });

  it("a session that expires on its own (401) takes the unsent letters off the device too", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const letter = { txnId: "t1", conversationId: "c1", roomId: "!r", body: "枯树那边风大", ts: 1, state: "queued" };
    persistentStore.set(OUTBOX_KEY, JSON.stringify({ owner: PROFILE.soul_code, device: "DEV1", items: [letter] }));
    const refresh = heldReply();
    const calls = stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 401, data: { code: "token_not_valid" } },
      "/soul-auth/refresh/": refresh.reply,
      "/me/chat/conversations/": "offline",
      "/me/chat/session/": "offline",
    });
    renderApp();
    await refuseRefresh(calls, refresh);
    expect(screen.getByTestId("login-submit")).toBeOnTheScreen();
    expect(persistentStore.get(OUTBOX_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it("offline at start-up → a retry screen, and the session is kept", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    stubApi({ "/me/": "offline" });
    renderApp();
    expect((await screen.findByTestId("failure")).props.children).toBe("无法连接服务器,请检查网络后重试");
    expect(screen.queryByTestId("login-submit")).toBeNull();
    expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R");
  });

  it("403 password_change_required from ANY /me call routes to the change-password screen", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    sessionStore.set("soulledger_access", "A");
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 403, data: { code: "password_change_required" } },
    });
    renderApp();
    await screen.findByTestId("change-password-submit");
    expect(screen.queryByTestId("profile-card")).toBeNull();
  });

  it("skins the app by the soul's civilization", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    // /me/ is answered inside act(): profile-card is on the signed-in tree's FIRST commit, so a findBy for
    // it passed while that tree's mount effects were still queued, and they landed after the test (act()
    // warnings from RootNavigator, MyLifeScreen, PastLivesSection, ChatProvider: 1 of 20 loaded full runs).
    const me = heldReply();
    stubApi({ "/me/": me.reply, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    await act(async () => me.answer({ status: 200, data: { ...PROFILE, civilization: "EGYPTIAN" } }));
    const card = screen.getByTestId("profile-card");
    const style = [card.props.style].flat(3).reduce((acc: object, s: object) => ({ ...acc, ...s }), {});
    expect(style).toMatchObject({ backgroundColor: themeFor("EGYPTIAN", "light").s0 }); // jest reports a light colour scheme
    expect(themeFor("EGYPTIAN", "light").s0).not.toBe(themeFor(null, "light").s0);
    // …and relabels the two scores from Egypt's lexicon, keeping the server's numbers.
    expect(screen.getByText("羽侧")).toBeTruthy();
    expect(screen.queryByText("功")).toBeNull();
    expect(screen.getByText(String(PROFILE.merit_score))).toBeTruthy();
  });

  it("returning to the life tab reloads it — an application submitted elsewhere shows up", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": [
        { status: 200, data: life(1) },
        { status: 200, data: life(1, { rebirth_applications: [application()] }) },
      ],
      "/me/rebirth-applications/": {
        status: 200,
        data: { can_apply: false, reason: "application_open", cooldown_until: null, results: [application()] },
      },
    });
    renderApp();
    // The applications section starts collapsed (only merits/demerits open by default).
    fireEvent.press(await screen.findByTestId("section-applications-toggle"));
    await screen.findByText("这一世没有转生申请");
    // By testID: the tab label also appears as the header title and a section heading.
    await pressTab("tab-Applications");
    await screen.findByTestId("eligibility");
    await pressTab("tab-Life");
    await screen.findByText("审批中");
    expect(screen.queryByText("这一世没有转生申请")).toBeNull();
  });

  it("sign-out clears the secure store and returns to login", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const calls = stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/soul-auth/logout/": { status: 204 },
      "/me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, locale: "zh-Hans" } },
    });
    renderApp();
    // Round 4: sign-out lives at the end of the settings page, reached from the header icon.
    fireEvent.press(await screen.findByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("logout"));
    // Signing out asks first; nothing is cleared until the choice is confirmed.
    await screen.findByTestId("confirm-sheet");
    expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R");
    fireEvent.press(screen.getByTestId("logout-confirm"));
    await screen.findByTestId("login-submit");
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url === "/soul-auth/logout/")).toBe(true));
  });

  it("sign-out takes this soul's unsent letters off the device", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const letter = { txnId: "t1", conversationId: "c1", roomId: "!r", body: "枯树那边风大", ts: 1, state: "queued" };
    persistentStore.set(OUTBOX_KEY, JSON.stringify({ owner: PROFILE.soul_code, device: "DEV1", items: [letter] }));
    stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/soul-auth/logout/": { status: 204 },
      "/me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, locale: "zh-Hans" } },
      // Chat unreachable: the letter stays queued, on disk, until sign-out.
      "/me/chat/conversations/": "offline",
      "/me/chat/session/": "offline",
    });
    renderApp();
    fireEvent.press(await screen.findByTestId("header-account"));
    expect(JSON.parse(persistentStore.get(OUTBOX_KEY) ?? "null")?.items).toHaveLength(1);
    fireEvent.press(await screen.findByTestId("logout"));
    fireEvent.press(await screen.findByTestId("logout-confirm"));
    await screen.findByTestId("login-submit");
    expect(persistentStore.get(OUTBOX_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(OUTBOX_KEY)).toBeNull();
  });
});
