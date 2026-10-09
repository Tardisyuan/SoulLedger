/**
 * Sign-in with no hall: straight in; or a 「选殿」 step after 409 hall_required; or a code step
 * after mfa_required + pending_token. Driven through the real SessionProvider with core's auth
 * endpoints replaced.
 */
import { Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LoginScreen } from "../screens/login";
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, platform } from "@soulledger/core/platform";
import { SessionProvider, USER_KEY, useSession } from "../session";
import { I18nProvider, ThemeContext, themeFor } from "../shared";
import { OFFICER, httpError } from "./harness";

const mockOfficerLogin = jest.fn();
const mockVerify = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: {
    officerLogin: (...a: unknown[]) => mockOfficerLogin(...a),
    profile: jest.fn(async () => ({ data: {} })),
    logout: jest.fn(async () => ({})),
  },
  mfaApi: { verify: (...a: unknown[]) => mockVerify(...a) },
}));

function renderLogin() {
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
            <LoginScreen />
          </SessionProvider>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
  return () => latest!;
}

const TOKENS = { access: "A", refresh: "R", user: OFFICER };

function fill(user = "yama", password = "pw") {
  fireEvent.changeText(screen.getByTestId("login-username"), user);
  fireEvent.changeText(screen.getByTestId("login-password"), password);
}

// A sign-in lands tokens and the profile in the platform stores, and SessionProvider starts
// signed in when it finds them -- so each test begins from an empty device.
beforeEach(() => {
  jest.clearAllMocks();
  platform().persistent.remove(USER_KEY);
  platform().session.remove(ACCESS_TOKEN_KEY);
  platform().secure.remove(REFRESH_TOKEN_KEY);
});

it("signs in with a username and password and no hall", async () => {
  mockOfficerLogin.mockResolvedValue({ data: TOKENS });
  const session = renderLogin();
  fill();
  fireEvent.press(screen.getByTestId("login-submit"));
  await waitFor(() => expect(session().state.status).toBe("signedIn"));
  expect(mockOfficerLogin).toHaveBeenCalledWith({ username: "yama", password: "pw" });
});

it("asks which hall after 409 hall_required, then signs in again with that tenant_code", async () => {
  mockOfficerLogin
    .mockRejectedValueOnce(httpError(409, { code: "hall_required", detail: "x", halls: [{ code: "CN", display_name: "中国地府" }, { code: "EG", display_name: "埃及杜阿特" }] }))
    .mockResolvedValueOnce({ data: TOKENS });
  const session = renderLogin();
  fill();
  fireEvent.press(screen.getByTestId("login-submit"));
  expect(await screen.findByTestId("login-halls")).toBeTruthy();
  fireEvent.press(screen.getByTestId("hall-EG"));
  await waitFor(() => expect(session().state.status).toBe("signedIn"));
  expect(mockOfficerLogin).toHaveBeenLastCalledWith({ username: "yama", password: "pw", tenant_code: "EG" });
});

it("goes on to the code step on mfa_required, and verifies with the pending token", async () => {
  mockOfficerLogin.mockResolvedValue({ data: { mfa_required: true, pending_token: "P", username: "yama" } });
  mockVerify.mockResolvedValue({ data: TOKENS });
  const session = renderLogin();
  fill();
  fireEvent.press(screen.getByTestId("login-submit"));
  expect(await screen.findByTestId("login-mfa")).toBeTruthy();
  expect(session().state.status).toBe("signedOut");
  fireEvent.changeText(screen.getByTestId("mfa-code"), "123456");
  fireEvent.press(screen.getByTestId("mfa-submit"));
  await waitFor(() => expect(session().state.status).toBe("signedIn"));
  expect(mockVerify).toHaveBeenCalledWith({ pending_token: "P", code: "123456" });
});

it("can switch to a recovery code, and says so when the code is wrong", async () => {
  mockOfficerLogin.mockResolvedValue({ data: { mfa_required: true, pending_token: "P", username: "yama" } });
  mockVerify.mockRejectedValue(httpError(401, { code: "wrong" }));
  renderLogin();
  fill();
  fireEvent.press(screen.getByTestId("login-submit"));
  await screen.findByTestId("login-mfa");
  fireEvent.press(screen.getByTestId("mfa-toggle"));
  fireEvent.changeText(screen.getByTestId("mfa-code"), "ABCD-EFGH");
  await act(async () => {
    fireEvent.press(screen.getByTestId("mfa-submit"));
  });
  expect(mockVerify).toHaveBeenCalledWith({ pending_token: "P", recovery_code: "ABCD-EFGH" });
  expect(await screen.findByTestId("login-failure")).toBeTruthy();
});

it("says the password was wrong and stays on the form", async () => {
  mockOfficerLogin.mockRejectedValue(httpError(401, { code: "invalid" }));
  renderLogin();
  fill();
  await act(async () => {
    fireEvent.press(screen.getByTestId("login-submit"));
  });
  expect(await screen.findByText("! 用户名或密码不对")).toBeTruthy();
  expect(screen.getByTestId("login-username")).toBeTruthy();
});

it("忘记密码 opens the desk's request page in the browser and does nothing else", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  renderLogin();
  fireEvent.press(screen.getByTestId("login-forgot"));
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\/.+\/forgot-password$/));
  expect(mockOfficerLogin).not.toHaveBeenCalled();
  open.mockRestore();
});
