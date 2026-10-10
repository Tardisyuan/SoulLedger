/**
 * 两步验证 for the soul (设计 第十八批), through the real navigator and core's real soul client; only the
 * network and the native stores are doubles. Each test names the state it reaches by the Design's own words.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { soulLinks } from "../links";
import { MFA_DEVICES_KEY, clockOf, deviceTokenFor, digitsOf, forgetDevice, recoveryOf, rememberDevice, secretLines, stateOfFailure } from "../mfa";
import { navigationHeld } from "../navLock";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, persistentStore, sessionStore } from "../platform";
import { PUSH_TOKEN_KEY } from "../push";
import { SessionProvider } from "../session";
import { PROFILE, life, stubApi, type Reply } from "./stubApi";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const SECRET = "JBSWY3DPEHPK3PXPQK7M2RTAJBSWY3DP";
const OTPAUTH = `otpauth://totp/SoulLedger%3ASL-CN-000042?secret=${SECRET}&issuer=SoulLedger&algorithm=SHA1&digits=6&period=30`;
const CODES = ["7kq4-m2xd", "p9tr-3hwe", "b6nc-qx8l", "v2jf-k7sa", "d4gm-r9up", "h8zt-5wqc", "l3xe-n6kb", "s7pv-2djr", "y5cw-h4mt", "f9aq-8eln"];
const OFF = { enabled: false, confirmed_at: null, last_used_at: null, last_used_method: "", recovery_codes_remaining: 0 };
const ON = { enabled: true, confirmed_at: "2026-10-11T09:12:00Z", last_used_at: "2026-10-11T20:40:00Z", last_used_method: "totp", recovery_codes_remaining: 8 };
const PENDING = { mfa_required: true, pending_token: "pending-opaque-abc", soul_code: "SL-CN-000042", home_tenant: PROFILE.home_tenant };
const TOKENS = { access: "A", refresh: "R", soul_code: "SL-CN-000042", account: PROFILE.account };
const VERIFY = "POST /soul-auth/mfa/verify/";

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

function signedIn(extra: Record<string, Reply | Reply[]> = {}) {
  secure.set(REFRESH_TOKEN_KEY, "R");
  return stubApi({
    "/me/": { status: 200, data: PROFILE },
    "/me/life/": { status: 200, data: life(1) },
    "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
    ...extra,
  });
}

const route = () => navigationRef.getCurrentRoute()?.name;
/** Step ① → ②: the current password first (being signed in is not being the owner). */
async function startWith(password = "my-long-password") {
  fireEvent.changeText(await screen.findByTestId("setup-password"), password);
  fireEvent.press(screen.getByTestId("intro-next"));
}
const bodies = (calls: { method: string; url: string; body: unknown }[], key: string) =>
  calls.filter((c) => `${c.method} ${c.url}` === key).map((c) => c.body);

const logs: unknown[][] = [];
const spies: jest.SpyInstance[] = [];
beforeEach(async () => {
  installMobilePlatform();
  secure.clear();
  sessionStore.remove("soulledger_access");
  await AsyncStorage.clear();
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level];
    spies.push(
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args);
        original(...args);
      })
    );
  }
});
afterEach(() => {
  while (spies.length) spies.pop()?.mockRestore();
});

/** Nothing the flow handled may sit in a store, a log or a navigation param. */
async function expectNothingKept(values: string[]) {
  const stored = JSON.stringify([...(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())), ...secure.values()]);
  const state = JSON.stringify(navigationRef.getRootState());
  const logged = JSON.stringify(logs);
  for (const value of values) {
    expect(stored).not.toContain(value);
    expect(state).not.toContain(value);
    expect(logged).not.toContain(value);
  }
}

describe("the pure parts", () => {
  it("digits are six digits; a recovery code keeps its letters and its dash", () => {
    expect(digitsOf("48 29-13 77")).toBe("482913");
    expect(recoveryOf(" 7KQ4-m2xd ")).toBe("7KQ4-m2xd");
  });

  it("the key is four characters to a group and four groups to a line", () => {
    expect(secretLines(SECRET)).toEqual(["JBSW Y3DP EHPK 3PXP", "QK7M 2RTA JBSW Y3DP"]);
    expect(secretLines("JBSWY3DPEHPK")).toEqual(["JBSW Y3DP EHPK"]);
  });

  it("a lock is written as a clock time", () => {
    const iso = new Date(2026, 9, 11, 21, 46).toISOString();
    expect(clockOf(iso)).toBe("21:46");
    expect(clockOf(null)).toBeNull();
    expect(clockOf("not a date")).toBeNull();
  });

  it("each failure is its own state", () => {
    const f = (code: string, extra = {}) => stateOfFailure({ code: code as never, remainingAttempts: null, lockedUntil: null, retryAfter: null, ...extra });
    expect(f("wrong", { remainingAttempts: 3 })).toEqual({ kind: "wrong", left: 3 });
    expect(f("expired").kind).toBe("wrong");
    expect(f("pending_invalid")).toEqual({ kind: "expired" });
    expect(f("locked", { lockedUntil: "2026-10-11T13:46:00Z" })).toEqual({ kind: "locked", until: "2026-10-11T13:46:00Z" });
    expect(stateOfFailure({ code: "locked", remainingAttempts: null, lockedUntil: null, retryAfter: 900 }, 0)).toEqual({ kind: "locked", until: new Date(900_000).toISOString() });
    expect(f("network")).toEqual({ kind: "network" });
    expect(f("other")).toEqual({ kind: "other" });
  });

  it("the device token store keeps one value per soul code, in the secure store only", async () => {
    rememberDevice("sl-cn-000042", "DEV1");
    rememberDevice("SL-CN-000043", "DEV2");
    expect(deviceTokenFor(" SL-CN-000042 ")).toBe("DEV1");
    expect(deviceTokenFor("SL-CN-000043")).toBe("DEV2");
    expect(JSON.parse(secure.get(MFA_DEVICES_KEY) ?? "{}")).toEqual({ "SL-CN-000042": "DEV1", "SL-CN-000043": "DEV2" });
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    forgetDevice("SL-CN-000042");
    expect(deviceTokenFor("SL-CN-000042")).toBeUndefined();
    expect(deviceTokenFor("SL-CN-000043")).toBe("DEV2");
    secure.set(MFA_DEVICES_KEY, "{not json");
    expect(deviceTokenFor("SL-CN-000043")).toBeUndefined(); // an unreadable store is an empty one
  });
});

describe("settings: 账号安全", () => {
  it("groups the page and shows where 两步验证 stands on its row", async () => {
    signedIn({ "GET /me/mfa/": { status: 200, data: OFF } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await screen.findByTestId("settings");
    expect(screen.getByTestId("group-prefs").props.children).toBe("偏好");
    expect(screen.getByTestId("group-security").props.children).toBe("账号安全");
    await waitFor(() => expect(screen.getByTestId("open-mfa-state").props.children).toBe("○ 未开启"));
    expect(screen.getByTestId("open-change-password")).toBeTruthy();
    // 页底保留灵魂编号。
    expect(screen.getByTestId("settings-soul-code")).toBeTruthy();
    expect(screen.getByText(PROFILE.soul_code)).toBeTruthy();
    await act(async () => {}); // the page's permission read settles before the test ends
  });

  it("says 「✓ 已开启」 when it is on, and the row opens the page", async () => {
    signedIn({ "GET /me/mfa/": { status: 200, data: ON } });
    renderApp();
    await screen.findByTestId("profile-card");
    fireEvent.press(screen.getByTestId("header-account"));
    await waitFor(() => expect(screen.getByTestId("open-mfa-state").props.children).toBe("✓ 已开启"));
    fireEvent.press(screen.getByTestId("open-mfa"));
    await screen.findByTestId("mfa-manage");
    expect(route()).toBe("Mfa");
  });

  it("nothing nags: no banner, no prompt, on the life tab or in settings (自愿)", async () => {
    signedIn({ "GET /me/mfa/": { status: 200, data: OFF } });
    renderApp();
    await screen.findByTestId("profile-card");
    expect(screen.queryByText(/两步验证/)).toBeNull();
  });
});

describe("the wizard", () => {
  async function toBind(extra: Record<string, Reply | Reply[]> = {}) {
    const calls = signedIn({
      "GET /me/mfa/": [{ status: 200, data: OFF }, { status: 200, data: ON }],
      "POST /me/mfa/setup/": { status: 200, data: { secret: SECRET, otpauth_url: OTPAUTH } },
      "DELETE /me/mfa/setup/": { status: 204 },
      ...extra,
    });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await startWith();
    await screen.findByTestId("secret-key");
    return calls;
  }

  it("① explains what the six digits are and where to get an authenticator, without naming one", async () => {
    signedIn({ "GET /me/mfa/": { status: 200, data: OFF } });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await screen.findByTestId("intro-next");
    expect(screen.getByTestId("wizard-step").props.children).toBe("1 / 3");
    expect(screen.getByText("先在手机上装一个验证器")).toBeTruthy();
    expect(screen.getByText("还没有验证器？")).toBeTruthy();
    expect(screen.getByText("中途退出不会开启")).toBeTruthy();
    // 不推荐具体的 App。
    for (const brand of ["Google", "Microsoft", "Authy", "1Password"]) expect(screen.queryByText(new RegExp(brand))).toBeNull();
  });

  it("② adds and enters the digits on one screen: the key in groups of four, one string; nothing is asked before the step", async () => {
    const calls = signedIn({
      "GET /me/mfa/": { status: 200, data: OFF },
      "POST /me/mfa/setup/": { status: 200, data: { secret: SECRET, otpauth_url: OTPAUTH } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await screen.findByTestId("intro-next");
    expect(calls.some((c) => c.url === "/me/mfa/setup/")).toBe(false);
    await startWith();
    const key = await screen.findByTestId("secret-key");
    expect(bodies(calls, "POST /me/mfa/setup/")).toEqual([{ password: "my-long-password" }]);
    expect(key.props.children).toBe("JBSW Y3DP EHPK 3PXP\nQK7M 2RTA JBSW Y3DP");
    expect(key.props.selectable).toBe(true);
    expect(screen.getByTestId("wizard-step").props.children).toBe("2 / 3");
    expect(screen.getByTestId("bind-code")).toBeTruthy();
    // 验证 · 下一步 waits for six digits.
    expect(screen.getByTestId("bind-next").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("bind-code"), "4829");
    expect(screen.getByTestId("bind-next").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("bind-code"), "482913");
    expect(screen.getByTestId("bind-next").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("① asks for the current password: 下一步 waits for one, and no secret is asked for before it is sent", async () => {
    const calls = signedIn({ "GET /me/mfa/": { status: 200, data: OFF }, "POST /me/mfa/setup/": { status: 200, data: { secret: SECRET, otpauth_url: OTPAUTH } } });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await screen.findByTestId("intro-next");
    expect(screen.getByTestId("wizard-step").props.children).toBe("1 / 3"); // still three steps
    expect(screen.getByTestId("setup-password").props.secureTextEntry).toBe(true);
    expect(screen.getByTestId("intro-next").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("intro-next"));
    expect(calls.some((c) => c.url === "/me/mfa/setup/")).toBe(false);
  });

  it("a wrong password is said under the box: step ① stays, no key, the box keeps what was typed", async () => {
    const calls = signedIn({
      "GET /me/mfa/": { status: 200, data: OFF },
      "POST /me/mfa/setup/": { status: 400, data: { detail: "x", code: "wrong_password", remaining_attempts: 3 } },
    });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await screen.findByTestId("intro-next");
    await startWith("nope");
    expect(await screen.findByText("! 密码不对")).toBeTruthy();
    expect(screen.queryByTestId("secret-key")).toBeNull();
    expect(screen.getByTestId("wizard-step").props.children).toBe("1 / 3");
    expect(screen.getByTestId("setup-password").props.value).toBe("nope");
    expect(bodies(calls, "POST /me/mfa/setup/")).toEqual([{ password: "nope" }]);
  });

  it("a spent budget says so, and any other failure is told as a failure", async () => {
    signedIn({
      "GET /me/mfa/": { status: 200, data: OFF },
      "POST /me/mfa/setup/": [{ status: 429, data: { detail: "x", code: "rate_limited" } }, "offline"],
    });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await screen.findByTestId("intro-next");
    await startWith();
    expect(await screen.findByText("尝试过于频繁,请稍后再试")).toBeTruthy();
    fireEvent.press(screen.getByTestId("intro-next"));
    await screen.findByTestId("setup-failed");
    expect(screen.queryByTestId("secret-key")).toBeNull();
  });

  it("the password was asked once, and leaving ② does not ask for a second key", async () => {
    const calls = await toBind();
    fireEvent.press(screen.getByTestId("wizard-close"));
    await waitFor(() => expect(route()).not.toBe("Mfa"));
    expect(bodies(calls, "POST /me/mfa/setup/")).toHaveLength(1);
  });

  it("the six-digit box asks for a numeric keyboard and a one-time code", async () => {
    await toBind();
    const input = screen.getByTestId("bind-code");
    expect(input.props.keyboardType).toBe("number-pad");
    expect(input.props.textContentType).toBe("oneTimeCode");
    expect(input.props.autoComplete).toBe("one-time-code");
    expect(input.props.maxLength).toBe(6);
  });

  it("「在验证器 App 中打开」 opens the otpauth link; when nothing can open it, it says to type the key", async () => {
    await toBind();
    const open = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("no app"));
    fireEvent.press(screen.getByTestId("open-authenticator"));
    expect(open).toHaveBeenCalledWith(OTPAUTH);
    expect((await screen.findByTestId("open-failed")).props.children).toBe("没有找到可打开它的验证器 App。请手动输入下面的密钥。");
    open.mockResolvedValueOnce(true);
    fireEvent.press(screen.getByTestId("open-authenticator"));
    await waitFor(() => expect(screen.queryByTestId("open-failed")).toBeNull());
  });

  it("a wrong number says so in the Design's words, keeps the digits and enables nothing", async () => {
    const calls = await toBind({ "POST /me/mfa/confirm/": { status: 400, data: { detail: "x", code: "wrong" } } });
    fireEvent.changeText(screen.getByTestId("bind-code"), "551203");
    fireEvent.press(screen.getByTestId("bind-next"));
    expect((await screen.findByTestId("bind-wrong")).props.children).toBe("! 数字不对。数字每 30 秒换一次，请输入现在显示的那个。");
    expect(screen.getByTestId("bind-code").props.value).toBe("551203");
    expect(screen.getByTestId("wizard-step").props.children).toBe("2 / 3");
    expect(bodies(calls, "POST /me/mfa/confirm/")).toEqual([{ code: "551203" }]);
  });

  it("a network failure is told as one, not as a wrong number", async () => {
    await toBind({ "POST /me/mfa/confirm/": "offline" });
    fireEvent.changeText(screen.getByTestId("bind-code"), "482913");
    fireEvent.press(screen.getByTestId("bind-next"));
    await screen.findByTestId("step-network");
    expect(screen.queryByTestId("bind-wrong")).toBeNull();
    expect(screen.getByTestId("bind-code").props.value).toBe("482913");
  });

  it("③ shows the ten codes once; 完成 needs the box ticked; there is no way back", async () => {
    const calls = await toBind({ "POST /me/mfa/confirm/": { status: 200, data: { recovery_codes: CODES } } });
    fireEvent.changeText(screen.getByTestId("bind-code"), "482913");
    fireEvent.press(screen.getByTestId("bind-next"));
    await screen.findByTestId("recovery-codes");
    expect(screen.getByTestId("wizard-step").props.children).toBe("3 / 3");
    CODES.forEach((code, i) => expect(screen.getByTestId(`recovery-code-${i}`).props.children).toBe(code));
    expect(screen.queryByTestId("wizard-close")).toBeNull(); // no ✕ on this step
    expect(screen.getByText("这一步不能返回，勾选后才能完成")).toBeTruthy();
    expect(screen.getByText("我已把恢复码存在这部手机以外的地方")).toBeTruthy();
    expect(screen.queryByText("存为文件")).toBeNull(); // not shipped: no file module (see mfa.tsx)

    // Not ticked: 完成 does nothing.
    expect(screen.getByTestId("codes-done").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("codes-done"));
    expect(screen.getByTestId("recovery-codes")).toBeTruthy();

    // The system back (Android key, iOS swipe) is refused while the codes are up; the header has no way out
    // (a deep link or a tapped notification waits: see the test of `holdNavigation` below).
    act(() => navigationRef.goBack());
    expect(route()).toBe("Mfa");
    expect(screen.getByTestId("recovery-codes")).toBeTruthy();

    fireEvent.press(screen.getByTestId("codes-confirm"));
    expect(screen.getByTestId("codes-confirm").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("codes-done").props.accessibilityState).toMatchObject({ disabled: false });
    fireEvent.press(screen.getByTestId("codes-done"));
    await screen.findByTestId("mfa-manage");
    expect(screen.queryByTestId("recovery-codes")).toBeNull(); // gone with the page
    expect(calls.some((c) => c.method === "DELETE")).toBe(false); // enabled: nothing to cancel
  });

  it("the codes and the key stay in the component: not in a store, a navigation state or a log", async () => {
    await toBind({ "POST /me/mfa/confirm/": { status: 200, data: { recovery_codes: CODES } } });
    fireEvent.changeText(screen.getByTestId("bind-code"), "482913");
    fireEvent.press(screen.getByTestId("bind-next"));
    await screen.findByTestId("recovery-codes");
    await expectNothingKept([...CODES, SECRET, "482913", OTPAUTH]);
    fireEvent.press(screen.getByTestId("codes-confirm"));
    fireEvent.press(screen.getByTestId("codes-done"));
    await screen.findByTestId("mfa-manage");
    await expectNothingKept([...CODES, SECRET, "482913", OTPAUTH]);
  });

  it("copy-all puts the ten codes on the clipboard, one a line", async () => {
    const Clipboard = jest.requireMock("expo-clipboard") as { setStringAsync: jest.Mock };
    Clipboard.setStringAsync.mockClear();
    await toBind({ "POST /me/mfa/confirm/": { status: 200, data: { recovery_codes: CODES } } });
    fireEvent.changeText(screen.getByTestId("bind-code"), "482913");
    fireEvent.press(screen.getByTestId("bind-next"));
    await screen.findByTestId("recovery-codes");
    fireEvent.press(screen.getByTestId("codes-copy"));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODES.join("\n")));
    expect((await screen.findByTestId("toast")).props.children).toBe("已复制");
  });

  it("leaving at ② drops the unconfirmed secret; ✕ leaves without enabling", async () => {
    const calls = await toBind();
    fireEvent.press(screen.getByTestId("wizard-close"));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/me/mfa/setup/")).toBe(true));
    expect(route()).not.toBe("Mfa");
  });

  it("a deep link that arrives while the codes are up waits, and lands when they are saved", async () => {
    await toBind({ "POST /me/mfa/confirm/": { status: 200, data: { recovery_codes: CODES } } });
    fireEvent.changeText(screen.getByTestId("bind-code"), "482913");
    fireEvent.press(screen.getByTestId("bind-next"));
    await screen.findByTestId("recovery-codes");
    expect(navigationHeld()).toBe(true);
    act(() => soulLinks.push("soulledger://cooldown"));
    await act(async () => {});
    expect(route()).toBe("Mfa");
    fireEvent.press(screen.getByTestId("codes-confirm"));
    fireEvent.press(screen.getByTestId("codes-done"));
    await waitFor(() => expect(route()).not.toBe("Mfa"));
    expect(navigationHeld()).toBe(false);
  });
});

describe("the management page", () => {
  async function open(status: object, extra: Record<string, Reply | Reply[]> = {}) {
    const calls = signedIn({ "GET /me/mfa/": { status: 200, data: status }, ...extra });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("Mfa"));
    await screen.findByTestId("mfa-manage");
    return calls;
  }

  it("shows when it was turned on, when it was last used and how, and what is left", async () => {
    await open(ON);
    expect(screen.getByTestId("mfa-on")).toBeTruthy();
    expect(screen.getByTestId("mfa-enabled-at")).toBeTruthy();
    expect(screen.getByText("开启于")).toBeTruthy();
    expect(screen.getByText("最近一次使用")).toBeTruthy();
    expect(screen.getByTestId("mfa-last-used")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.queryByTestId("mfa-low")).toBeNull();
    expect(screen.getByText("换手机时：先在旧手机上关闭，再在新手机上重新开启。")).toBeTruthy();
  });

  it("two or fewer codes left raises the warning", async () => {
    await open({ ...ON, recovery_codes_remaining: 2 });
    expect(screen.getByTestId("mfa-low")).toBeTruthy();
    expect(screen.getByText("恢复码只剩 2 个。用完之前请重新生成。")).toBeTruthy();
  });

  it("regenerating asks to be confirmed, needs no digits, and shows the new ten once", async () => {
    const calls = await open(ON, { "POST /me/mfa/recovery-codes/": { status: 200, data: { recovery_codes: CODES } } });
    fireEvent.press(screen.getByTestId("mfa-regen"));
    expect(await screen.findByText("旧的 8 个立即作废。新的 10 个只显示一次。")).toBeTruthy();
    expect(screen.queryByTestId("disable-code")).toBeNull();
    expect(calls.some((c) => c.url === "/me/mfa/recovery-codes/")).toBe(false); // not before the confirm
    fireEvent.press(screen.getByTestId("regen-confirm"));
    await screen.findByTestId("recovery-codes");
    expect(bodies(calls, "POST /me/mfa/recovery-codes/")).toEqual([undefined]);
    CODES.forEach((code, i) => expect(screen.getByTestId(`recovery-code-${i}`).props.children).toBe(code));
    act(() => navigationRef.goBack());
    expect(route()).toBe("Mfa"); // the same rule as ③
    await expectNothingKept(CODES);
  });

  it("cancelling the regenerate sheet asks nothing", async () => {
    const calls = await open(ON);
    fireEvent.press(screen.getByTestId("mfa-regen"));
    fireEvent.press(await screen.findByTestId("regen-cancel"));
    await waitFor(() => expect(screen.queryByTestId("regen-sheet")).toBeNull());
    expect(calls.some((c) => c.url === "/me/mfa/recovery-codes/")).toBe(false);
  });

  it("turning it off takes the six digits; the button is the danger one and waits for all six", async () => {
    const calls = await open(ON, { "POST /me/mfa/disable/": { status: 200, data: OFF } });
    fireEvent.press(screen.getByTestId("mfa-disable"));
    expect(await screen.findByText("关闭后，登录只要密码。剩下的恢复码一起作废。")).toBeTruthy();
    expect(screen.getByTestId("disable-confirm").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("disable-code"), "3071");
    expect(screen.getByTestId("disable-confirm").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("disable-code"), "307155");
    fireEvent.press(screen.getByTestId("disable-confirm"));
    await waitFor(() => expect(route()).not.toBe("Mfa"));
    expect(bodies(calls, "POST /me/mfa/disable/")).toEqual([{ method: "totp", code: "307155" }]);
  });

  it("without the phone, the password does it", async () => {
    const calls = await open(ON, { "POST /me/mfa/disable/": { status: 200, data: OFF } });
    fireEvent.press(screen.getByTestId("mfa-disable"));
    fireEvent.press(await screen.findByTestId("disable-use-password"));
    fireEvent.changeText(screen.getByTestId("disable-password"), "my-long-password");
    fireEvent.press(screen.getByTestId("disable-confirm"));
    await waitFor(() => expect(route()).not.toBe("Mfa"));
    expect(bodies(calls, "POST /me/mfa/disable/")).toEqual([{ method: "password", password: "my-long-password" }]);
    await expectNothingKept(["my-long-password"]);
  });

  it("a wrong number, a wrong password and a lock each say so, and it stays on", async () => {
    await open(ON, {
      "POST /me/mfa/disable/": [
        { status: 400, data: { detail: "x", code: "wrong", remaining_attempts: 4 } },
        { status: 400, data: { detail: "x", code: "wrong_password", remaining_attempts: 3 } },
        { status: 429, data: { detail: "x", code: "locked", retry_after: 900, locked_until: new Date(Date.now() + 900_000).toISOString() } },
      ],
    });
    fireEvent.press(screen.getByTestId("mfa-disable"));
    fireEvent.changeText(await screen.findByTestId("disable-code"), "307155");
    fireEvent.press(screen.getByTestId("disable-confirm"));
    await screen.findByTestId("step-wrong");
    expect(screen.getByText("! 数字不对")).toBeTruthy();
    expect(screen.getByText("还可以再试 4 次。")).toBeTruthy();
    fireEvent.press(screen.getByTestId("disable-use-password"));
    fireEvent.changeText(await screen.findByTestId("disable-password"), "nope");
    fireEvent.press(screen.getByTestId("disable-confirm"));
    await waitFor(() => expect(screen.getByText("! 密码不对")).toBeTruthy());
    expect(screen.getByText("还可以再试 3 次。")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("disable-password"), "nope2");
    fireEvent.press(screen.getByTestId("disable-confirm"));
    await screen.findByTestId("step-locked");
    expect(screen.getByTestId("disable-confirm").props.accessibilityState).toMatchObject({ disabled: true });
    expect(route()).toBe("Mfa");
  });
});

describe("sign-in, second step", () => {
  async function toSecondStep(routes: Record<string, Reply | Promise<Reply> | (Reply | Promise<Reply>)[]> = {}) {
    const calls = stubApi({
      "/soul-auth/login/": { status: 200, data: PENDING },
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
      "GET /me/notification-settings/": { status: 200, data: { rebirth: true, judgment: true, residence: true, chat: true, locale: "zh-Hans" } },
      ...routes,
    });
    renderApp();
    fireEvent.changeText(await screen.findByTestId("login-soul-code"), "SL-CN-000042");
    fireEvent.changeText(screen.getByTestId("login-password"), "my-long-password");
    fireEvent.press(screen.getByTestId("login-submit"));
    await screen.findByTestId("login-second-step");
    return calls;
  }

  it("the password alone gives no session: the app stays signed out and the password is not kept", async () => {
    await toSecondStep();
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull();
    expect(navigationRef.getRootState()?.routeNames).toEqual(["Login", "ForgotPassword", "MfaLost"]);
    expect(screen.getByText(/灵魂编号/)).toBeTruthy();
    expect(screen.getByText("SL-CN-000042")).toBeTruthy();
    expect(screen.getByText("输满 6 位自动提交。")).toBeTruthy();
    await expectNothingKept(["pending-opaque-abc", "my-long-password"]);
  });

  it("the sixth digit sends the number, once; the answer signs the soul in", async () => {
    const calls = await toSecondStep({ [VERIFY]: { status: 200, data: TOKENS } });
    const box = screen.getByTestId("login-code");
    expect(box.props.keyboardType).toBe("number-pad");
    expect(box.props.textContentType).toBe("oneTimeCode");
    fireEvent.changeText(box, "48291");
    expect(bodies(calls, VERIFY)).toEqual([]);
    fireEvent.changeText(box, "482913");
    fireEvent.changeText(screen.getByTestId("login-code"), "482913"); // the same value again: not a second send
    await screen.findByTestId("profile-card");
    expect(bodies(calls, VERIFY)).toEqual([{ pending_token: "pending-opaque-abc", code: "482913", remember_device: false }]);
    expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R");
    await expectNothingKept(["pending-opaque-abc"]);
  });

  it("the same six digits are not sent again once they have been answered (a keyboard that repeats the value)", async () => {
    const calls = await toSecondStep({ [VERIFY]: { status: 400, data: { detail: "x", code: "wrong", remaining_attempts: 3 } } });
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await screen.findByTestId("step-wrong");
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await act(async () => {});
    expect(bodies(calls, VERIFY)).toHaveLength(1);
    // Editing a digit and coming back is a new attempt.
    fireEvent.changeText(screen.getByTestId("login-code"), "48291");
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await waitFor(() => expect(bodies(calls, VERIFY)).toHaveLength(2));
  });

  it("while it is being sent the box greys and the button says 验证中… and cannot be pressed", async () => {
    let answer!: (reply: Reply) => void;
    const held = new Promise<Reply>((resolve) => (answer = resolve));
    await toSecondStep({ [VERIFY]: held });
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await waitFor(() => expect(screen.getByTestId("login-verify").props.accessibilityState).toMatchObject({ disabled: true }));
    expect(screen.getByText("验证中…")).toBeTruthy();
    expect(screen.getByTestId("login-code").props.editable).toBe(false);
    await act(async () => answer({ status: 200, data: TOKENS }));
    await screen.findByTestId("profile-card");
  });

  it("a wrong number says how many tries are left and keeps the digits", async () => {
    await toSecondStep({ [VERIFY]: { status: 400, data: { detail: "x", code: "wrong", remaining_attempts: 3 } } });
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await screen.findByTestId("step-wrong");
    expect(screen.getByText("! 数字不对")).toBeTruthy();
    expect(screen.getByText("还可以再试 3 次。")).toBeTruthy();
    expect(screen.getByTestId("login-code").props.value).toBe("482913");
  });

  it("a failed connection keeps the digits and says so; pressing 验证 sends them again", async () => {
    const calls = await toSecondStep({ [VERIFY]: ["offline", { status: 200, data: TOKENS }] });
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await screen.findByTestId("step-network");
    expect(screen.getByText("检查网络后再点「验证」。输入的数字还在。")).toBeTruthy();
    expect(screen.getByTestId("login-code").props.value).toBe("482913");
    fireEvent.press(screen.getByTestId("login-verify"));
    await screen.findByTestId("profile-card");
    expect(bodies(calls, VERIFY)).toHaveLength(2);
  });

  it("a timed-out step turns the button into 「重新输入密码」, hides two things, and goes back with the soul code kept", async () => {
    await toSecondStep({ [VERIFY]: { status: 401, data: { detail: "x", code: "pending_invalid" } } });
    expect(screen.getByTestId("login-remember")).toBeTruthy();
    expect(screen.getByTestId("lost-phone")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await screen.findByTestId("step-expired");
    expect(screen.getByText("! 这一步超时了")).toBeTruthy();
    expect(screen.getByText("请重新输入密码。")).toBeTruthy();
    expect(screen.queryByTestId("login-remember")).toBeNull();
    expect(screen.queryByTestId("lost-phone")).toBeNull();
    expect(screen.getByText("重新输入密码")).toBeTruthy();
    expect(screen.getByTestId("login-code").props.editable).toBe(false);
    expect(secure.get(REFRESH_TOKEN_KEY) || null).toBeNull(); // a 401 here is a timed-out step, not a dead session
    fireEvent.press(screen.getByTestId("login-verify"));
    await screen.findByTestId("login-submit");
    expect(screen.getByTestId("login-soul-code").props.value).toBe("SL-CN-000042");
    expect(screen.getByTestId("login-password").props.value).toBe("");
  });

  it("a lock says what time it can be tried again, empties the box and switches the button off", async () => {
    const until = new Date(Date.now() + 15 * 60_000).toISOString();
    await toSecondStep({ [VERIFY]: { status: 429, data: { detail: "x", code: "locked", retry_after: 900, locked_until: until } } });
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await screen.findByTestId("step-locked");
    expect(screen.getByText("◐ 试错太多次，先暂停")).toBeTruthy();
    expect(screen.getByText(clockOf(until) as string)).toBeTruthy();
    expect(screen.getByTestId("login-verify").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId("login-code").props.editable).toBe(false);
    expect(screen.getByTestId("login-code").props.value).toBe("");
  });

  it("a lock that has already run out lets the box back in", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      const until = new Date(Date.now() + 5_000).toISOString();
      await toSecondStep({ [VERIFY]: { status: 429, data: { detail: "x", code: "locked", retry_after: 5, locked_until: until } } });
      fireEvent.changeText(screen.getByTestId("login-code"), "482913");
      await screen.findByTestId("step-locked");
      await act(async () => {
        jest.advanceTimersByTime(5_100);
      });
      expect(screen.queryByTestId("step-locked")).toBeNull();
      expect(screen.getByTestId("login-code").props.editable).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a recovery code is typed as it is and sent as a recovery code", async () => {
    const calls = await toSecondStep({ [VERIFY]: { status: 200, data: TOKENS } });
    fireEvent.press(screen.getByTestId("use-recovery"));
    expect(screen.getByText("用恢复码登录")).toBeTruthy();
    expect(screen.getByText("输入保存的 10 个恢复码之一，每个只能用一次。")).toBeTruthy();
    const box = screen.getByTestId("login-recovery");
    expect(box.props.autoCapitalize).toBe("none");
    fireEvent.changeText(box, "7KQ4-m2xd");
    expect(bodies(calls, VERIFY)).toEqual([]); // no auto-send for a recovery code
    fireEvent.press(screen.getByTestId("login-verify"));
    await screen.findByTestId("profile-card");
    expect(bodies(calls, VERIFY)).toEqual([{ pending_token: "pending-opaque-abc", recovery_code: "7KQ4-m2xd", remember_device: false }]);
    await expectNothingKept(["7KQ4-m2xd"]);
  });

  it("the way back to the six digits is there", async () => {
    await toSecondStep();
    fireEvent.press(screen.getByTestId("use-recovery"));
    fireEvent.press(screen.getByTestId("use-code"));
    expect(screen.getByTestId("login-code")).toBeTruthy();
  });

  it("「这部手机 30 天内不再询问」 keeps the server's token in the secure store, and the next password sends it", async () => {
    const calls = await toSecondStep({ [VERIFY]: { status: 200, data: { ...TOKENS, device_token: "device-opaque-xyz" } } });
    fireEvent.press(screen.getByTestId("login-remember"));
    fireEvent.changeText(screen.getByTestId("login-code"), "482913");
    await screen.findByTestId("profile-card");
    expect(bodies(calls, VERIFY)).toEqual([{ pending_token: "pending-opaque-abc", code: "482913", remember_device: true }]);
    expect(deviceTokenFor("SL-CN-000042")).toBe("device-opaque-xyz");
    expect(await AsyncStorage.getAllKeys()).not.toContain(MFA_DEVICES_KEY);
  });

  it("a remembered phone is sent with the password and skips the second step", async () => {
    rememberDevice("SL-CN-000042", "device-opaque-xyz");
    const calls = stubApi({
      "/soul-auth/login/": { status: 200, data: TOKENS },
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: life(1) },
    });
    renderApp();
    fireEvent.changeText(await screen.findByTestId("login-soul-code"), "sl-cn-000042");
    fireEvent.changeText(screen.getByTestId("login-password"), "my-long-password");
    fireEvent.press(screen.getByTestId("login-submit"));
    await screen.findByTestId("profile-card");
    expect(bodies(calls, "POST /soul-auth/login/")).toEqual([
      { soul_code: "sl-cn-000042", password: "my-long-password", device_token: "device-opaque-xyz" },
    ]);
  });

  it("a remembered phone the server no longer honours is forgotten at once", async () => {
    rememberDevice("SL-CN-000042", "device-opaque-xyz");
    await toSecondStep();
    expect(deviceTokenFor("SL-CN-000042")).toBeUndefined();
  });

  it("a soul code without two-step sends no device token", async () => {
    rememberDevice("SL-CN-000099", "someone-elses");
    const calls = stubApi({ "/soul-auth/login/": { status: 200, data: TOKENS }, "/me/": { status: 200, data: PROFILE }, "/me/life/": { status: 200, data: life(1) } });
    renderApp();
    fireEvent.changeText(await screen.findByTestId("login-soul-code"), "SL-CN-000042");
    fireEvent.changeText(screen.getByTestId("login-password"), "my-long-password");
    fireEvent.press(screen.getByTestId("login-submit"));
    await screen.findByTestId("profile-card");
    expect(bodies(calls, "POST /soul-auth/login/")).toEqual([{ soul_code: "SL-CN-000042", password: "my-long-password" }]);
  });

  it("‹ goes back to the password as another account", async () => {
    await toSecondStep();
    fireEvent.press(screen.getByTestId("mfa-change-account"));
    await screen.findByTestId("login-submit");
    expect(screen.getByTestId("login-soul-code").props.value).toBe("");
  });
});

describe("手机和恢复码都没有了", () => {
  it("names the hall and the soul code from step 1's answer, says the email cannot do it, and offers no way to write", async () => {
    stubApi({ "/soul-auth/login/": { status: 200, data: PENDING } });
    renderApp();
    fireEvent.changeText(await screen.findByTestId("login-soul-code"), "SL-CN-000042");
    fireEvent.changeText(screen.getByTestId("login-password"), "my-long-password");
    fireEvent.press(screen.getByTestId("login-submit"));
    fireEvent.press(await screen.findByTestId("lost-phone"));
    await screen.findByTestId("mfa-lost");
    expect(route()).toBe("MfaLost");
    expect(screen.getByText("请本殿官员帮你关闭")).toBeTruthy();
    expect(screen.getByTestId("lost-hall").props.children).toBe("第五殿");
    expect(screen.getByTestId("lost-code").props.children).toBe("SL-CN-000042");
    expect(screen.getByText("联系邮箱不能用来关闭两步验证。")).toBeTruthy();
    expect(screen.getByText("和找回密码收不到验证码时一样，去找本殿官员就行。")).toBeTruthy();
    expect(screen.queryByText(/写信/)).toBeNull();
    // Back to the second step, still waiting for the number.
    fireEvent.press(screen.getByTestId("header-back"));
    await screen.findByTestId("login-second-step");
  });
});

describe("changing the password signs the other devices out", () => {
  it("this phone sends its own push token, swaps to the new token pair, and the toast says the others are out", async () => {
    persistentStore.set(PUSH_TOKEN_KEY, "ExponentPushToken[this-phone]");
    const calls = signedIn({ "POST /me/password/": { status: 200, data: { access: "A2", refresh: "R2" } } });
    renderApp();
    await screen.findByTestId("profile-card");
    act(() => navigationRef.navigate("AccountPassword"));
    fireEvent.changeText(await screen.findByTestId("old-password"), "old-long-password");
    fireEvent.changeText(screen.getByTestId("new-password"), "a-new-long-password");
    fireEvent.changeText(screen.getByTestId("confirm-password"), "a-new-long-password");
    fireEvent.press(screen.getByTestId("change-password-submit"));
    expect((await screen.findByTestId("toast")).props.children).toBe("密码已修改,其他设备上的登录已退出");
    expect(bodies(calls, "POST /me/password/")).toEqual([
      { old_password: "old-long-password", new_password: "a-new-long-password", push_token: "ExponentPushToken[this-phone]" },
    ]);
    expect(secure.get(REFRESH_TOKEN_KEY)).toBe("R2");
    persistentStore.remove(PUSH_TOKEN_KEY);
  });
});
