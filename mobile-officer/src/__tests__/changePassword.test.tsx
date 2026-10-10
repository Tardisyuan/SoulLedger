/**
 * 修改密码 (from 我的): the three fields, the checks done before any request, the server's refusals
 * shown rule by rule under the field they are about, and the session left alone on success (as the
 * web profile page does -- the endpoint revokes nothing).
 */
import { act, fireEvent, screen } from "@testing-library/react-native";

import { ChangePasswordScreen } from "../screens/account";
import { MeTab } from "../screens/me";
import { httpError, renderOfficer, sessionOf, OFFICER } from "./harness";

const mockChange = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { changePassword: (...a: unknown[]) => mockChange(...a) },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

beforeEach(() => jest.clearAllMocks());

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
  renderOfficer(<ChangePasswordScreen onBack={onBack} />, { session });
  fillAll();
  await submit();
  expect(mockChange).toHaveBeenCalledWith("oldpw-123", "newpw-4567");
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(session.signOut).not.toHaveBeenCalled();
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

it("shows each of the server's rules under its field, keeps the form, and never echoes a password", async () => {
  mockChange.mockRejectedValue(httpError(400, { old_password: ["旧密码不正确"], new_password: ["密码太常见", "密码不能全是数字"] }));
  const onBack = jest.fn();
  renderOfficer(<ChangePasswordScreen onBack={onBack} />);
  fillAll("oldpw-123", "newpw-4567");
  await submit();
  expect(screen.getByText("旧密码不正确")).toBeTruthy();
  expect(screen.getByText("密码太常见")).toBeTruthy();
  expect(screen.getByText("密码不能全是数字")).toBeTruthy();
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
