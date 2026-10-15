/**
 * 修改密码 (from 我的): the three fields, the checks done before any request, the server's refusals
 * shown reason by reason (by code) under the field they are about, and on success the officer stays
 * signed in here (the server signed the OTHER devices out) with a toast that says so.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { platform } from "@soulledger/core/platform";

import { ChangePasswordScreen } from "../screens/account";
import { MeTab } from "../screens/me";
import { PUSH_TOKEN_KEY } from "../push";
import { ToastProvider } from "../shared";
import { httpError, renderOfficer, sessionOf, OFFICER } from "./harness";

const mockChange = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { changePassword: (...a: unknown[]) => mockChange(...a) },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  platform().persistent.remove(PUSH_TOKEN_KEY);
});

function fillAll(old = "oldpw-123", next = "newpw-4567", again = next) {
  fireEvent.changeText(screen.getByTestId("password-old"), old);
  fireEvent.changeText(screen.getByTestId("password-new"), next);
  fireEvent.changeText(screen.getByTestId("password-confirm"), again);
}
const submit = () => act(async () => { fireEvent.press(screen.getByTestId("password-submit")); });

it("asks the password managers for the right kind of field", () => {
  renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
  for (const id of ["password-old", "password-new", "password-confirm"]) expect(screen.getByTestId(id).props.secureTextEntry).toBe(true);
  expect(screen.getByTestId("password-old").props.textContentType).toBe("password");
  expect(screen.getByTestId("password-old").props.autoComplete).toBe("current-password");
  expect(screen.getByTestId("password-new").props.textContentType).toBe("newPassword");
  expect(screen.getByTestId("password-new").props.autoComplete).toBe("new-password");
});

it("sends old and new, goes back, and does not sign the officer out", async () => {
  mockChange.mockResolvedValue({ data: { detail: "ok" } });
  const onBack = jest.fn();
  const session = sessionOf(OFFICER);
  renderOfficer(
    <ToastProvider>
      <ChangePasswordScreen onBack={onBack} />
    </ToastProvider>,
    { session }
  );
  fillAll();
  await submit();
  expect(mockChange).toHaveBeenCalledWith("oldpw-123", "newpw-4567", undefined); // never registered: no token to keep
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(session.signOut).not.toHaveBeenCalled();
  expect(screen.getByText("密码已修改,其他设备上的登录已退出")).toBeTruthy();
});

it("sends this device's push token so the server keeps only that registration", async () => {
  platform().persistent.set(PUSH_TOKEN_KEY, "ExponentPushToken[this-device]");
  mockChange.mockResolvedValue({ data: { detail: "ok" } });
  renderOfficer(
    <ToastProvider>
      <ChangePasswordScreen onBack={() => {}} />
    </ToastProvider>
  );
  fillAll();
  await submit();
  expect(mockChange).toHaveBeenCalledWith("oldpw-123", "newpw-4567", "ExponentPushToken[this-device]");
});

it("sends nothing while a field is empty (the button stays pressable; the list says what is missing)", async () => {
  renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
  fireEvent.changeText(screen.getByTestId("password-old"), "x");
  await submit();
  expect(mockChange).not.toHaveBeenCalled();
});

describe("the password checklist (Design 第二十三批)", () => {
  const mark = (id: string) => screen.getByTestId(`pw-rules-${id}-mark`, { includeHiddenElements: true }).props.children as string;
  const matchMark = () => screen.getByTestId("pw-match-mark", { includeHiddenElements: true }).props.children as string;
  const rules = () => [mark("min_length"), mark("not_digits"), mark("not_current")];

  it("is listed on arrival, three rows, all ○", () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    expect(rules()).toEqual(["○", "○", "○"]);
    expect(matchMark()).toBe("○");
    expect(screen.getByTestId("pw-rules-note")).toBeTruthy();
  });

  it("ticks while typing without showing !, turns unmet into ! on leaving the box, and ticks again at once", () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    fireEvent.changeText(screen.getByTestId("password-old"), "oldpw-123");
    fireEvent.changeText(screen.getByTestId("password-new"), "1234");
    expect(rules()).toEqual(["○", "○", "✓"]);
    fireEvent(screen.getByTestId("password-new"), "blur");
    expect(rules()).toEqual(["!", "!", "✓"]);
    fireEvent.changeText(screen.getByTestId("password-new"), "oldpw-123");
    expect(rules()).toEqual(["✓", "✓", "!"]);
    fireEvent.changeText(screen.getByTestId("password-new"), "newpw-4567");
    expect(rules()).toEqual(["✓", "✓", "✓"]);
  });

  it("the confirmation is ○ while typed in and ! only after leaving it", () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    fireEvent.changeText(screen.getByTestId("password-new"), "newpw-4567");
    fireEvent.changeText(screen.getByTestId("password-confirm"), "newpw");
    expect(matchMark()).toBe("○");
    fireEvent(screen.getByTestId("password-confirm"), "blur");
    expect(matchMark()).toBe("!");
    fireEvent.changeText(screen.getByTestId("password-confirm"), "newpw-4567");
    expect(matchMark()).toBe("✓");
  });

  it("saving with a short or mismatched new password sends nothing and shows ! (no one-sentence local error)", async () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    fillAll("oldpw-123", "short");
    await submit();
    expect(mark("min_length")).toBe("!");
    expect(screen.queryByTestId("password-local-error")).toBeNull();
    expect(screen.queryByText("密码至少8位")).toBeNull();
    fillAll("oldpw-123", "newpw-4567", "newpw-0000");
    await submit();
    expect(matchMark()).toBe("!");
    expect(screen.queryByText("两次输入的密码不一致")).toBeNull();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("saving is always pressable: with the current password empty it sends nothing and marks the row", async () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    expect(screen.getByTestId("password-submit").props.accessibilityState?.disabled).toBeFalsy();
    fireEvent.changeText(screen.getByTestId("password-new"), "newpw-4567");
    fireEvent.changeText(screen.getByTestId("password-confirm"), "newpw-4567");
    await submit();
    expect(mockChange).not.toHaveBeenCalled();
    expect(mark("not_current")).toBe("!");
  });

  it("a refusal as too common is said above the list; the ticks stay, the other reasons stay as lines, the words stay", async () => {
    mockChange.mockRejectedValue(
      httpError(400, {
        new_password: [
          { code: "password_too_common", message: "This password is too common." },
          { code: "password_too_similar", message: "too similar" },
        ],
      })
    );
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    fillAll("oldpw-123", "newpw-4567");
    await submit();
    expect(screen.getByText("! 这个密码太容易被猜到")).toBeTruthy();
    expect(screen.getByText("它在常见密码名单里，或和你的名字、编号太像。换一个再保存。")).toBeTruthy();
    expect([...rules(), matchMark()]).toEqual(["✓", "✓", "✓", "✓"]);
    // Both "common" and "similar" are this one block, not one line each, and not the generic failure either.
    expect(screen.queryByTestId("password-new-error")).toBeNull();
    expect(screen.queryByText("这个密码太常见,请换一个")).toBeNull();
    expect(screen.queryByTestId("password-failure")).toBeNull();
    expect(screen.getByTestId("password-new").props.value).toBe("newpw-4567");
    expect(screen.getByTestId("password-confirm").props.value).toBe("newpw-4567");
  });
});

it("shows the old-password reason under its field and the other new-password reasons as lines, by code (not the server's English), keeps the form, and never echoes a password", async () => {
  mockChange.mockRejectedValue(
    httpError(400, {
      old_password: ["旧密码不正确"],
      new_password: [
        { code: "password_too_common", message: "This password is too common." },
        { code: "password_entirely_numeric", message: "This password is entirely numeric." },
      ],
    })
  );
  const onBack = jest.fn();
  renderOfficer(<ChangePasswordScreen onBack={onBack} />);
  fillAll("oldpw-123", "newpw-4567");
  await submit();
  expect(screen.getByText("当前密码不正确")).toBeTruthy();
  // "Too common" is the checklist's block now (see above); the numeric reason is still its own line.
  expect(screen.getByText("! 这个密码太容易被猜到")).toBeTruthy();
  expect(screen.queryByText("这个密码太常见,请换一个")).toBeNull();
  expect(screen.getByText("密码不能全是数字")).toBeTruthy();
  expect(screen.queryByText(/This password/)).toBeNull();
  expect(screen.getAllByTestId("password-new-error")).toHaveLength(1);
  expect(screen.getAllByTestId("password-old-error")).toHaveLength(1);
  expect(onBack).not.toHaveBeenCalled();
  expect(screen.getByTestId("password-new").props.value).toBe("newpw-4567");
  expect(screen.queryByText(/oldpw-123|newpw-4567/)).toBeNull();
});

it("says network when there was no answer, and a plain failure when the server gave no reason", async () => {
  mockChange.mockRejectedValueOnce(new Error("Network Error"));
  renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
  fillAll();
  await submit();
  expect(screen.getByText("网络错误")).toBeTruthy();
  mockChange.mockRejectedValueOnce(httpError(500, {}));
  await submit();
  expect(screen.getByText("密码修改失败")).toBeTruthy();
  expect(screen.queryByText("网络错误")).toBeNull();
});

it("我的 has the entry, and it opens the screen it names", async () => {
  const onOpen = jest.fn();
  renderOfficer(<MeTab onOpen={onOpen} />);
  fireEvent.press(await screen.findByTestId("me-password"));
  expect(onOpen).toHaveBeenCalledWith("password");
  fireEvent.press(screen.getByTestId("me-mfa"));
  expect(onOpen).toHaveBeenCalledWith("mfa");
});

describe("when the password must be changed first (first sign-in, an administrator's reset, aged out)", () => {
  const OWING = { ...OFFICER, password_change_required: true };

  it("says why, has no way back, and offers signing out", () => {
    const session = sessionOf(OWING);
    renderOfficer(<ChangePasswordScreen required onBack={() => {}} />, { session });
    expect(screen.getByTestId("password-must-change")).toBeTruthy();
    expect(screen.queryByTestId("password-screen-back")).toBeNull();
    fireEvent.press(screen.getByTestId("password-signout"));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it("a successful change clears the flag", async () => {
    mockChange.mockResolvedValue({ data: { detail: "ok" } });
    const session = sessionOf(OWING);
    renderOfficer(<ToastProvider><ChangePasswordScreen required onBack={() => {}} /></ToastProvider>, { session });
    fillAll();
    await submit();
    expect(session.setPasswordChangeRequired).toHaveBeenCalledWith(false);
  });

  it("an ordinary visit from 我的 shows no such line and does not touch the flag", async () => {
    mockChange.mockResolvedValue({ data: { detail: "ok" } });
    const session = sessionOf(OFFICER);
    renderOfficer(<ToastProvider><ChangePasswordScreen onBack={() => {}} /></ToastProvider>, { session });
    expect(screen.queryByTestId("password-must-change")).toBeNull();
    expect(screen.getByTestId("password-screen-back")).toBeTruthy();
    fillAll();
    await submit();
    expect(session.setPasswordChangeRequired).not.toHaveBeenCalled();
  });
});

describe("an administrator needs 12", () => {
  const ADMIN = { ...OFFICER, role: "ADMIN" };

  it("the first rule asks for 12 and eleven is not enough to send", async () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />, { user: ADMIN });
    expect(screen.getByText("至少 12 位（管理员）")).toBeTruthy();
    fillAll("oldpw-123", "newpw-45678"); // 11
    await submit();
    expect(mockChange).not.toHaveBeenCalled();
    fillAll("oldpw-123", "newpw-456789"); // 12
    mockChange.mockResolvedValue({ data: { detail: "ok" } });
    await submit();
    expect(mockChange).toHaveBeenCalled();
  });

  it("a normal officer still needs 8", () => {
    renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
    expect(screen.getByText("至少 8 位")).toBeTruthy();
  });
});
