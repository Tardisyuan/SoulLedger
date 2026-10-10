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

it("sends nothing while a field is empty", async () => {
  renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
  fireEvent.changeText(screen.getByTestId("password-old"), "x");
  await submit();
  expect(mockChange).not.toHaveBeenCalled();
});

it("refuses a short or mismatched new password before any request", async () => {
  renderOfficer(<ChangePasswordScreen onBack={() => {}} />);
  fillAll("oldpw-123", "short");
  await submit();
  expect(screen.getByText("密码至少8位")).toBeTruthy();
  fillAll("oldpw-123", "newpw-4567", "newpw-0000");
  await submit();
  expect(screen.getByText("两次输入的密码不一致")).toBeTruthy();
  expect(mockChange).not.toHaveBeenCalled();
});

it("shows each reason under its field by its code (not the server's English), keeps the form, and never echoes a password", async () => {
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
  expect(screen.getByText("旧密码不正确")).toBeTruthy();
  expect(screen.getByText("这个密码太常见,请换一个")).toBeTruthy();
  expect(screen.getByText("密码不能全是数字")).toBeTruthy();
  expect(screen.queryByText(/This password/)).toBeNull();
  expect(screen.getAllByTestId("password-new-error")).toHaveLength(2);
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
  expect(screen.getByText("! 网络错误")).toBeTruthy();
  mockChange.mockRejectedValueOnce(httpError(500, {}));
  await submit();
  expect(screen.getByText("! 密码修改失败")).toBeTruthy();
  expect(screen.queryByText("! 网络错误")).toBeNull();
});

it("我的 has the entry, and it opens the screen it names", async () => {
  const onOpen = jest.fn();
  renderOfficer(<MeTab onOpen={onOpen} />);
  fireEvent.press(await screen.findByTestId("me-password"));
  expect(onOpen).toHaveBeenCalledWith("password");
  fireEvent.press(screen.getByTestId("me-mfa"));
  expect(onOpen).toHaveBeenCalledWith("mfa");
});
