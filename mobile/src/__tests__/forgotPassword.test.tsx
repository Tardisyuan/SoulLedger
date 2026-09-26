/**
 * 「忘记密码」 end to end: the real navigator from the sign-in screen, core's real
 * soul client — only the network (and the clock, for the countdowns) are doubles.
 *
 * The canvas (第三类 F 组) places each of its seven errors: about one field →
 * under that field; about the whole attempt → a banner at the top of the form.
 * Every placement below is asserted both ways — where it is, and that it is not
 * in the other place.
 */
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { RootNavigator, navigationRef } from "../navigation";
import { installMobilePlatform, sessionStore } from "../platform";
import { maskEmail, passwordStrength } from "../screens/forgotPassword";
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
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
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
const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState.disabled;

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

describe("pure pieces", () => {
  it("masks the address to its first character and its domain", () => {
    expect(maskEmail("soul@example.com")).toBe("s***@example.com");
    expect(maskEmail("not-an-address")).toBe("not-an-address");
  });

  it("scores four segments: length 8, letters and digits, length 12, a symbol", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abcdefgh")).toBe(1);
    expect(passwordStrength("abcdefg1")).toBe(2);
    expect(passwordStrength("abcdefghijk1")).toBe(3);
    expect(passwordStrength("abcdefghij-1")).toBe(4);
  });
});

describe("step 1: the email", () => {
  it("the sign-in screen opens it from beside the password label", async () => {
    stubApi({});
    await openForgot();
    expect(screen.getByText("没有绑定邮箱？")).toBeTruthy();
    expect(screen.getByText("重设密码 · 第 1 步 / 共 2 步")).toBeTruthy();
    expect(screen.getByText("填写绑定的邮箱")).toBeTruthy();
  });

  it("「请填写有效的邮箱」 goes as soon as the address is plausible, not on the next send", async () => {
    stubApi({});
    await openForgot();
    await sendEmail("not-an-address");
    expect(screen.getByText("! 请填写有效的邮箱")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("forgot-email"), "soul@exam");
    expect(screen.getByText("! 请填写有效的邮箱")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("forgot-email"), EMAIL);
    expect(screen.queryByText("! 请填写有效的邮箱")).toBeNull();
  });

  it("「没有绑定邮箱？」 opens 找殿司重设, which goes back to sign-in", async () => {
    stubApi({});
    await openForgot();
    fireEvent.press(screen.getByTestId("forgot-no-email"));
    expect(await screen.findByTestId("forgot-no-email-page")).toBeTruthy();
    expect(screen.getByText("找殿司重设")).toBeTruthy();
    expect(screen.getByText("殿司核对身份后为你重设，并告诉你临时密码。")).toBeTruthy();
    // The canvas's third step (bind an email under 「我 › 安全」) is a page the App does not have.
    expect(screen.queryByText(/我 › 安全/)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-back-to-login"));
    });
    expect(navigationRef.getRootState()?.routes.map((r) => r.name)).toEqual(["Login"]);
    expect(screen.queryByTestId("login-reset-notice")).toBeNull();
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
      expect(text("forgot-sent-title")).toBe(NEUTRAL);
      expect(screen.getByText("发往 s***@example.com。5 分钟内有效；没收到请看垃圾邮件。")).toBeTruthy();
      // Absence as well as presence: nothing beside it says what happened.
      expect(screen.queryByTestId("forgot-error")).toBeNull();
      // react-native-screens mints a random `screenId` per mount; everything else must match.
      trees.push(JSON.stringify(screen.toJSON(), (key, value) => (key === "screenId" ? undefined : value)));
      screen.unmount();
    }
    expect(trees[1]).toBe(trees[0]);
  });

  it("an address that is not one is refused under the field, without spending a send", async () => {
    const calls = stubApi({});
    await openForgot();
    await sendEmail("not-an-address");
    expect(screen.getByText("! 请填写有效的邮箱")).toBeTruthy();
    expect(calls).toEqual([]);
    expect(screen.queryByTestId("forgot-code")).toBeNull();
  });

  it("429 is a banner with the seconds; the button comes back when they run out", async () => {
    stubApi({ [REQUEST]: THROTTLED(48) });
    await openForgot();
    await sendEmail();
    expect(text("forgot-error-title")).toBe("! 请求太频繁");
    expect(text("forgot-error-body")).toBe("请 48 秒后再试。倒计时结束后按钮自动恢复。");
    expect(disabled("forgot-send")).toBe(true);
    expect(screen.queryByTestId("forgot-code")).toBeNull();
    act(() => jest.advanceTimersByTime(47_000));
    expect(text("forgot-error-body")).toBe("请 1 秒后再试。倒计时结束后按钮自动恢复。");
    expect(disabled("forgot-send")).toBe(true);
    act(() => jest.advanceTimersByTime(1_000));
    expect(disabled("forgot-send")).toBe(false);
  });

  it("offline is a banner with 重试, and what was typed stays", async () => {
    stubApi({ [REQUEST]: ["offline", { status: 200, data: { detail: "ok" } }] });
    await openForgot();
    await sendEmail();
    expect(text("forgot-error-title")).toBe("! 没有连接");
    expect(text("forgot-error-body")).toBe("已填的内容不会丢。恢复连接后再点一次。");
    expect(screen.getByTestId("forgot-email").props.value).toBe(EMAIL);
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-retry"));
    });
    expect(await screen.findByTestId("forgot-code")).toBeTruthy();
  });
});

describe("step 2: the code and the new password", () => {
  it("is headed step 2 of 2, with the countdown beside the code label", async () => {
    await toCodeStep();
    expect(screen.getByText("重设密码 · 第 2 步 / 共 2 步")).toBeTruthy();
    expect(screen.getByText("设一个新密码")).toBeTruthy();
    expect(text("forgot-expires-in")).toBe("5:00 后过期");
  });

  it.each([
    ["12345", "new-password-1", "new-password-1", "code", "! 验证码是 6 位数字"],
    ["123456", "short", "short", "new", "! 密码太弱"],
    ["123456", "new-password-1", "new-password-2", "confirm", "! 两次输入的密码不一样"],
  ])("code %p / %p / %p is refused on the device, under the %s field: %s", async (code, password, confirm, field, message) => {
    const calls = await toCodeStep();
    fillCode(code, password, confirm);
    await submitCode();
    expect(screen.getByTestId(`forgot-${field}-error`)).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByTestId("forgot-error")).toBeNull();
    expect(calls.filter((c) => c.url === "/auth/set-new-password/")).toEqual([]);
  });

  it.each([
    ["12345", "new-password-1", "new-password-1", "code", "forgot-code", "123456"],
    ["123456", "short", "short", "new", "forgot-new-password", "new-password-1"],
    ["123456", "new-password-1", "new-password-2", "confirm", "forgot-confirm-password", "new-password-1"],
    // Confirm is also valid again when the password it must match is changed to it.
    ["123456", "new-password-1", "new-password-2", "confirm", "forgot-new-password", "new-password-2"],
  ])("code %p / %p / %p: the %s message goes as soon as %s becomes valid", async (code, password, confirm, field, input, fixed) => {
    await toCodeStep();
    fillCode(code, password, confirm);
    await submitCode();
    expect(screen.getByTestId(`forgot-${field}-error`)).toBeTruthy();
    // Still not valid: the message stays.
    fireEvent.changeText(screen.getByTestId(input), fixed.slice(0, 4));
    expect(screen.getByTestId(`forgot-${field}-error`)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId(input), fixed);
    expect(screen.queryByTestId(`forgot-${field}-error`)).toBeNull();
  });

  it("the hidden code input shows nothing of itself, yet stays a real focusable field", async () => {
    await toCodeStep();
    const input = screen.getByTestId("forgot-code");
    const style = StyleSheet.flatten(input.props.style);
    expect(style).toMatchObject({ color: "transparent", fontSize: 1 });
    // Not 0: a fully transparent or zero-size field can lose the one-time-code autofill.
    expect(style.opacity).toBeGreaterThan(0);
    expect(input.props).toMatchObject({ caretHidden: true, selectionColor: "transparent", textContentType: "oneTimeCode", autoComplete: "one-time-code" });
  });

  it("pre-login chrome: the bar's app name is in the serif; the caret is ink", async () => {
    stubApi({});
    await openForgot();
    const title = screen.getByText("灵魂簿");
    expect(StyleSheet.flatten(title.props.style).fontFamily).toBe("NotoSerifSC_400");
    const email = screen.getByTestId("forgot-email");
    expect(email.props.cursorColor).toBeTruthy();
    expect(email.props.cursorColor).toBe(email.props.selectionHandleColor);
    expect(email.props.cursorColor).toBe(StyleSheet.flatten(email.props.style).color); // the ink token
  });

  it("a wrong code stays said while another field is edited", async () => {
    await toCodeStep();
    stubApi({ [CONFIRM]: { status: 400, data: refusal("reset_code_wrong", { attempts_left: 2 }) } });
    fillCode("123456", "new-password-1");
    await submitCode();
    expect(screen.getByTestId("forgot-code-error")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("forgot-new-password"), "new-password-12");
    expect(screen.getByTestId("forgot-code-error")).toBeTruthy();
  });

  // [what, reply, where: a field's testID or a banner's, title, body]
  it.each<[string, Reply, string, string, string | null]>([
    ["a wrong code, two tries left", { status: 400, data: refusal("reset_code_wrong", { attempts_left: 2 }) }, "forgot-code-error", "! 验证码不对", "还可以再试 2 次。"],
    ["a wrong code with no count", { status: 400, data: refusal("reset_code_wrong") }, "forgot-code-error", "! 验证码不对", null],
    ["a wrong code with none left", { status: 400, data: refusal("reset_code_wrong", { attempts_left: 0 }) }, "forgot-exhausted", "! 尝试次数已用完", "这个验证码已作废。请重新发送。"],
    ["tries used up (429: the code is gone)", { status: 429, data: refusal("reset_code_attempts_exceeded") }, "forgot-exhausted", "! 尝试次数已用完", "这个验证码已作废。请重新发送。"],
    ["an expired code", { status: 400, data: refusal("reset_code_expired") }, "forgot-expired", "! 验证码已过期", "5 分钟已过。重新发一个即可，已填的新密码会保留。"],
    // The sentence the App used to match for 「验证码错误」, under another code: the code wins.
    ["an expired code worded like a wrong one", { status: 400, data: { error: "验证码错误", code: "reset_code_expired" } }, "forgot-expired", "! 验证码已过期", "5 分钟已过。重新发一个即可，已填的新密码会保留。"],
    ["a password the validators refuse", { status: 400, data: refusal("weak_password") }, "forgot-new-error", "! 密码太弱", "至少 8 位，不能全是数字，也不能太常见。"],
    ["a throttled confirm (429)", THROTTLED(30), "forgot-error", "! 请求太频繁", "请 30 秒后再试。倒计时结束后按钮自动恢复。"],
    ["no network", "offline", "forgot-error", "! 没有连接", "已填的内容不会丢。恢复连接后再点一次。"],
    ["no soul account on the address (404)", { status: 404, data: refusal("no_soul_account") }, "forgot-error", "! 这个邮箱无法重设密码，请向所属殿司申请重置密码", null],
    ["an address shared by two accounts (409)", { status: 409, data: refusal("ambiguous_email") }, "forgot-error", "! 这个邮箱无法重设密码，请向所属殿司申请重置密码", null],
  ])("%s is said in its place", async (_, reply, where, title, body) => {
    await toCodeStep();
    stubApi({ [CONFIRM]: reply });
    fillCode("123456", "new-password-1");
    await submitCode();
    const node = screen.getByTestId(where);
    expect(node).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
    if (body) expect(screen.getByText(body)).toBeTruthy();
    // Absence: a field error is not also a banner, and a banner is not also under a field.
    const banners = ["forgot-error", "forgot-expired", "forgot-exhausted"];
    const fields = ["forgot-code-error", "forgot-new-error", "forgot-confirm-error"];
    for (const other of [...banners, ...fields].filter((id) => id !== where)) expect(screen.queryByTestId(other)).toBeNull();
    // Still here, still signed out, and nothing typed is lost.
    expect(screen.getByTestId("forgot-new-password").props.value).toBe("new-password-1");
    expect(secure.get(REFRESH_TOKEN_KEY)).toBeUndefined();
  });

  it("a throttled confirm holds 重设密码 until the seconds run out", async () => {
    await toCodeStep();
    stubApi({ [CONFIRM]: THROTTLED(30) });
    fillCode("123456", "new-password-1");
    await submitCode();
    expect(disabled("forgot-submit")).toBe(true);
    act(() => jest.advanceTimersByTime(30_000));
    expect(disabled("forgot-submit")).toBe(false);
  });

  it("counts down five minutes; the resend waits out the backend's pace, then works", async () => {
    await toCodeStep();
    expect(disabled("forgot-resend")).toBe(true);
    expect(text("forgot-resend-in")).toBe("重新发送（100 秒后可用）");

    act(() => jest.advanceTimersByTime(99_000));
    expect(text("forgot-expires-in")).toBe("3:21 后过期");
    expect(disabled("forgot-resend")).toBe(true);

    act(() => jest.advanceTimersByTime(1_000));
    expect(disabled("forgot-resend")).toBe(false);
    expect(screen.queryByTestId("forgot-resend-in")).toBeNull();

    const calls = stubApi({ [REQUEST]: { status: 200, data: { detail: "ok" } } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-resend"));
    });
    expect(calls.map((c) => c.body)).toEqual([{ email: EMAIL }]);
    // A fresh code: a fresh five minutes, and the resend waits again.
    expect(text("forgot-expires-in")).toBe("5:00 后过期");
    expect(disabled("forgot-resend")).toBe(true);
  });

  it("after five minutes the expiry is a banner whose 重新发送 keeps the new password", async () => {
    await toCodeStep();
    fireEvent.changeText(screen.getByTestId("forgot-new-password"), "new-password-1");
    act(() => jest.advanceTimersByTime(300_000));
    expect(text("forgot-expired-title")).toBe("! 验证码已过期");
    expect(screen.queryByTestId("forgot-expires-in")).toBeNull();
    stubApi({ [REQUEST]: { status: 200, data: { detail: "ok" } } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-banner-resend"));
    });
    expect(screen.queryByTestId("forgot-expired")).toBeNull();
    expect(text("forgot-expires-in")).toBe("5:00 后过期");
    expect(screen.getByTestId("forgot-new-password").props.value).toBe("new-password-1");
  });

  it("a resend the server rate-limits (429) says so, and waits out its retry_after", async () => {
    await toCodeStep();
    act(() => jest.advanceTimersByTime(100_000));
    stubApi({ [REQUEST]: THROTTLED(250) });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-resend"));
    });
    expect(text("forgot-error-title")).toBe("! 请求太频繁");
    // The server's word, not our 100-second pace, now holds the button.
    expect(disabled("forgot-resend")).toBe(true);
    act(() => jest.advanceTimersByTime(1_000));
    expect(text("forgot-resend-in")).toBe("重新发送（249 秒后可用）");
    act(() => jest.advanceTimersByTime(248_000));
    expect(disabled("forgot-resend")).toBe(true);
    act(() => jest.advanceTimersByTime(1_000));
    expect(disabled("forgot-resend")).toBe(false);
  });

  it("a 429 without retry_after leaves the resend on its own pace and names no seconds", async () => {
    await toCodeStep();
    act(() => jest.advanceTimersByTime(100_000));
    stubApi({ [REQUEST]: { status: 429, data: refusal("rate_limited") } });
    await act(async () => {
      fireEvent.press(screen.getByTestId("forgot-resend"));
    });
    expect(text("forgot-error-body")).toBe("请稍后再试。");
    act(() => jest.advanceTimersByTime(1_000));
    expect(disabled("forgot-resend")).toBe(false);
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
    expect(text("login-reset-title")).toBe("密码已重设");
    expect(text("login-reset-body")).toBe("请用新密码登录。其他设备上的登录已全部退出。");
    expect(navigationRef.getRootState()?.routes.map((r) => r.name)).toEqual(["Login"]);
    // No session: no token anywhere, no /me/, and the sign-in form is what is shown.
    expect(secure.get(REFRESH_TOKEN_KEY)).toBeUndefined();
    expect(sessionStore.get("soulledger_access")).toBeNull();
    expect(screen.getByTestId("login-submit")).toBeTruthy();
  });

  it("an earlier failed sign-in does not hide the notice: its error and the old password are cleared", async () => {
    stubApi({ "POST /soul-auth/login/": { status: 401, data: { detail: "x", code: "invalid_credentials" } } });
    renderApp();
    fireEvent.changeText(await screen.findByTestId("login-soul-code"), "ABCDEFGH23");
    fireEvent.changeText(screen.getByTestId("login-password"), "old-wrong-password");
    await act(async () => {
      fireEvent.press(screen.getByTestId("login-submit"));
    });
    expect(await screen.findByTestId("login-error")).toBeTruthy();

    fireEvent.press(screen.getByTestId("login-forgot"));
    await screen.findByTestId("forgot-email");
    stubApi({ [REQUEST]: { status: 200, data: { detail: "验证码已发送到邮箱" } } });
    await sendEmail();
    await screen.findByTestId("forgot-code");
    stubApi({ [CONFIRM]: { status: 200, data: { detail: "密码重置成功" } } });
    fillCode("123456", "new-password-1");
    await submitCode();

    expect(await screen.findByTestId("login-reset-notice")).toBeTruthy();
    expect(screen.queryByTestId("login-error")).toBeNull();
    expect(screen.getByTestId("login-password").props.value).toBe("");
    expect(screen.getByTestId("login-soul-code").props.value).toBe("ABCDEFGH23");
  });
});
