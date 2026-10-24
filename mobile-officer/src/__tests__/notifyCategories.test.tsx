/** 通知类别(第三十四批 O-06):一个开关 = 网页的「站内」一列;点了就存,失败弹回。 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { mutedCount, visibleNotificationCategories } from "../rules";
import { NotifyScreen } from "../screens/notify";
import { renderOfficer } from "./harness";

const mockPrefs = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  authApi: { preferences: (...a: unknown[]) => mockPrefs(...a), updatePreferences: (...a: unknown[]) => mockUpdate(...a) },
}));

const ALL_ON = Object.fromEntries(
  ["account_security", "approval", "approval_timeout", "reassign", "password_help", "dispatch", "letter_handoff", "city_god"].map((c) => [c, { site: true, mail: false }])
);

describe("rules", () => {
  it("counts only the site column, and never a locked row", () => {
    expect(mutedCount(undefined, "JUDGE")).toBe(0);
    expect(mutedCount({ approval: { site: false }, dispatch: { site: false } }, "JUDGE")).toBe(2);
    expect(mutedCount({ account_security: { site: false }, approval_timeout: { site: false } }, "JUDGE")).toBe(0);
    expect(mutedCount({ approval: { site: true, mail: false } as never }, "JUDGE")).toBe(0);
  });

  it("shows 密码求助 to admins only", () => {
    expect(visibleNotificationCategories("JUDGE")).not.toContain("password_help");
    expect(visibleNotificationCategories("ADMIN")).toContain("password_help");
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrefs.mockResolvedValue({ data: { notifications: ALL_ON } });
});

describe("NotifyScreen", () => {
  it("saves the site cell on tap", async () => {
    mockUpdate.mockResolvedValue({ data: {} });
    renderOfficer(<NotifyScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId("notify-approval"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ notifications: { approval: { site: false } } }));
  });

  it("snaps back when saving fails", async () => {
    mockUpdate.mockRejectedValue(new Error("Network Error"));
    renderOfficer(<NotifyScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId("notify-approval"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("notify-switch-approval").props.accessibilityState).toEqual({ checked: true }));
  });

  it("does not make locked rows tappable", async () => {
    renderOfficer(<NotifyScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId("notify-account_security"));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
