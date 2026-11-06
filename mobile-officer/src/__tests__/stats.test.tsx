/** 我的数: five numbers in two groups; all zero is one sentence; a failure leaves no old numbers; only 认领未结 opens anything. */
import { fireEvent, screen } from "@testing-library/react-native";

import { StatsScreen, allZero, monthSince } from "../screens/stats";
import { renderOfficer } from "./harness";

const mockStats = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { stats: () => mockStats() },
}));

const mockHall = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: { hallStats: () => mockHall() },
}));
const HALL = {
  timezone: "Asia/Shanghai",
  pending: 7,
  overdue: 2,
  concluded_this_month: 9,
  month_done_pct: 56,
  avg_days: 3.5,
  returned_this_month: 1,
  weeks: Array.from({ length: 12 }, (_, i) => ({ week_start: `2026-08-${String(i + 10).padStart(2, "0")}`, concluded: i, previous_quarter: 2 })),
};

const nums = { concluded_this_month: 3, concluded_total: 41, open_claims: 2, appeals_reviewed: 5, appeals_in_review: 1 };

beforeEach(() => {
  mockStats.mockReset();
  mockHall.mockReset().mockRejectedValue(new Error("not here"));
});

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

// v4: the hall's numbers (hall-stats) under 我的数; a failed load draws no hall group and no second failure line.
it("shows the hall's numbers from hall-stats, and nothing of them when it fails", async () => {
  mockStats.mockResolvedValue({ data: nums });
  mockHall.mockResolvedValue({ data: HALL });
  renderOfficer(<StatsScreen onBack={() => {}} onOpenQueue={() => {}} />);
  expect(await screen.findByTestId("stats-hall")).toBeTruthy();
  expect(screen.getByText("本月已结 56%")).toBeTruthy();
  expect(screen.getByText("3.5 日")).toBeTruthy();
  expect(screen.getByTestId("hall-overdue")).toBeTruthy();
});

it("a hall-stats failure leaves 我的数 alone", async () => {
  mockStats.mockResolvedValue({ data: nums });
  renderOfficer(<StatsScreen onBack={() => {}} onOpenQueue={() => {}} />);
  expect(await screen.findByTestId("stat-month")).toBeTruthy();
  expect(screen.queryByTestId("stats-hall")).toBeNull();
  expect(screen.queryByTestId("stats-retry")).toBeNull();
});
