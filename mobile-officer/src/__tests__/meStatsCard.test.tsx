/** 我的 stats card: three numbers, taps open the stats screen; a failed load shows the failure line, not zeros. */
import { fireEvent, screen } from "@testing-library/react-native";

import { MeTab } from "../screens/me";
import { renderOfficer } from "./harness";

const mockStats = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { stats: () => mockStats() },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));

beforeEach(() => mockStats.mockReset());

it("shows the three numbers and opens the stats screen", async () => {
  mockStats.mockResolvedValue({ data: { concluded_this_month: 3, concluded_total: 41, open_claims: 2, appeals_reviewed: 5, appeals_in_review: 1 } });
  const onOpen = jest.fn();
  renderOfficer(<MeTab onOpen={onOpen} />);
  expect((await screen.findByTestId("me-stat-month")).props.children).toBe("3");
  expect(screen.getByTestId("me-stat-open").props.children).toBe("2");
  expect(screen.getByTestId("me-stat-review").props.children).toBe("1");
  fireEvent.press(screen.getByTestId("me-stats"));
  expect(onOpen).toHaveBeenCalledWith("stats");
});

it("a failed load shows no numbers", async () => {
  mockStats.mockRejectedValue(new Error("down"));
  renderOfficer(<MeTab onOpen={() => {}} />);
  expect(await screen.findByText("数没取到")).toBeTruthy();
  expect(screen.queryByTestId("me-stat-month")).toBeNull();
});
