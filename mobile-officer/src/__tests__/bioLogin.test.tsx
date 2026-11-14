/**
 * 指纹登录 (2026-11-15 便捷度研究 O5 / O7): the sign-in page offers the fingerprint first for the remembered officer
 * and drops a credential the server no longer takes; 「换一个账号」 revokes it; the 我的 switch turns it on with the
 * current password and off with a revoke; 「下次用指纹登录？」 uses the password just typed; the app lock covers a
 * resumed session and a return after five minutes. Real SessionProvider; core's auth endpoints and the phone's
 * fingerprint are doubles (jest.setup.js).
 */
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, platform } from "@soulledger/core/platform";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import type { ReactElement } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppLock, LOCK_AFTER_MS } from "../appLock";
import { BioAsk, BioLoginBlock } from "../bioLogin";
import { BIO_ASKED_PREFIX, BIO_LOGIN_KEY, officerDevice, resetAutoPrompt, spendAutoPrompt } from "../deviceLogin";
import { LoginScreen } from "../screens/login";
import { LAST_LOGIN_KEY, SessionProvider, USER_KEY, useSession } from "../session";
import { I18nProvider, ThemeContext, readBiometry, resetBiometryCache, themeFor } from "../shared";
import { OFFICER, httpError, renderOfficer, sessionOf } from "./harness";

const mockOfficerLogin = jest.fn();
const mockDeviceLogin = jest.fn();
const mockEnable = jest.fn();
const mockRevoke = jest.fn(async (_credential: string) => undefined);
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: {
    officerLogin: (...a: unknown[]) => mockOfficerLogin(...a),
    officerDeviceLogin: (...a: unknown[]) => mockDeviceLogin(...a),
    enableDeviceLogin: (...a: unknown[]) => mockEnable(...a),
    revokeDeviceLogin: (credential: string) => mockRevoke(credential),
    profile: jest.fn(async () => ({ data: {} })),
    logout: jest.fn(async () => ({})),
  },
  mfaApi: { verify: jest.fn() },
}));

const CREDENTIAL_KEY = "soulledger_officer_device_login";
const guarded = (SecureStore as unknown as { __guarded: Map<string, string> }).__guarded;
const secureAuth = (SecureStore as unknown as { __auth: { error: unknown } }).__auth;
const bio = (LocalAuthentication as unknown as { __state: { enrolled: boolean; success: boolean } }).__state;
const TOKENS = { access: "A", refresh: "R", user: OFFICER };

function withProviders(ui: ReactElement) {
  let latest: ReturnType<typeof useSession> | null = null;
  function Capture() {
    latest = useSession();
    return null;
  }
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(null, "light")}>
          <SessionProvider>
            <Capture />
            {ui}
          </SessionProvider>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
  return () => latest!;
}

/** yama signed in here before and turned 指纹登录 on. */
function fingerprintOn() {
  platform().persistent.set(LAST_LOGIN_KEY, JSON.stringify({ username: "yama", display_name: "阎罗", hall: "CN_DIYU" }));
  platform().persistent.set(BIO_LOGIN_KEY, "face");
  guarded.set(CREDENTIAL_KEY, "CRED");
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of [USER_KEY, LAST_LOGIN_KEY, BIO_LOGIN_KEY, BIO_ASKED_PREFIX + "yama"]) platform().persistent.remove(key);
  platform().session.remove(ACCESS_TOKEN_KEY);
  platform().secure.remove(REFRESH_TOKEN_KEY);
  guarded.clear();
  secureAuth.error = null;
  bio.enrolled = false;
  bio.success = true;
  resetAutoPrompt();
  resetBiometryCache();
});

describe("the sign-in page", () => {
  it("asks for the fingerprint by itself and signs the remembered officer in with the credential", async () => {
    fingerprintOn();
    mockDeviceLogin.mockResolvedValue({ data: TOKENS });
    const session = withProviders(<LoginScreen />);
    await waitFor(() => expect(session().state.status).toBe("signedIn"));
    expect(mockDeviceLogin).toHaveBeenCalledWith({ username: "yama", credential: "CRED" });
    expect(mockOfficerLogin).not.toHaveBeenCalled();
  });

  it("does not offer it when it is off, or for nobody remembered", () => {
    platform().persistent.set(LAST_LOGIN_KEY, JSON.stringify({ username: "yama", display_name: "阎罗", hall: "" }));
    withProviders(<LoginScreen />);
    expect(screen.queryByTestId("login-bio")).toBeNull();
    expect(mockDeviceLogin).not.toHaveBeenCalled();
  });

  it("drops a credential the server no longer takes and says so", async () => {
    fingerprintOn();
    mockDeviceLogin.mockRejectedValue(httpError(401, { code: "device_login_revoked", reason: "password_changed" }));
    withProviders(<LoginScreen />);
    await screen.findByText("这部手机的面容登录已失效，请输入密码。");
    expect(screen.queryByTestId("login-bio")).toBeNull();
    expect(officerDevice.bioEnabled()).toBe(false);
    await waitFor(() => expect(guarded.has(CREDENTIAL_KEY)).toBe(false));
    // and says nothing about a wrong username or password
    expect(screen.queryByText("用户名或密码不对")).toBeNull();
  });

  it("a cancelled fingerprint stays quiet and leaves the button and the password", async () => {
    fingerprintOn();
    secureAuth.error = Object.assign(new Error("User canceled the operation"), { code: "ERR_CANCELED" });
    withProviders(<LoginScreen />);
    await act(async () => {});
    expect(mockDeviceLogin).not.toHaveBeenCalled();
    expect(screen.queryByTestId("login-failure")).toBeNull();
    expect(screen.getByTestId("login-bio")).toBeTruthy();
    expect(screen.getByTestId("login-password")).toBeTruthy();
  });

  it("「换一个账号」 revokes it on the server and forgets it here", async () => {
    fingerprintOn();
    spendAutoPrompt();
    withProviders(<LoginScreen />);
    fireEvent.press(screen.getByTestId("login-switch"));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("CRED"));
    expect(officerDevice.bioEnabled()).toBe(false);
    expect(screen.queryByTestId("login-bio")).toBeNull();
  });

  it("signing out keeps it", async () => {
    mockOfficerLogin.mockResolvedValue({ data: TOKENS });
    fingerprintOn();
    spendAutoPrompt();
    const session = withProviders(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId("login-password"), "pw");
    fireEvent.press(screen.getByTestId("login-submit"));
    await waitFor(() => expect(session().state.status).toBe("signedIn"));
    act(() => session().signOut());
    expect(officerDevice.bioEnabled()).toBe(true);
    expect(guarded.get(CREDENTIAL_KEY)).toBe("CRED");
  });
});

describe("我的 › 指纹登录", () => {
  it("turns on with the current password and keeps only the server's credential", async () => {
    bio.enrolled = true;
    mockEnable.mockResolvedValue("NEW");
    renderOfficer(<BioLoginBlock />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("me-bio-login"));
    fireEvent.changeText(screen.getByTestId("me-bio-password"), "pw");
    fireEvent.press(screen.getByTestId("me-bio-enable-ok"));
    await waitFor(() => expect(officerDevice.bioEnabled()).toBe(true));
    expect(mockEnable).toHaveBeenCalledWith("pw");
    expect(guarded.get(CREDENTIAL_KEY)).toBe("NEW");
    expect([...guarded.values()]).not.toContain("pw");
    expect(screen.queryByTestId("me-bio-enable")).toBeNull();
  });

  it("a wrong password says so and turns nothing on", async () => {
    bio.enrolled = true;
    mockEnable.mockRejectedValue(httpError(400, { code: "wrong_password" }));
    renderOfficer(<BioLoginBlock />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("me-bio-login"));
    fireEvent.changeText(screen.getByTestId("me-bio-password"), "nope");
    fireEvent.press(screen.getByTestId("me-bio-enable-ok"));
    expect(await screen.findByTestId("me-bio-error")).toBeTruthy();
    expect(screen.getByText("当前密码不对")).toBeTruthy();
    expect(officerDevice.bioEnabled()).toBe(false);
  });

  it("turns off with a revoke on the server", async () => {
    fingerprintOn();
    renderOfficer(<BioLoginBlock />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("me-bio-login"));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("CRED"));
    expect(officerDevice.bioEnabled()).toBe(false);
  });

  it("is greyed and does nothing on a phone with no finger or face enrolled", async () => {
    renderOfficer(<BioLoginBlock />);
    await act(async () => {});
    fireEvent.press(screen.getByTestId("me-bio-login"));
    expect(screen.queryByTestId("me-bio-enable")).toBeNull();
    expect(screen.getByText("这部手机没有录入面容或指纹")).toBeTruthy();
  });
});

describe("「下次用指纹登录？」", () => {
  it("turns it on with the password just typed, once", async () => {
    bio.enrolled = true;
    await readBiometry(); // what the password sign-in does before landing (session.tsx)
    mockEnable.mockResolvedValue("NEW");
    const dropPassword = jest.fn();
    renderOfficer(<BioAsk username="yama" />, { session: sessionOf(OFFICER, { heldPassword: () => "typed", dropPassword }) });
    fireEvent.press(await screen.findByTestId("bio-ask-ok"));
    await waitFor(() => expect(mockEnable).toHaveBeenCalledWith("typed"));
    await waitFor(() => expect(platform().persistent.get(BIO_ASKED_PREFIX + "yama")).toBe("1"));
    expect(dropPassword).toHaveBeenCalled();
  });

  it("is not asked without a typed password (a fingerprint sign-in), or once answered", async () => {
    bio.enrolled = true;
    await readBiometry();
    renderOfficer(<BioAsk username="yama" />, { session: sessionOf(OFFICER, { heldPassword: () => null }) });
    await act(async () => {});
    expect(screen.queryByTestId("bio-ask")).toBeNull();
    platform().persistent.set(BIO_ASKED_PREFIX + "yama", "1");
    renderOfficer(<BioAsk username="yama" />, { session: sessionOf(OFFICER, { heldPassword: () => "typed" }) });
    await act(async () => {});
    expect(screen.queryByTestId("bio-ask")).toBeNull();
  });
});

it("a password sign-in keeps the typed password and reads the phone before landing, so the question can come on the first frame", async () => {
  bio.enrolled = true;
  mockOfficerLogin.mockResolvedValue({ data: TOKENS });
  const session = withProviders(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId("login-username"), "yama");
  fireEvent.changeText(screen.getByTestId("login-password"), "typed");
  fireEvent.press(screen.getByTestId("login-submit"));
  await waitFor(() => expect(session().state.status).toBe("signedIn"));
  expect(session().heldPassword()).toBe("typed");
  expect(officerDevice.knownBiometry()?.enrolled).toBe(true);
});

describe("the app lock", () => {
  type Listener = (state: string) => void;
  let listeners: Set<Listener>;
  let offset = 0;
  const realNow = Date.now.bind(Date);

  beforeEach(() => {
    listeners = new Set();
    offset = 0;
    jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: Listener) => {
      listeners.add(handler);
      return { remove: () => void listeners.delete(handler) };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => jest.restoreAllMocks());

  const away = async (minutes: number) => {
    act(() => void listeners.forEach((l) => l("background")));
    offset += minutes * 60_000;
    await act(async () => void listeners.forEach((l) => l("active")));
  };

  /** A stored session resumed at start. */
  function resumed() {
    platform().persistent.set(USER_KEY, JSON.stringify(OFFICER));
    platform().secure.set(REFRESH_TOKEN_KEY, "R");
  }

  it("covers a resumed session while 指纹登录 is on, until the fingerprint passes", async () => {
    fingerprintOn();
    resumed();
    bio.success = false;
    withProviders(<AppLock />);
    expect(screen.getByTestId("app-lock")).toBeTruthy();
    expect(await screen.findByTestId("app-lock-failed")).toBeTruthy();
    bio.success = true;
    fireEvent.press(screen.getByTestId("app-lock-bio"));
    await waitFor(() => expect(screen.queryByTestId("app-lock")).toBeNull());
  });

  it("is not there at all while 指纹登录 is off", async () => {
    resumed();
    withProviders(<AppLock />);
    expect(screen.queryByTestId("app-lock")).toBeNull();
    await away(LOCK_AFTER_MS / 60_000 + 1);
    expect(screen.queryByTestId("app-lock")).toBeNull();
  });

  it("locks after five minutes away, not after less", async () => {
    fingerprintOn();
    resumed();
    withProviders(<AppLock />);
    await waitFor(() => expect(screen.queryByTestId("app-lock")).toBeNull()); // the cold-start check passed
    bio.success = false;
    await away(1);
    expect(screen.queryByTestId("app-lock")).toBeNull();
    await away(6);
    expect(screen.getByTestId("app-lock")).toBeTruthy();
  });

  it("「输入密码」 signs out the way the server would", async () => {
    fingerprintOn();
    resumed();
    bio.success = false;
    const session = withProviders(<AppLock />);
    await screen.findByTestId("app-lock-failed");
    fireEvent.press(screen.getByTestId("app-lock-use-password"));
    await waitFor(() => expect(session().state.status).toBe("signedOut"));
    expect(officerDevice.bioEnabled()).toBe(true); // the fingerprint sign-in stays for next time
  });
});
