/**
 * 我的 › 姓名 (O-16): the row opens a one-field screen; a blank name is refused before any request;
 * a saved name goes into the cached session user (what 我的 and the rest of the app read) and the screen goes back.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";

import { DISPLAY_NAME_MAX, DisplayNameScreen } from "../screens/account";
import { MeTab } from "../screens/me";
import { ToastProvider } from "../shared";
import { httpError, renderOfficer, sessionOf, OFFICER } from "./harness";

const mockUpdate = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: {
    updateProfile: (...a: unknown[]) => mockUpdate(...a),
    profile: jest.fn(async () => ({ data: { email: "", email_verified: true } })),
    preferences: jest.fn(async () => ({ data: {} })),
  },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

beforeEach(() => jest.clearAllMocks());

const submit = () => act(async () => { fireEvent.press(screen.getByTestId("name-submit")); });

it("我的 shows the name on a row that opens the edit screen", async () => {
  const onOpen = jest.fn();
  renderOfficer(<MeTab onOpen={onOpen} />);
  expect(await screen.findByText(/阎罗/)).toBeTruthy();
  fireEvent.press(screen.getByTestId("me-name"));
  expect(onOpen).toHaveBeenCalledWith("name");
  // A long name is cut to one line (iPhone 17 simulator, 2026-10-16: 53 letters pushed 「姓名」 off the row).
  expect(screen.getByTestId("me-name-value").props.numberOfLines).toBe(1);
  expect(screen.getByText("姓名")).toBeTruthy();
});

it("starts from the current name and caps the field at the model's max_length", () => {
  renderOfficer(<DisplayNameScreen onBack={() => {}} />);
  expect(screen.getByTestId("name-input").props.value).toBe("阎罗");
  expect(screen.getByTestId("name-input").props.maxLength).toBe(DISPLAY_NAME_MAX);
  expect(DISPLAY_NAME_MAX).toBe(100);
});

it("a blank name is refused here and nothing is sent", async () => {
  const onBack = jest.fn();
  renderOfficer(<DisplayNameScreen onBack={onBack} />);
  fireEvent.changeText(screen.getByTestId("name-input"), "   ");
  await submit();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
  expect(screen.getByText("姓名不能为空")).toBeTruthy();
});

it("saves the trimmed name, updates the cached user, and goes back", async () => {
  mockUpdate.mockResolvedValue({ data: { display_name: "崔判官" } });
  const onBack = jest.fn();
  const session = sessionOf(OFFICER);
  renderOfficer(
    <ToastProvider>
      <DisplayNameScreen onBack={onBack} />
    </ToastProvider>,
    { session }
  );
  fireEvent.changeText(screen.getByTestId("name-input"), "  崔判官 ");
  await submit();
  expect(mockUpdate).toHaveBeenCalledWith({ display_name: "崔判官" });
  expect(session.setDisplayName).toHaveBeenCalledWith("崔判官");
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(screen.getByText("个人信息已更新")).toBeTruthy();
});

it("a refusal stays on the screen and leaves the cached user alone", async () => {
  mockUpdate.mockRejectedValue(httpError(400, { display_name: ["显示名不能为空。"] }));
  const onBack = jest.fn();
  const session = sessionOf(OFFICER);
  renderOfficer(
    <ToastProvider>
      <DisplayNameScreen onBack={onBack} />
    </ToastProvider>,
    { session }
  );
  fireEvent.changeText(screen.getByTestId("name-input"), "崔判官");
  await submit();
  expect(onBack).not.toHaveBeenCalled();
  expect(session.setDisplayName).not.toHaveBeenCalled();
  expect(screen.getByText("个人信息更新失败")).toBeTruthy();
});
