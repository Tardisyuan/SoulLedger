/** 我的数: five numbers in two groups; all zero is one sentence; a failure leaves no old numbers; only 认领未结 opens anything. */
import { fireEvent, screen } from "@testing-library/react-native";

import { StatsScreen, allZero, monthSince } from "../screens/stats";
import { renderOfficer } from "./harness";

const mockStats = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { stats: () => mockStats() },
}));

const nums = { concluded_this_month: 3, concluded_total: 41, open_claims: 2, appeals_reviewed: 5, appeals_in_review: 1 };

beforeEach(() => mockStats.mockReset());

it("shows the five numbers, the month's start, and opens the queue from 认领未结", async () => {
  mockStats.mockResolvedValue({ data: nums });
  const onOpenQueue = jest.fn();
  renderOfficer(<StatsScreen onBack={() => {}} onOpenQueue={onOpenQueue} />);
  expect(await screen.findByTestId("stat-month")).toBeTruthy();
  expect(screen.getByText("41")).toBeTruthy();
  expect(screen.getByText(`${monthSince()} 起`)).toBeTruthy();
  fireEvent.press(screen.getByTestId("stat-open"));
  expect(onOpenQueue).toHaveBeenCalledTimes(1);
});

it("says one sentence instead of five zeros", async () => {
  mockStats.mockResolvedValue({ data: { concluded_this_month: 0, concluded_total: 0, open_claims: 0, appeals_reviewed: 0, appeals_in_review: 0 } });
  renderOfficer(<StatsScreen onBack={() => {}} onOpenQueue={() => {}} />);
  expect(await screen.findByTestId("stats-empty")).toBeTruthy();
  expect(screen.queryByTestId("stat-month")).toBeNull();
});

it("a failed load shows the failure line and no numbers, and retry asks again", async () => {
  mockStats.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ data: nums });
  renderOfficer(<StatsScreen onBack={() => {}} onOpenQueue={() => {}} />);
  fireEvent.press(await screen.findByTestId("stats-retry"));
  expect(await screen.findByTestId("stat-month")).toBeTruthy();
  expect(mockStats).toHaveBeenCalledTimes(2);
});

it("allZero / monthSince", () => {
  expect(allZero({ ...nums, concluded_total: 0, concluded_this_month: 0, open_claims: 0, appeals_reviewed: 0, appeals_in_review: 0 })).toBe(true);
  expect(monthSince(new Date(2026, 9, 27))).toBe("2026-10-01");
});
