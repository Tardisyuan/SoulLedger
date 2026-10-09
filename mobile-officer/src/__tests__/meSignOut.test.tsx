/** 我的: 退出登录 asks in the button's own place (it used to open below the fold, off screen). */
import { fireEvent, screen } from "@testing-library/react-native";

import { MeTab } from "../screens/me";
import { renderOfficer } from "./harness";

jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

describe("the sign-out confirm", () => {
  it("replaces the button where it stood, and cancel brings the button back", async () => {
    renderOfficer(<MeTab />);
    fireEvent.press(await screen.findByTestId("me-logout"));
    expect(screen.queryByTestId("me-logout")).toBeNull();
    expect(screen.getByTestId("me-logout-confirm")).toBeTruthy();
    fireEvent.press(screen.getByTestId("me-logout-cancel"));
    expect(screen.getByTestId("me-logout")).toBeTruthy();
    expect(screen.queryByTestId("me-logout-confirm")).toBeNull();
  });
});
