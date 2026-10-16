/**
 * Signing in without typing the number (第二十批): the grouped box, the scanner, the account the phone remembers,
 * and 面容 / 指纹. Real providers, real navigator, core's real soul client; only the network and the native modules
 * (jest.setup.js: secure store, local authentication, camera) are doubles. What the doubles cannot say -- that the
 * Keychain / Keystore really refuse after a new face is enrolled -- is the simulator's to check.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Camera from "expo-camera";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Linking, TextInput } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ACCOUNT_KEY, ASKED_PREFIX, BIO_KEY, rememberAccount, rememberedAccount, spendAutoPrompt } from "../deviceLogin";
import { I18nProvider } from "../i18n";
import { SoulCodeField } from "../soulCodeView";
import { deviceTokenFor, rememberDevice } from "../mfa";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, persistentStore, sessionStore } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, heldReply, life, resetLoginMemory, stubApi, type Reply } from "./stubApi";

const CODE = "QU33Q9FW5F";
const GROUPED = "QU3 3Q9F W5F";
const CRED = "device-credential-1";
const SETTINGS = { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" };
const SYSTEM_REASON = "用来登录灵魂簿，不用输密码。";

const secureMod = SecureStore as unknown as {
  __store: Map<string, string>;
  __guarded: Map<string, string>;
  __auth: { error: unknown; prompts: string[] };
};
const bioMod = LocalAuthentication as unknown as { __state: { enrolled: boolean; types: number[] } };
const cameraMod = Camera as unknown as {
  __state: { permission: { status: string; granted: boolean; canAskAgain: boolean }; last: { onBarcodeScanned: (r: { data: string }) => void; barcodeScannerSettings: unknown } | null };
};

const TOKENS = { access: "A", refresh: "R", soul_code: CODE, account: PROFILE.account };
const PENDING = { mfa_required: true, pending_token: "pending-opaque-abc", soul_code: CODE, home_tenant: PROFILE.home_tenant };
const HOME: Record<string, Reply> = {
  "/me/": { status: 200, data: PROFILE },
  "/me/life/": { status: 200, data: life(1) },
  "GET /me/notification-settings/": { status: 200, data: SETTINGS },
};

/** Rendered, and the one async read of the phone's face / finger (useBiometry) has landed. */
async function renderApp() {
  const view = render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
  await act(async () => {});
  return view;
}

beforeEach(async () => {
  installMobilePlatform();
  resetLoginMemory();
  secureMod.__store.clear();
  sessionStore.remove("soulledger_access");
  await AsyncStorage.clear();
  cameraMod.__state.permission = { status: "granted", granted: true, canAskAgain: true };
  cameraMod.__state.last = null;
});

const typeCode = (text: string) => fireEvent.changeText(screen.getByTestId("login-soul-code"), text);
const typePassword = (text: string) => fireEvent.changeText(screen.getByTestId("login-password"), text);
const text = (id: string) => screen.getByTestId(id).props.children as string;

/** A phone that already knows this soul; `bio`: with 面容 / 指纹 on and the credential behind the system check. */
function remembered({ bio = false, warm = true } = {}) {
  rememberAccount(CODE, "张三");
  if (bio) {
    persistentStore.set(BIO_KEY, "face");
    secureMod.__guarded.set("soulledger_device_login", CRED);
  }
  // Not the first page of a fresh process, so the system check does not open by itself.
  if (warm) spendAutoPrompt();
}

const refusal = (code: string, reason?: string) => ({ status: 401, data: { detail: "x", code, ...(reason ? { reason } : {}) } });

/** A real Face ID miss takes the scan; an iOS lockout answers at once (`credentialReadFailure`). */
function scanTakes(ms: number) {
  let t = 0;
  jest.spyOn(Date, "now").mockImplementation(() => (t += ms));
}
afterEach(() => (Date.now as jest.Mock & { mockRestore?: () => void }).mockRestore?.());

describe("D · the number box", () => {
  it("is empty as three dotted groups, then groups what is typed: upper case, separators skipped, 3-4-3 by spacing", async () => {
    await renderApp();
    expect(screen.getByTestId("login-soul-code-placeholder", { includeHiddenElements: true })).toBeTruthy();
    typeCode("qu3-3q 9fw");
    expect(screen.queryByTestId("login-soul-code-placeholder", { includeHiddenElements: true })).toBeNull();
    expect([0, 1, 2].map((i) => screen.getByTestId(`login-soul-code-group-${i}`, { includeHiddenElements: true }).props.children)).toEqual(["QU3", "3Q9F", "W"]);
    // the characters themselves carry no space: what is held, copied and sent is the raw string
    expect(screen.getByTestId("login-soul-code").props.value).toBe("QU33Q9FW");
  });

  it("is read out character by character with a pause between groups, and asks the keyboard for the right thing", async () => {
    await renderApp();
    typeCode("QU33Q");
    const input = screen.getByTestId("login-soul-code");
    expect(input.props.accessibilityLabel).toBe("灵魂编号 Q U 3，3 Q");
    expect(input.props).toMatchObject({ keyboardType: "ascii-capable", autoCapitalize: "characters", autoCorrect: false, autoComplete: "username" });
    expect(screen.getByTestId("login-password").props.autoComplete).toBe("current-password");
  });

  it("a character no number uses is not let in: it is named, the rule is given, the next good character clears it", async () => {
    await renderApp();
    typeCode("QU");
    typeCode("QUO");
    expect(screen.getByTestId("login-soul-code").props.value).toBe("QU");
    expect(screen.getByText("! 编号里没有「O」")).toBeTruthy();
    expect(screen.getByText("编号不用 0、O、1、I、L 这五个，请对照交付单再看一下。")).toBeTruthy();
    typeCode("QU3");
    expect(screen.queryByText("! 编号里没有「O」")).toBeNull();
    expect(screen.queryByTestId("login-soul-code-problem")).toBeNull();
    expect(screen.getByTestId("login-soul-code").props.value).toBe("QU3");
  });

  it("another symbol says only letters and digits; a paste with one bad character is refused whole", async () => {
    await renderApp();
    typeCode("#");
    expect(screen.getByText("! 编号只有字母和数字")).toBeTruthy();
    expect(screen.queryByText(/编号里没有/)).toBeNull();
    typeCode("QU3");
    typeCode("QU3AB-0C");
    expect(screen.getByText("! 粘贴的内容里有编号不用的字符")).toBeTruthy();
    expect(screen.queryByText("! 编号只有字母和数字")).toBeNull();
    expect(screen.getByTestId("login-soul-code").props.value).toBe("QU3");
  });

  it("the tenth character moves the cursor to the password; nine do not", async () => {
    const focus = jest.spyOn(TextInput.prototype, "focus");
    await renderApp();
    focus.mockClear();
    typeCode("QU33Q9FW5");
    expect(focus).not.toHaveBeenCalled();
    typeCode("QU33Q9FW5F");
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it("「登录」 does nothing short of ten characters and a password, then sends the ten characters", async () => {
    const calls = stubApi({ "/soul-auth/login/": { status: 200, data: TOKENS }, ...HOME });
    await renderApp();
    typeCode("QU33Q9FW5");
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    expect(calls).toHaveLength(0);
    typeCode("QU33Q9FW5F");
    typePassword("");
    fireEvent.press(screen.getByTestId("login-submit"));
    expect(calls).toHaveLength(0);
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    await screen.findByTestId("profile-card");
    expect(calls.find((c) => c.url === "/soul-auth/login/")?.body).toEqual({ soul_code: CODE, password: "initial-pass" });
  });

  it("while it is being sent the boxes grey, the button says 登录中… and cannot be pressed again", async () => {
    const held = heldReply();
    const calls = stubApi({ "/soul-auth/login/": held.reply, ...HOME });
    await renderApp();
    typeCode(CODE);
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    await waitFor(() => expect(screen.getByTestId("login-soul-code").props.editable).toBe(false));
    expect(screen.getByTestId("login-password").props.editable).toBe(false);
    expect(within(screen.getByTestId("login-submit")).getByText("登录中…")).toBeTruthy();
    fireEvent.press(screen.getByTestId("login-submit"));
    expect(calls.filter((c) => c.url === "/soul-auth/login/")).toHaveLength(1);
    await act(async () => held.answer({ status: 200, data: TOKENS }));
    await screen.findByTestId("profile-card");
  });

  it("a dead network says so above, in the refusal colour, and what was typed is still there", async () => {
    stubApi({ "/soul-auth/login/": "offline" });
    await renderApp();
    typeCode(CODE);
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-network-title")).toHaveTextContent("! 没有连上");
    expect(screen.getByTestId("login-network-body")).toHaveTextContent("检查网络后再点「登录」。输入的内容还在。");
    expect(screen.getByTestId("login-soul-code").props.value).toBe(CODE);
    expect(screen.getByTestId("login-password").props.value).toBe("initial-pass");
    expect(screen.getByTestId("login-soul-code").props.editable).toBe(true);
  });
});

describe("A · the scanner", () => {
  it("opens from the box, reads QR only; a good code buzzes once, fills the number, moves to the password and says so", async () => {
    const buzz = jest.spyOn(Haptics, "notificationAsync");
    const focus = jest.spyOn(TextInput.prototype, "focus");
    await renderApp();
    fireEvent.press(screen.getByTestId("login-scan"));
    await screen.findByTestId("scan");
    expect(cameraMod.__state.last?.barcodeScannerSettings).toEqual({ barcodeTypes: ["qr"] });
    focus.mockClear();
    act(() => cameraMod.__state.last?.onBarcodeScanned({ data: `SL1:${CODE}` }));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("Login"));
    expect(screen.getByTestId("login-soul-code").props.value).toBe(CODE);
    expect(screen.getByTestId("login-scanned")).toHaveTextContent("✓ 已从二维码填入");
    expect(focus).toHaveBeenCalled();
    // the camera keeps reporting the same code until it is gone: one buzz
    act(() => cameraMod.__state.last?.onBarcodeScanned({ data: `SL1:${CODE}` }));
    expect(buzz).toHaveBeenCalledTimes(1);
    buzz.mockRestore();
    focus.mockRestore();
  });

  it("a code that is not ours puts a red bar up, the camera keeps going, and the bar goes after 4 seconds without another", async () => {
    await renderApp();
    fireEvent.press(screen.getByTestId("login-scan"));
    await screen.findByTestId("scan");
    jest.useFakeTimers();
    try {
      act(() => cameraMod.__state.last?.onBarcodeScanned({ data: "https://example.com/x" }));
      expect(screen.getByText("! 这不是灵魂簿交付单上的码")).toBeTruthy();
      expect(screen.getByText("请扫交付单右侧那个。也可以关掉这里，手动输入编号。")).toBeTruthy();
      expect(screen.getByTestId("scan-camera")).toBeTruthy();
      act(() => void jest.advanceTimersByTime(3000));
      act(() => cameraMod.__state.last?.onBarcodeScanned({ data: "sl1:" + CODE.toLowerCase() }));
      act(() => void jest.advanceTimersByTime(3000));
      expect(screen.getByTestId("scan-invalid")).toBeTruthy(); // 3 s after the second bad scan, not 6 after the first
      act(() => void jest.advanceTimersByTime(1100));
      expect(screen.queryByTestId("scan-invalid")).toBeNull();
      expect(navigationRef.getCurrentRoute()?.name).toBe("ScanCode");
    } finally {
      jest.useRealTimers();
    }
  });

  it("the flashlight is a switch, solid when on, and says so", async () => {
    await renderApp();
    fireEvent.press(screen.getByTestId("login-scan"));
    await screen.findByTestId("scan");
    const torch = screen.getByTestId("scan-torch");
    expect(torch.props.accessibilityRole).toBe("switch");
    expect(torch.props.accessibilityState).toMatchObject({ checked: false });
    expect(text("scan-torch-label")).toBe("手电筒");
    expect(cameraMod.__state.last).toMatchObject({ enableTorch: false });
    fireEvent.press(torch);
    expect(screen.getByTestId("scan-torch").props.accessibilityState).toMatchObject({ checked: true });
    expect(text("scan-torch-label")).toBe("手电筒 · 开");
    expect(cameraMod.__state.last).toMatchObject({ enableTorch: true });
  });

  it("a refused camera permission is a page with two ways on, and no camera", async () => {
    cameraMod.__state.permission = { status: "denied", granted: false, canAskAgain: false };
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await renderApp();
    fireEvent.press(screen.getByTestId("login-scan"));
    await screen.findByTestId("scan-denied");
    expect(screen.getByText("没有相机权限")).toBeTruthy();
    expect(screen.getByText("相机只用来读二维码，不拍照、不存图。")).toBeTruthy();
    expect(screen.queryByTestId("scan-camera")).toBeNull();
    fireEvent.press(screen.getByTestId("scan-open-settings"));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("scan-manual"));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe("Login"));
    expect(screen.getByTestId("login-soul-code").props.value).toBe("");
    open.mockRestore();
  });
});

it("D · two keystrokes before the parent re-renders are still two keystrokes, not a paste", () => {
  // The field is driven directly with a parent that never re-renders: `value` stays "" while the box accepts.
  const onChange = jest.fn();
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SoulCodeField value="" onChange={onChange} onComplete={() => {}} onScan={() => {}} editable scanned={false} />
      </I18nProvider>
    </SafeAreaProvider>,
  );
  const box = screen.getByTestId("login-soul-code");
  fireEvent.changeText(box, "q");
  fireEvent.changeText(box, "qo");
  expect(screen.getByText("! 编号里没有「O」")).toBeTruthy();
  expect(screen.queryByText("! 粘贴的内容里有编号不用的字符")).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(1);
});

describe("B1 · the phone remembers the account", () => {
  it("a known soul sees a card (name, grouped number) and the password, with the cursor already there; no subtitle", async () => {
    remembered();
    await renderApp();
    expect(screen.queryByTestId("login-soul-code")).toBeNull();
    expect(text("login-known-name")).toBe("张三");
    expect(screen.getByTestId("login-known-code")).toHaveTextContent(GROUPED);
    expect(screen.getByTestId("login-known-code").props.accessibilityLabel).toBe("灵魂编号 Q U 3，3 Q 9 F，W 5 F");
    expect(screen.getByTestId("login-password").props.autoFocus).toBe(true);
    expect(screen.queryByText("使用随初始密码一起发给你的灵魂编号登录")).toBeNull();
    expect(screen.getByText("换一个账号")).toBeTruthy();
  });

  it("signing in remembers number and name; signing out keeps both, and the form that comes back is the known one", async () => {
    secureMod.__store.set(REFRESH_TOKEN_KEY, "R");
    stubApi({ ...HOME, "/soul-auth/logout/": { status: 204 } });
    await renderApp();
    await screen.findByTestId("profile-card");
    expect(rememberedAccount()).toEqual({ code: CODE, name: "张三" });
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("logout"));
    fireEvent.press(await screen.findByTestId("logout-confirm"));
    await screen.findByTestId("login-known");
    expect(screen.getByTestId("login-known-code")).toHaveTextContent(GROUPED);
    expect(rememberedAccount()).toEqual({ code: CODE, name: "张三" });
  });

  it("「换一个账号」 asks first; confirming forgets the number, closes 面容 login at the server, and shows the empty form", async () => {
    remembered({ bio: true });
    const calls = stubApi({ "/soul-auth/device-login/revoke/": { status: 204 } });
    await renderApp();
    expect(screen.getByTestId("login-bio")).toBeTruthy(); // 面容 is on: its button, not the password
    fireEvent.press(screen.getByTestId("login-switch"));
    expect(await screen.findByText("换一个账号？")).toBeTruthy();
    expect(screen.getByText(`这部手机会忘掉编号 ${GROUPED}，面容登录一起关闭。下次要重新输入或扫码。`)).toBeTruthy();
    expect(rememberedAccount()).not.toBeNull(); // asked, not yet done
    secureMod.__auth.prompts.length = 0;
    fireEvent.press(screen.getByTestId("switch-confirm"));
    await screen.findByTestId("login-soul-code");
    expect(screen.getByText("使用随初始密码一起发给你的灵魂编号登录")).toBeTruthy();
    expect(rememberedAccount()).toBeNull();
    expect(persistentStore.get(BIO_KEY)).toBeNull();
    expect(secureMod.__guarded.size).toBe(0);
    await waitFor(() => expect(calls.find((c) => c.url === "/soul-auth/device-login/revoke/")?.body).toEqual({ credential: CRED }));
  });

  it("backing out of 「换一个账号」 changes nothing", async () => {
    remembered();
    await renderApp();
    fireEvent.press(screen.getByTestId("login-switch"));
    fireEvent.press(await screen.findByTestId("switch-cancel"));
    expect(rememberedAccount()).toEqual({ code: CODE, name: "张三" });
    expect(screen.getByTestId("login-known")).toBeTruthy();
  });
});

describe("B2 · 面容 / 指纹 after the first sign-in", () => {
  async function firstSignIn(extra: Record<string, Reply | Reply[]> = {}) {
    const calls = stubApi({ "/soul-auth/login/": { status: 200, data: TOKENS }, ...HOME, ...extra });
    await renderApp();
    typeCode(CODE);
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    return calls;
  }

  it("asks once, with the risk written; 「以后再说」 is the last time for this number", async () => {
    bioMod.__state.enrolled = true;
    const calls = await firstSignIn();
    expect(await screen.findByText("下次用面容登录？")).toBeTruthy();
    expect(screen.getByText(/和家人共用这部手机就别开/)).toBeTruthy();
    expect(screen.getByText("以后可以在「设置 › 账号安全」里关掉。")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bio-ask-later"));
    await waitFor(() => expect(persistentStore.get(`${ASKED_PREFIX}${CODE}`)).toBe("1"));
    expect(calls.some((c) => c.url === "/me/device-login/")).toBe(false);
    expect(persistentStore.get(BIO_KEY)).toBeNull();
  });

  it("does not ask again once answered, even at the next sign-in", async () => {
    bioMod.__state.enrolled = true;
    persistentStore.set(`${ASKED_PREFIX}${CODE}`, "1");
    await firstSignIn();
    await screen.findByTestId("profile-card");
    await act(async () => {});
    expect(screen.queryByText("下次用面容登录？")).toBeNull();
  });

  it("does not ask a phone with no face or finger enrolled", async () => {
    bioMod.__state.enrolled = false;
    await firstSignIn();
    await screen.findByTestId("profile-card");
    await act(async () => {});
    expect(screen.queryByText("下次用面容登录？")).toBeNull();
    expect(persistentStore.get(`${ASKED_PREFIX}${CODE}`)).toBeNull(); // not asked is not answered
  });

  it("says 指纹 on a phone without face recognition", async () => {
    bioMod.__state.enrolled = true;
    bioMod.__state.types = [1];
    await firstSignIn();
    expect(await screen.findByText("下次用指纹登录？")).toBeTruthy();
  });

  it("「开启」 uses the password just typed, keeps the credential behind the system check, and stores the password nowhere", async () => {
    bioMod.__state.enrolled = true;
    const calls = await firstSignIn({ "/me/device-login/": { status: 201, data: { credential: CRED } } });
    fireEvent.press(await screen.findByTestId("bio-ask-ok"));
    await waitFor(() => expect(persistentStore.get(BIO_KEY)).toBe("face"));
    expect(calls.find((c) => c.url === "/me/device-login/")?.body).toEqual({ password: "initial-pass" });
    expect(secureMod.__guarded.get("soulledger_device_login")).toBe(CRED);
    expect(secureMod.__auth.prompts).toEqual([SYSTEM_REASON]);
    await waitFor(() => expect(screen.queryByTestId("bio-ask")).toBeNull());
    // the password is in memory until the question ends, and on no disk
    const kept = [
      ...secureMod.__store.values(),
      ...secureMod.__guarded.values(),
      ...(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([k, v]) => `${k}=${v}`),
    ].join("\n");
    expect(kept).not.toContain("initial-pass");
    expect(kept).toContain(CRED);
  });

  it("after the forced password change the question uses the NEW password", async () => {
    bioMod.__state.enrolled = true;
    const calls = stubApi({
      "/soul-auth/login/": { status: 200, data: { ...TOKENS, account: { ...PROFILE.account, must_change_password: true } } },
      "/me/password/": { status: 200, data: { access: "A2", refresh: "R2" } },
      "/me/device-login/": { status: 201, data: { credential: CRED } },
      ...HOME,
    });
    await renderApp();
    typeCode(CODE);
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    await screen.findByTestId("change-password-submit");
    expect(screen.queryByText("下次用面容登录？")).toBeNull(); // not over the forced change
    fireEvent.changeText(screen.getByTestId("old-password"), "initial-pass");
    fireEvent.changeText(screen.getByTestId("new-password"), "a-new-password");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "a-new-password");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    fireEvent.press(await screen.findByTestId("bio-ask-ok"));
    await waitFor(() => expect(persistentStore.get(BIO_KEY)).toBe("face"));
    expect(calls.find((c) => c.url === "/me/device-login/")?.body).toEqual({ password: "a-new-password" });
  });
});

describe("B2 · the sheet waits for the welcome", () => {
  // The welcome plays once per soul x civilization per process: each test is a soul of its own.
  let n = 0;
  async function signInWith(welcomed: string[]) {
    bioMod.__state.enrolled = true;
    const profile = { ...PROFILE, soul_code: `SL-CN-B${++n}`, welcomed_civilizations: welcomed };
    const calls = stubApi({
      "/soul-auth/login/": { status: 200, data: TOKENS },
      ...HOME,
      "/me/": { status: 200, data: profile },
      "POST /me/welcomed/": { status: 200, data: { welcomed_civilizations: ["CHINESE"] } },
      "/me/device-login/": { status: 201, data: { credential: CRED } },
    });
    await renderApp();
    typeCode(CODE);
    typePassword("initial-pass");
    fireEvent.press(screen.getByTestId("login-submit"));
    return { calls, soul: profile.soul_code };
  }

  it("first time in this civilization: the welcome is up and the sheet is not; once the welcome ends the sheet comes, with the password still held", async () => {
    const { calls } = await signInWith([]);
    expect(await screen.findByTestId("welcome")).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId("bio-ask")).toBeNull();
    fireEvent.press(screen.getByTestId("welcome-skip"));
    expect(await screen.findByTestId("bio-ask")).toBeTruthy();
    expect(screen.queryByTestId("welcome")).toBeNull();
    fireEvent.press(screen.getByTestId("bio-ask-ok"));
    await waitFor(() => expect(persistentStore.get(BIO_KEY)).toBe("face"));
    expect(calls.find((c) => c.url === "/me/device-login/")?.body).toEqual({ password: "initial-pass" });
  });

  it("waiting is not answering: the question is still open until the soul says 「以后再说」", async () => {
    const { soul } = await signInWith([]);
    await screen.findByTestId("welcome");
    await act(async () => {});
    expect(persistentStore.get(`${ASKED_PREFIX}${soul}`)).toBeNull();
    fireEvent.press(screen.getByTestId("welcome-skip"));
    fireEvent.press(await screen.findByTestId("bio-ask-later"));
    await waitFor(() => expect(persistentStore.get(`${ASKED_PREFIX}${soul}`)).toBe("1"));
    await waitFor(() => expect(screen.queryByTestId("bio-ask")).toBeNull());
    expect(screen.queryByTestId("welcome")).toBeNull();
  });

  it("not the first time: no welcome, and the sheet comes at once", async () => {
    await signInWith(["CHINESE"]);
    expect(await screen.findByTestId("bio-ask")).toBeTruthy();
    expect(screen.queryByTestId("welcome")).toBeNull();
  });
});

describe("B2 · the row under 设置 › 账号安全", () => {
  async function openSettings(extra: Record<string, Reply | Reply[]> = {}) {
    secureMod.__store.set(REFRESH_TOKEN_KEY, "R");
    const calls = stubApi({ ...HOME, ...extra });
    await renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("bio-row");
    await screen.findByTestId("toggle-rebirth"); // the account's notification settings have loaded
    return calls;
  }

  it("is a switch after 两步验证, off, with 「只在这部手机上」", async () => {
    bioMod.__state.enrolled = true;
    await openSettings();
    const row = screen.getByTestId("bio-row");
    expect(row.props.accessibilityRole).toBe("switch");
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    expect(within(row).getByText("面容登录")).toBeTruthy();
    expect(text("bio-row-sub")).toBe("只在这部手机上");
    expect(text("bio-row-state")).toBe("关");
  });

  it("is unavailable, and says why, when nothing is enrolled", async () => {
    bioMod.__state.enrolled = false;
    await openSettings();
    await waitFor(() => expect(text("bio-row-sub")).toBe("这部手机没有录入面容或指纹"));
    expect(screen.getByTestId("bio-row").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("bio-row"));
    expect(screen.queryByTestId("bio-enable-sheet")).toBeNull();
  });

  it("turning it on asks the current password; a wrong one is said with the tries left; the right one turns it on", async () => {
    bioMod.__state.enrolled = true;
    const calls = await openSettings({
      "/me/device-login/": [
        { status: 400, data: { detail: "x", code: "wrong_password", remaining_attempts: 3 } },
        { status: 201, data: { credential: CRED } },
      ],
    });
    fireEvent.press(screen.getByTestId("bio-row"));
    expect(await screen.findByText("开启面容登录")).toBeTruthy();
    expect(screen.getByText("先输入当前密码，再验证面容。")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("bio-password"), "wrong-one");
    fireEvent.press(screen.getByTestId("bio-enable-next"));
    expect(await screen.findByText("! 密码不对")).toBeTruthy();
    expect(screen.getByText("还可以再试 3 次。")).toBeTruthy();
    expect(persistentStore.get(BIO_KEY)).toBeNull();
    expect(secureMod.__auth.prompts).toHaveLength(0); // no system check for a password that was not right
    fireEvent.changeText(screen.getByTestId("bio-password"), "right-one");
    fireEvent.press(screen.getByTestId("bio-enable-next"));
    await waitFor(() => expect(screen.getByTestId("bio-row-state")).toHaveTextContent("开"));
    expect(calls.filter((c) => c.url === "/me/device-login/").map((c) => c.body)).toEqual([{ password: "wrong-one" }, { password: "right-one" }]);
    expect(secureMod.__guarded.get("soulledger_device_login")).toBe(CRED);
    expect(screen.getByTestId("bio-row").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("walking away from the system check turns nothing on", async () => {
    bioMod.__state.enrolled = true;
    secureMod.__auth.error = new Error("User canceled the operation.");
    const calls = await openSettings({ "/me/device-login/": { status: 201, data: { credential: CRED } }, "/soul-auth/device-login/revoke/": { status: 204 } });
    fireEvent.press(screen.getByTestId("bio-row"));
    fireEvent.changeText(await screen.findByTestId("bio-password"), "right-one");
    fireEvent.press(screen.getByTestId("bio-enable-next"));
    // the credential the server issued is given back at once
    await waitFor(() => expect(calls.find((c) => c.url === "/soul-auth/device-login/revoke/")?.body).toEqual({ credential: CRED }));
    await waitFor(() => expect(screen.queryByTestId("bio-enable-sheet")).toBeNull());
    expect(persistentStore.get(BIO_KEY)).toBeNull();
    expect(screen.getByTestId("bio-row-state")).toHaveTextContent("关");
  });

  it("turning it off needs no password: the server is told, the phone forgets", async () => {
    bioMod.__state.enrolled = true;
    persistentStore.set(BIO_KEY, "face");
    secureMod.__guarded.set("soulledger_device_login", CRED);
    const calls = await openSettings({ "/soul-auth/device-login/revoke/": { status: 204 } });
    expect(screen.getByTestId("bio-row").props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByTestId("bio-row"));
    await waitFor(() => expect(screen.getByTestId("bio-row-state")).toHaveTextContent("关"));
    expect(screen.queryByTestId("bio-enable-sheet")).toBeNull();
    expect(calls.find((c) => c.url === "/soul-auth/device-login/revoke/")?.body).toEqual({ credential: CRED });
    expect(persistentStore.get(BIO_KEY)).toBeNull();
    expect(secureMod.__guarded.size).toBe(0);
  });
});

describe("B2 · the sign-in page with 面容 on", () => {
  it("a cold start opens the system check by itself, once, and signs in with the credential", async () => {
    remembered({ bio: true, warm: false });
    const calls = stubApi({ "/soul-auth/device-login/": { status: 200, data: TOKENS }, ...HOME });
    await renderApp();
    await screen.findByTestId("profile-card");
    expect(secureMod.__auth.prompts).toEqual([SYSTEM_REASON]);
    expect(calls.find((c) => c.url === "/soul-auth/device-login/")?.body).toEqual({ soul_code: CODE, credential: CRED });
    expect(calls.some((c) => c.url === "/soul-auth/login/")).toBe(false);
  });

  it("the button 「用面容登录」 and the link 「输入密码」; no password box until it is asked for", async () => {
    remembered({ bio: true });
    await renderApp();
    expect(within(screen.getByTestId("login-bio")).getByText("用面容登录")).toBeTruthy();
    expect(screen.queryByTestId("login-password")).toBeNull();
    expect(secureMod.__auth.prompts).toHaveLength(0); // not a cold start: nothing opened by itself
    fireEvent.press(screen.getByTestId("login-use-password"));
    expect(screen.getByTestId("login-password")).toBeTruthy();
    expect(within(screen.getByTestId("login-submit")).getByText("登录")).toBeTruthy();
  });

  it("walking away from the check stays on this page and does not open it again by itself", async () => {
    remembered({ bio: true, warm: false });
    secureMod.__auth.error = new Error("User canceled the operation.");
    stubApi({});
    const view = await renderApp();
    await waitFor(() => expect(secureMod.__auth.prompts).toHaveLength(1));
    await act(async () => {});
    expect(screen.getByTestId("login-bio")).toBeTruthy();
    expect(screen.queryByTestId("login-password")).toBeNull();
    expect(screen.queryByTestId("login-bio-failed")).toBeNull();
    // the page appears again (a second mount in the same process): still not a cold start
    view.unmount();
    await renderApp();
    await act(async () => {});
    expect(secureMod.__auth.prompts).toHaveLength(1);
    // only the button asks again
    fireEvent.press(screen.getByTestId("login-bio"));
    await waitFor(() => expect(secureMod.__auth.prompts).toHaveLength(2));
  });

  it("when the system says no, the password box comes up with 「面容没认出」 and a way to try the face again", async () => {
    remembered({ bio: true });
    scanTakes(3000);
    secureMod.__auth.error = new Error("Authentication failed");
    const calls = stubApi({ "/soul-auth/device-login/": { status: 200, data: TOKENS }, ...HOME });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    expect(await screen.findByTestId("login-bio-failed")).toHaveTextContent("面容没认出，请输入密码。");
    expect(screen.getByTestId("login-password")).toBeTruthy();
    expect(within(screen.getByTestId("login-bio-retry")).getByText("再用面容试一次")).toBeTruthy();
    expect(calls).toHaveLength(0);
    secureMod.__auth.error = null;
    fireEvent.press(screen.getByTestId("login-bio-retry"));
    await screen.findByTestId("profile-card");
    expect(calls.find((c) => c.url === "/soul-auth/device-login/")?.body).toEqual({ soul_code: CODE, credential: CRED });
  });

  it("after two misses the face retry goes and only the password is left", async () => {
    remembered({ bio: true });
    scanTakes(3000);
    secureMod.__auth.error = new Error("Authentication failed");
    stubApi({ ...HOME });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    fireEvent.press(await screen.findByTestId("login-bio-retry"));
    await waitFor(() => expect(secureMod.__auth.prompts).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("login-bio-retry")).toBeNull());
    expect(screen.getByTestId("login-bio-failed")).toHaveTextContent("面容没认出，请输入密码。");
    expect(screen.getByTestId("login-password")).toBeTruthy();
    secureMod.__auth.error = null;
  });

  it("an iOS lockout -- the same text as a miss, but back at once -- reads as the lock", async () => {
    remembered({ bio: true });
    secureMod.__auth.error = { code: "ERR_KEY_CHAIN", message: "KeyChainException: Authentication failed. Provided passphrase/PIN is incorrect or there is no user authentication method configured for this device." };
    stubApi({ ...HOME });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    expect(await screen.findByTestId("login-bio-failed")).toHaveTextContent("面容试错太多次，系统暂时锁住了。请输入密码，或过一会儿再试。");
    expect(screen.queryByTestId("login-bio-retry")).toBeNull();
    secureMod.__auth.error = null;
  });

  it("a lock from the system says so and offers no retry", async () => {
    remembered({ bio: true });
    secureMod.__auth.error = { code: "ERR_AUTHENTICATION", message: "Could not Authenticate the user: Lockout. 操作过于频繁，请稍后再试" };
    stubApi({ ...HOME });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    expect(await screen.findByTestId("login-bio-failed")).toHaveTextContent("面容试错太多次，系统暂时锁住了。请输入密码，或过一会儿再试。");
    expect(screen.queryByTestId("login-bio-retry")).toBeNull();
    secureMod.__auth.error = null;
  });

  it("two-step verification still asks for its six digits, and the remembered phone's token goes along", async () => {
    remembered({ bio: true });
    rememberDevice(CODE, "device-token-30d");
    const calls = stubApi({ "/soul-auth/device-login/": { status: 200, data: PENDING } });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-mfa");
    expect(calls.find((c) => c.url === "/soul-auth/device-login/")?.body).toEqual({
      soul_code: CODE,
      credential: CRED,
      device_token: "device-token-30d",
    });
  });

  it("a network failure keeps the button and says so; it is not a lapse", async () => {
    remembered({ bio: true });
    stubApi({ "/soul-auth/device-login/": "offline" });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    expect(await screen.findByTestId("login-network-title")).toHaveTextContent("! 没有连上");
    expect(screen.queryByTestId("login-lapsed")).toBeNull();
    expect(persistentStore.get(BIO_KEY)).toBe("face");
    expect(screen.getByTestId("login-bio")).toBeTruthy();
  });
});

describe("E · when the credential stops working", () => {
  const TITLES = {
    pw_changed: "密码已在别处修改",
    reset: "本殿官员已重置你的密码",
    reborn: "你已转生，这是新一世的账号",
    bio_changed: "面容登录已关闭",
  } as const;
  const BODIES = {
    pw_changed: "请输入新密码。登录后可以在设置里重新开启面容登录。",
    reset: "请用官员给你的初始密码登录，登录后要设新密码。",
    reborn: "编号不变。请用这一世的初始密码登录。",
    bio_changed: "这部手机上的面容有变动，为了安全先关闭。输入密码后可以重新开启。",
  } as const;

  /** Only `shown` is on the page: its title and its sentence, and none of the other three. */
  function expectOnly(shown: keyof typeof TITLES) {
    for (const key of Object.keys(TITLES) as (keyof typeof TITLES)[]) {
      if (key === shown) {
        expect(text("login-lapsed-title")).toBe(TITLES[key]);
        expect(text("login-lapsed-body")).toBe(BODIES[key]);
      } else {
        expect(screen.queryByText(TITLES[key])).toBeNull();
        expect(screen.queryByText(BODIES[key])).toBeNull();
      }
    }
    expect(screen.getAllByTestId("login-lapsed")).toHaveLength(1);
  }

  /** What every lapse leaves behind: no credential on the phone, the number kept, the password box. */
  function expectForgottenButKnown() {
    expect(persistentStore.get(BIO_KEY)).toBeNull();
    expect(secureMod.__guarded.size).toBe(0);
    expect(rememberedAccount()).toEqual({ code: CODE, name: "张三" });
    expect(screen.getByTestId("login-known")).toBeTruthy();
    expect(screen.getByTestId("login-password")).toBeTruthy();
    expect(screen.queryByTestId("login-bio")).toBeNull();
  }

  it.each([
    ["password_changed", "pw_changed"],
    ["password_reset_by_officer", "reset"],
    ["account_reincarnated", "reborn"],
    ["turned_off", "bio_changed"],
  ] as const)("the server says %s: the notice is %s, a neutral one, and only that one", async (reason, lapse) => {
    remembered({ bio: true });
    stubApi({ "/soul-auth/device-login/": refusal("device_login_revoked", reason) });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    expectOnly(lapse);
    expect(screen.getByTestId("login-lapsed").props.accessibilityRole).toBe("text"); // a status, not an alert
    expect(screen.queryByTestId("login-error")).toBeNull();
    expectForgottenButKnown();
  });

  it("being reborn also voids the 30-day no-second-step token of this phone", async () => {
    remembered({ bio: true });
    rememberDevice(CODE, "device-token-30d");
    stubApi({ "/soul-auth/device-login/": refusal("device_login_revoked", "account_reincarnated") });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    expect(deviceTokenFor(CODE)).toBeUndefined();
  });

  it("the other reasons leave that token alone", async () => {
    remembered({ bio: true });
    rememberDevice(CODE, "device-token-30d");
    stubApi({ "/soul-auth/device-login/": refusal("device_login_revoked", "password_changed") });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    expect(deviceTokenFor(CODE)).toBe("device-token-30d");
  });

  it("a credential the server does not know is the biometric notice", async () => {
    remembered({ bio: true });
    stubApi({ "/soul-auth/device-login/": refusal("device_login_invalid") });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    expectOnly("bio_changed");
    expectForgottenButKnown();
  });

  it("a new face or finger on the phone (the key is invalidated) is the biometric notice, without a request", async () => {
    remembered({ bio: true });
    secureMod.__auth.error = new Error("KeyPermanentlyInvalidatedException: Key permanently invalidated");
    const calls = stubApi({});
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    expectOnly("bio_changed");
    expect(calls).toHaveLength(0);
    secureMod.__auth.error = null;
    expectForgottenButKnown();
  });

  it("a key that is gone while 面容 is marked on (iOS drops it) is the same notice", async () => {
    remembered({ bio: true });
    secureMod.__guarded.clear();
    stubApi({});
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    expectOnly("bio_changed");
  });

  it("the password then works as always, and no notice follows the soul in", async () => {
    remembered({ bio: true });
    stubApi({ "/soul-auth/device-login/": refusal("device_login_revoked", "password_changed"), "/soul-auth/login/": { status: 200, data: TOKENS }, ...HOME });
    await renderApp();
    fireEvent.press(screen.getByTestId("login-bio"));
    await screen.findByTestId("login-lapsed");
    typePassword("the-new-password");
    fireEvent.press(screen.getByTestId("login-submit"));
    await screen.findByTestId("profile-card");
    expect(screen.queryByTestId("login-lapsed")).toBeNull();
  });
});

describe("§5 · a password changed on this phone keeps 面容 on", () => {
  async function changeHere(extra: Record<string, Reply | Reply[]> = {}) {
    secureMod.__store.set(REFRESH_TOKEN_KEY, "R");
    persistentStore.set(BIO_KEY, "face");
    secureMod.__guarded.set("soulledger_device_login", CRED);
    const calls = stubApi({ ...HOME, "/me/password/": { status: 200, data: { access: "A2", refresh: "R2" } }, ...extra });
    await renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-change-password"));
    fireEvent.changeText(await screen.findByTestId("old-password"), "old-password-1");
    fireEvent.changeText(screen.getByTestId("new-password"), "a-new-password");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "a-new-password");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await waitFor(() => expect(calls.some((c) => c.url === "/me/password/")).toBe(true));
    return calls;
  }

  it("the phone's credential goes with the request (after one system check), so the server keeps it", async () => {
    const calls = await changeHere();
    expect(calls.find((c) => c.url === "/me/password/")?.body).toEqual({
      old_password: "old-password-1",
      new_password: "a-new-password",
      device_credential: CRED,
    });
    expect(secureMod.__auth.prompts).toEqual([SYSTEM_REASON]);
    expect(persistentStore.get(BIO_KEY)).toBe("face");
  });

  it("a soul who walks away from that check still changes the password; the request just goes without it", async () => {
    secureMod.__auth.error = new Error("User canceled the operation.");
    const calls = await changeHere();
    const body = calls.find((c) => c.url === "/me/password/")?.body as Record<string, unknown>;
    expect(body).toEqual({ old_password: "old-password-1", new_password: "a-new-password" });
    expect("device_credential" in body).toBe(false);
  });

  it("with 面容 off nothing is read and nothing is sent", async () => {
    secureMod.__store.set(REFRESH_TOKEN_KEY, "R");
    const calls = stubApi({ ...HOME, "/me/password/": { status: 200, data: { access: "A2", refresh: "R2" } } });
    await renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    fireEvent.press(await screen.findByTestId("open-change-password"));
    fireEvent.changeText(await screen.findByTestId("old-password"), "old-password-1");
    fireEvent.changeText(screen.getByTestId("new-password"), "a-new-password");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "a-new-password");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    await waitFor(() => expect(calls.some((c) => c.url === "/me/password/")).toBe(true));
    expect(secureMod.__auth.prompts).toHaveLength(0);
    expect(Object.keys(calls.find((c) => c.url === "/me/password/")?.body as object)).not.toContain("device_credential");
  });
});

describe("the number is shown grouped wherever it is shown", () => {
  it("under 设置 and in the life header, read out spelled; copying still copies the ten", async () => {
    secureMod.__store.set(REFRESH_TOKEN_KEY, "R");
    stubApi({ ...HOME });
    await renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.getByText(GROUPED)).toBeTruthy();
    expect(screen.getByTestId("copy-soul-code").props.accessibilityLabel).toContain("Q U 3，3 Q 9 F，W 5 F");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings-soul-code");
    await screen.findByTestId("toggle-rebirth");
    expect(screen.getByTestId("settings-soul-code")).toHaveTextContent(`灵魂编号 ${GROUPED}`);
    expect(screen.getByTestId("settings-soul-code").props.accessibilityLabel).toBe("灵魂编号 Q U 3，3 Q 9 F，W 5 F");
  });

  it("a stored remembered account is the same ten characters that were signed in with", async () => {
    rememberAccount(CODE, "张三");
    expect(JSON.parse(persistentStore.get(ACCOUNT_KEY) ?? "{}")).toEqual({ code: CODE, name: "张三" });
  });
});
