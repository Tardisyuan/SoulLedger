/**
 * 「忘记密码」 end to end: the real navigator from the sign-in screen, core's real
 * soul client — only the network (and the clock, for the two countdowns) are doubles.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, sessionStore } from "../platform";
import { SessionProvider } from "../session";
import { stubApi, type Reply } from "./stubApi";

const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const NEUTRAL = "如果这个邮箱绑定了灵魂账号，验证码已发出";
const EMAIL = "soul@example.com";
const REQUEST = "POST /auth/reset-password/";
const CONFIRM = "POST /auth/set-new-password/";
/** Refusals as the backend sends them: `{error, code}` — the App reads only `code`. */
const refusal = (code: string, extra: Record<string, unknown> = {}) => ({ error: "（任意措辞）", code, ...extra });
const THROTTLED = (retry_after: number): Reply => ({ status: 429, data: refusal("rate_limited", { retry_after }) });

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
  jest.useFakeTimers({ now: new Date("2026-09-25T08:00:00Z") });
  installMobilePlatform();
  secure.clear();
  sessionStore.remove("soulledger_access");
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

const text = (testID: string) => {
  const node = screen.getByTestId(testID);
  const flat = (c: unknown): string => (Array.isArray(c) ? c.map(flat).join("") : typeof c === "string" ? c : "");
  return flat(node.props.children);
};

async function openForgot() {
  renderApp();
  fireEvent.press(await screen.findByTestId("login-forgot"));
  await screen.findByTestId("forgot-email");
}

async function sendEmail(address = EMAIL) {
  fireEvent.changeText(screen.getByTestId("forgot-email"), address);
  await act(async () => {
    fireEvent.press(screen.getByTestId("forgot-send"));
  });
}

async function toCodeStep(reply: Reply = { status: 200, data: { detail: "验证码已发送到邮箱" } }) {
  const calls = stubApi({ [REQUEST]: reply });
  await openForgot();
  await sendEmail();
  await screen.findByTestId("forgot-code");
  return calls;
}

function fillCode(code: string, password: string, confirm = password) {
  fireEvent.changeText(screen.getByTestId("forgot-code"), code);
  fireEvent.changeText(screen.getByTestId("forgot-new-password"), password);
  fireEvent.changeText(screen.getByTestId("forgot-confirm-password"), confirm);
}

async function submitCode() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("forgot-submit"));
  });
}

describe("step 1: the email", () => {
  it("the sign-in screen opens it; the no-email route to the hall is on screen before anything is sent", async () => {
    stubApi({});
    await openForgot();
    expect(text("forgot-no-email")).toBe("没有绑定邮箱的灵魂收不到验证码，请向所属殿司申请重置密码。");
  });

  // THE GUARD. Mutation-proved: see cloud-reports/soul-app-password-reset.md.
  it("a 200 and a 400 (an address the server will not take) render the SAME screen, word for word", async () => {
    const trees: string[] = [];
    for (const reply of [
      { status: 200, data: { detail: "验证码已发送到邮箱" } },
      { status: 400, data: { email: ["该邮箱不存在"] } },
    ]) {
      const calls = await toCodeStep(reply);
      expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([["POST", "/auth/reset-password/", { email: EMAIL }]]);
      expect(text("forgot-sent")).toBe(NEUTRAL);
      // Absence as well as presence: nothing beside it says what happened.
      expect(screen.queryByTestId("forgot-error")).toBeNull();
      // react-native-screens mints a random `screenId` per mount; everything else must match.
      trees.push(JSON.stringify(screen.toJSON(), (key, value) => (key === "screenId" ? undefined : value)));
      screen.unmount();
    }
    expect(trees[1]).toBe(trees[0]);
  });

  it("an address that is not one is refused on the device, without spending a send", async () => {
    const calls = stubApi({});
    await openForgot();
    await sendEmail("not-an-address");
    expect(screen.getByText("请填写有效的邮箱")).toBeTruthy();
    expect(calls).toEqual([]);
    expect(screen.queryByTestId("forgot-code")).toBeNull();
  });

  it("429 says so and stays on step 1 — the limit is counted before any lookup, so it says nothing about the address", async () => {
    stubApi({ [REQUEST]: THROTTLED(300) });
    await openForgot();
    await sendEmail();
    expect(text("forgot-error")).toBe("尝试过于频繁,请稍后再试");
    expect(screen.queryByTestId("forgot-sent")).toBeNull();
    expect(screen.queryByTestId("forgot-code")).toBeNull();
  });

  it("offline says so, with a retry, and stays on step 1", async () => {
    stubApi({ [REQUEST]: ["offline", { status: 200, data: { detail: "ok" } }] });
    await openForgot();
    await sendEmail();
    expect(text("forgot-error")).toBe("无法连接服务器,请检查网络后重试");
    await act(async () => {
      fireEvent.press(screen.getByText("重试"));
    });
    expect(await screen.findByTestId("forgot-code")).toBeTruthy();
  });
});

describe("step 2: the code and the new password", () => {
  it("explains the no-email route again under the neutral sentence", async () => {
    await toCodeStep();
    expect(text("forgot-no-email")).toContain("所属殿司");
  });

  it.each([
    ["12345", "new-password-1", "new-password-1", "验证码是 6 位数字"],
    ["12a456", "new-password-1", "new-password-1", "验证码是 6 位数字"],
    ["123456", "short", "short", "新密码至少 8 位"],
    ["123456", "new-password-1", "new-password-2", "两次输入的新密码不一致"],
  ])("code %p / %p / %p is refused on the device: %s", async (code, password, confirm, message) => {
    const calls = await toCodeStep();
    fillCode(code, password, confirm);
    await submitCode();
    expect(screen.getByText(message)).toBeTruthy();
    expect(calls.filter((c) => c.url === "/auth/set-new-password/")).toEqual([]);
  });

  it.each<[string, Reply, string]>([
    ["a wrong code", { status: 400, data: refusal("reset_code_wrong") }, "验证码不正确"],
    ["an expired code", { status: 400, data: refusal("reset_code_expired") }, "验证码已失效，请重新发送"],
    // The sentence the App used to match for 「验证码错误」, under another code: the code wins.
    ["an expired code worded like a wrong one", { status: 400, data: { error: "验证码错误", code: "reset_code_expired" } }, "验证码已失效，请重新发送"],
    ["a password the validators refuse", { status: 400, data: refusal("weak_password") }, "新密码强度不足,请换一个更长、更不常见的密码"],
    ["five wrong codes (429: the code is gone)", { status: 429, data: refusal("reset_code_attempts_exceeded") }, "验证码错误次数过多，已作废，请重新发送"],
    ["a throttled confirm (429)", THROTTLED(30), "尝试过于频繁,请稍后再试"],
    ["no network", "offline", "无法连接服务器,请检查网络后重试"],
    ["no soul account on the address (404)", { status: 404, data: refusal("no_soul_account") }, "这个邮箱无法重设密码，请向所属殿司申请重置密码"],
    ["an address shared by two accounts (409)", { status: 409, data: refusal("ambiguous_email") }, "这个邮箱无法重设密码，请向所属殿司申请重置密码"],
  ])("%s is said as such", async (_, reply, message) => {
    await toCodeStep();
    stubApi({ [CONFIRM]: reply });
    fillCode("123456", "new-password-1");
    await submitCode();
    expect(screen.getByText(message)).toBeTruthy();
    // Still here, still signed out.
    expect(screen.getByTestId("forgot-code")).toBeTruthy();
    expect(secure.get(REFRESH_TOKEN_KEY)).toBeUndefined();
  });

  it("counts down five minutes; the resend waits out the backend's pace, then works", async () => {
    await toCodeStep();
    expect(screen.getByText("5:00")).toBeTruthy();
    const resend = screen.getByTestId("forgot-resend");
    expect(resend.props.accessibilityState.disabled).toBe(true);
    expect(text("forgot-resend-in")).toBe("1:40 后可重新发送");

    act(() => jest.advanceTimersByTime(99_000));
    expect(screen.getByText("3:21")).toBeTruthy();
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(true);

    act(() => jest.advanceTimersByTime(1_000));
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId("forgot-resend-in")).toBeNull();

    const calls = stubApi({ [REQUEST]: { status: 200, data: { detail: "ok" } } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-resend"));
    });
    expect(calls.map((c) => c.body)).toEqual([{ email: EMAIL }]);
    // A fresh code: a fresh five minutes, and the resend waits again.
    expect(screen.getByText("5:00")).toBeTruthy();
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(true);
  });

  it("after five minutes the code is said to have expired", async () => {
    await toCodeStep();
    act(() => jest.advanceTimersByTime(300_000));
    expect(text("forgot-expired")).toBe("验证码已失效，请重新发送");
    expect(screen.queryByTestId("forgot-expires-in")).toBeNull();
  });

  it("a resend the server rate-limits (429) says so, and waits out its retry_after", async () => {
    await toCodeStep();
    act(() => jest.advanceTimersByTime(100_000));
    stubApi({ [REQUEST]: THROTTLED(250) });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-resend"));
    });
    expect(text("forgot-error")).toBe("尝试过于频繁,请稍后再试");
    // The server's word, not our 100-second pace, now holds the button.
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(true);
    act(() => jest.advanceTimersByTime(1_000));
    expect(text("forgot-resend-in")).toBe("4:09 后可重新发送");
    act(() => jest.advanceTimersByTime(248_000));
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(true);
    act(() => jest.advanceTimersByTime(1_000));
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(false);
  });

  it("a 429 without retry_after leaves the resend on its own pace", async () => {
    await toCodeStep();
    act(() => jest.advanceTimersByTime(100_000));
    stubApi({ [REQUEST]: { status: 429, data: refusal("rate_limited") } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-resend"));
    });
    expect(text("forgot-error")).toBe("尝试过于频繁,请稍后再试");
    act(() => jest.advanceTimersByTime(1_000));
    expect(screen.getByTestId("forgot-resend").props.accessibilityState.disabled).toBe(false);
  });
});

describe("success", () => {
  it("returns to sign-in with a notice, and does not sign in", async () => {
    await toCodeStep();
    const calls = stubApi({ [CONFIRM]: { status: 200, data: { detail: "密码重置成功" } } });
    fillCode("123456", "new-password-1");
    await submitCode();
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/auth/set-new-password/", { email: EMAIL, code: "123456", new_password: "new-password-1" }],
    ]);
    expect(await screen.findByTestId("login-reset-notice")).toBeTruthy();
    expect(text("login-reset-notice")).toBe("密码已重设，请用新密码登录");
    expect(navigationRef.getRootState()?.routes.map((r) => r.name)).toEqual(["Login"]);
    // No session: no token anywhere, no /me/, and the sign-in form is what is shown.
    expect(secure.get(REFRESH_TOKEN_KEY)).toBeUndefined();
    expect(sessionStore.get("soulledger_access")).toBeNull();
    expect(screen.getByTestId("login-submit")).toBeTruthy();
  });
});
