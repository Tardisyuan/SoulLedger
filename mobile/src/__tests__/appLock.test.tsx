/**
 * 切回 App 时也要验证 (Design 第二十八批 S2): the second switch under 面容登录, and the lock that comes up when the app
 * returns after five minutes away. Real navigator and session; the system's face / finger is the double in jest.setup.js
 * (`authenticateAsync`), and AppState is driven by hand. What the doubles cannot say -- that the OS really shows the
 * prompt over a screen with no flash of the one underneath -- is the device's to check.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LOCK_AFTER_MS } from "../appLock";
import { APP_LOCK_KEY, BIO_KEY, appLockOn, rememberAccount, spendAutoPrompt } from "../deviceLogin";
import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, life, resetLoginMemory, stubApi } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const bioMod = LocalAuthentication as unknown as { __state: { recognised: boolean; gate: Promise<void> | null; prompts: string[] } };

type Listener = (state: string) => void;
let listeners: Set<Listener>;
let offset = 0;
const realNow = Date.now.bind(Date);

/** The app goes to the background / comes back, `minutes` later by the clock. */
const background = () => act(() => void listeners.forEach((l) => l("background")));
const foreground = (minutes: number) => {
  offset += minutes * 60_000;
  return act(async () => void listeners.forEach((l) => l("active")));
};

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

function signedIn() {
  secure.set(REFRESH_TOKEN_KEY, "R");
  return stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    "GET /me/mfa/": { status: 200, data: { enabled: false } },
    "GET /me/sessions/": { status: 200, data: [] },
  });
}

/** 面容登录 on for this phone, the lock switch as given. */
function phone({ lock }: { lock: boolean }) {
  persistentStore.set(BIO_KEY, "face");
  if (lock) persistentStore.set(APP_LOCK_KEY, "1");
}

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secure.clear();
  await AsyncStorage.clear();
  bioMod.__state.recognised = true;
  listeners = new Set();
  offset = 0;
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: Listener) => {
    listeners.add(handler);
    return { remove: () => void listeners.delete(handler) };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => jest.restoreAllMocks());

describe("the switch under 面容登录", () => {
  async function openSettings() {
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    await act(async () => {});
  }

  it("is off by default, with its hint worded for the phone's face / finger", async () => {
    phone({ lock: false });
    await openSettings();
    expect(screen.getByTestId("app-lock-row").props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(screen.getByText("切回 App 时也要验证")).toBeTruthy();
    expect(screen.getByTestId("app-lock-sub").props.children).toBe("离开超过 5 分钟再回来，要先认一次面容");
    expect(appLockOn()).toBe(false);
  });

  it("cannot be used while 面容登录 is off, and a press changes nothing", async () => {
    await openSettings();
    const row = screen.getByTestId("app-lock-row");
    expect(row.props.accessibilityState).toEqual({ checked: false, disabled: true });
    fireEvent.press(row);
    expect(persistentStore.get(APP_LOCK_KEY)).toBeFalsy();
    expect(appLockOn()).toBe(false);
  });

  it("turns on and off, and what it holds is on this phone (it is read back from the phone's record)", async () => {
    phone({ lock: false });
    await openSettings();
    fireEvent.press(screen.getByTestId("app-lock-row"));
    expect(screen.getByTestId("app-lock-row").props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect(persistentStore.get(APP_LOCK_KEY)).toBe("1");
    expect(appLockOn()).toBe(true);
    fireEvent.press(screen.getByTestId("app-lock-row"));
    expect(screen.getByTestId("app-lock-row").props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(persistentStore.get(APP_LOCK_KEY)).toBeFalsy();
  });

  it("turning 面容登录 off turns it off too, and it stays off when 面容登录 comes back", async () => {
    phone({ lock: true });
    (SecureStore as unknown as { __guarded: Map<string, string> }).__guarded.set("soulledger_device_login", "cred");
    await openSettings();
    expect(screen.getByTestId("app-lock-row").props.accessibilityState).toEqual({ checked: true, disabled: false });
    fireEvent.press(screen.getByTestId("bio-row"));
    await waitFor(() => expect(screen.getByTestId("app-lock-row").props.accessibilityState).toEqual({ checked: false, disabled: true }));
    expect(persistentStore.get(APP_LOCK_KEY)).toBeFalsy();
    expect(appLockOn()).toBe(false);
    // the record is gone, so a later 面容登录 does not bring the lock back by itself
    persistentStore.set(BIO_KEY, "face");
    expect(appLockOn()).toBe(false);
  });
});

describe("the lock", () => {
  it("comes up after five minutes away, asks the system, and success lets the app back", async () => {
    phone({ lock: true });
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.queryByTestId("app-lock")).toBeNull();
    await background();
    // the cover goes up as the app leaves, so the screen underneath is never what the switcher or the return shows
    expect(screen.getByTestId("app-lock-cover")).toBeTruthy();
    expect(screen.queryByTestId("app-lock-bio")).toBeNull();
    let recognise!: () => void;
    bioMod.__state.gate = new Promise<void>((resolve) => (recognise = resolve));
    await foreground(LOCK_AFTER_MS / 60_000);
    await screen.findByTestId("app-lock");
    expect(screen.getByText("已锁定")).toBeTruthy();
    expect(screen.queryByTestId("app-lock-cover")).toBeNull();
    expect(bioMod.__state.prompts).toEqual(["用来解锁灵魂簿。"]);
    await act(async () => recognise());
    await waitFor(() => expect(screen.queryByTestId("app-lock")).toBeNull());
    expect(screen.queryByTestId("app-lock-cover")).toBeNull();
    expect(screen.getByTestId("profile-card")).toBeTruthy();
  });

  it("while locked, Android's back key is swallowed; once unlocked it is released", async () => {
    const { BackHandler } = jest.requireActual<typeof import("react-native")>("react-native");
    const added = jest.spyOn(BackHandler, "addEventListener");
    phone({ lock: true });
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await background();
    let recognise!: () => void;
    bioMod.__state.gate = new Promise<void>((resolve) => (recognise = resolve));
    const before = added.mock.calls.length;
    await foreground(LOCK_AFTER_MS / 60_000);
    await screen.findByTestId("app-lock");
    // Only listeners added once the lock came up; navigation's own listener was there before.
    const mine = added.mock.calls
      .map((c, i) => ({ c, i }))
      .slice(before)
      .filter(({ c }) => c[0] === "hardwareBackPress");
    expect(mine).toHaveLength(1);
    expect((mine[0].c[1] as () => boolean)()).toBe(true);
    const sub = added.mock.results[mine[0].i].value as { remove: () => void };
    const remove = jest.spyOn(sub, "remove");
    await act(async () => recognise());
    await waitFor(() => expect(screen.queryByTestId("app-lock")).toBeNull());
    expect(remove).toHaveBeenCalled();
    added.mockRestore();
  });

  it("does not lock on a brief switch: under five minutes the cover comes down and nothing is asked", async () => {
    phone({ lock: true });
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await background();
    await foreground(4.9);
    expect(screen.queryByTestId("app-lock")).toBeNull();
    expect(screen.queryByTestId("app-lock-cover")).toBeNull();
    expect(bioMod.__state.prompts).toEqual([]);
  });

  it("does not lock, even after an hour away, when the switch is off", async () => {
    phone({ lock: false });
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    await background();
    expect(screen.queryByTestId("app-lock-cover")).toBeNull();
    await foreground(60);
    expect(screen.queryByTestId("app-lock")).toBeNull();
    expect(bioMod.__state.prompts).toEqual([]);
  });

  it("does not lock on a first launch: nothing has left the foreground yet", async () => {
    phone({ lock: true });
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.queryByTestId("app-lock")).toBeNull();
    expect(screen.queryByTestId("app-lock-cover")).toBeNull();
    expect(bioMod.__state.prompts).toEqual([]);
    // a return that was never preceded by a departure is not a return
    await foreground(60);
    expect(screen.queryByTestId("app-lock")).toBeNull();
  });

  it("when the face is not recognised it stays locked, says so, offers another try and 「输入密码」, which is the sign-in page's way", async () => {
    phone({ lock: true });
    rememberAccount(PROFILE.soul_code, PROFILE.name);
    spendAutoPrompt();
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    bioMod.__state.recognised = false;
    await background();
    await foreground(6);
    await screen.findByTestId("app-lock-failed");
    expect(screen.getByTestId("app-lock")).toBeTruthy();
    expect(screen.getByText("面容没认出，请输入密码。")).toBeTruthy();
    // another try works once the face is recognised
    bioMod.__state.recognised = true;
    // Inside an async act: the unlock resolves after an await, and a state change made there outside act is
    // rendered whenever the scheduler gets to it (seconds under load) rather than before the next line.
    await act(async () => void fireEvent.press(screen.getByTestId("app-lock-bio")));
    await waitFor(() => expect(screen.queryByTestId("app-lock")).toBeNull());
  });

  it("「输入密码」 leaves the lock for the sign-in page's password path", async () => {
    phone({ lock: true });
    rememberAccount(PROFILE.soul_code, PROFILE.name);
    spendAutoPrompt();
    signedIn();
    renderApp();
    await screen.findByTestId("profile-card");
    bioMod.__state.recognised = false;
    await background();
    await foreground(6);
    fireEvent.press(await screen.findByTestId("app-lock-use-password"));
    await screen.findByTestId("login-bio");
    expect(screen.queryByTestId("app-lock")).toBeNull();
    expect(screen.queryByTestId("profile-card")).toBeNull();
    fireEvent.press(screen.getByTestId("login-use-password"));
    await screen.findByTestId("login-password");
  });
});
