/**
 * Owing a password change, the shell is the change screen and nothing else: no tab bar, no lists
 * that would only come back 403. Not owing, it is the shell it always was.
 */
import { screen } from "@testing-library/react-native";

import { Shell } from "../shell";
import { OFFICER, renderOfficer, sessionOf } from "./harness";

jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { changePassword: jest.fn(), notices: jest.fn() },
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

it("shows only the two-step screen (and signing out) while the server holds the session for it", async () => {
  renderOfficer(<Shell />, { session: sessionOf({ ...OFFICER, mfa_enabled: false, mfa_setup_required: true }) });
  expect(screen.getByTestId("mfa-setup-required")).toBeTruthy();
  expect(screen.getByTestId("mfa-hold-signout")).toBeTruthy();
  expect(screen.queryByTestId("tab-bar")).toBeNull();
  await screen.findByTestId("mfa-on");
});

it("shows only the change screen while the password is owed", () => {
  renderOfficer(<Shell />, { session: sessionOf({ ...OFFICER, password_change_required: true }) });
  expect(screen.getByTestId("password-screen")).toBeTruthy();
  expect(screen.getByTestId("password-must-change")).toBeTruthy();
  expect(screen.queryByTestId("password-screen-back")).toBeNull();
  expect(screen.queryByTestId("tab-bar")).toBeNull();
});
