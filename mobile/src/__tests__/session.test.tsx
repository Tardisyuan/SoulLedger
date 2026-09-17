/**
 * The session rules end to end: real providers, real navigator, core's real
 * soul client, the mobile platform ports — only the network and the two native
 * stores are doubles.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, sessionStore } from "../platform";
import { SessionProvider } from "../session";
import { paletteFor } from "../theme";
import { PROFILE, life, stubApi } from "./stubApi";

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
  it("401 whose refresh the server refuses → back to the login stack, tokens gone", async () => {
    secure.set(REFRESH_TOKEN_KEY, "stale");
    stubApi({
      "/me/": { status: 401, data: { code: "token_not_valid" } },
      "/soul-auth/refresh/": { status: 401, data: { code: "token_not_valid" } },
    });
    renderApp();
    await screen.findByTestId("login-submit");
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull();
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
    stubApi({ "/me/": { status: 200, data: { ...PROFILE, civilization: "EGYPTIAN" } }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    const card = await screen.findByTestId("profile-card");
    const style = [card.props.style].flat(3).reduce((acc: object, s: object) => ({ ...acc, ...s }), {});
    expect(style).toMatchObject({ backgroundColor: paletteFor("EGYPTIAN", "light").surface1 }); // jest reports a light colour scheme
    expect(paletteFor("EGYPTIAN", "light").surface1).not.toBe(paletteFor(null, "light").surface1);
  });

  it("sign-out clears the secure store and returns to login", async () => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const calls = stubApi({
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "/soul-auth/logout/": { status: 204 },
    });
    renderApp();
    fireEvent.press(await screen.findByTestId("logout"));
    await screen.findByTestId("login-submit");
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url === "/soul-auth/logout/")).toBe(true));
  });
});
