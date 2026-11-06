/**
 * 滑卡审判(v4 S09 / S10):三个圆钮的路径。拖动本身 jest 看不见(CLAUDE.md:按住 / 滑动手势要上模拟器),
 * 这里验的是按钮发出去的东西、被天平挡住的方向、「不过」没选理由时不能落印、待定要理由。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { SwipeScreen } from "../screens/swipe";
import { renderOfficer } from "./harness";

const mockList = jest.fn();
const mockCounts = jest.fn();
const mockGet = jest.fn();
const mockConclude = jest.fn();
const mockDefer = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    list: (...a: unknown[]) => mockList(...a),
    queueCounts: () => mockCounts(),
    get: (...a: unknown[]) => mockGet(...a),
    conclude: (...a: unknown[]) => mockConclude(...a),
    defer: (...a: unknown[]) => mockDefer(...a),
    undefer: jest.fn(async () => ({})),
    negativeConfessions: jest.fn(async () => ({ data: { items: [] } })),
  },
}));

const CASE = {
  id: "j-1",
  case_number: "DY-2026-0412",
  soul: "s-1",
  soul_name: "李青竹",
  civilization: "CHINESE",
  created_at: "2026-11-01T00:00:00Z",
  merit_score: 42,
  demerit_score: 18,
  deadline_remaining_seconds: 86_400 * 3,
  conclude_refusal: "",
  admitted_balance: {},
};

function serve(c: Record<string, unknown> = CASE) {
  mockList.mockResolvedValue({ data: { results: [c], count: 1 } });
  mockCounts.mockResolvedValue({ data: { mine: 1, unclaimed: 0, others: 0, deferred: 0, total: 1 } });
  mockGet.mockResolvedValue({ data: c });
  mockConclude.mockResolvedValue({ data: {} });
  mockDefer.mockResolvedValue({ data: {} });
}

beforeEach(() => jest.clearAllMocks());

it("右边圆钮:通过,直接落印,只带裁决", async () => {
  serve();
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  expect(await screen.findByText("42/18")).toBeTruthy();
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("j-1"));
  await waitFor(() => expect(screen.getByTestId("swipe-pass").props.accessibilityState.disabled).toBe(false));
  await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
  await waitFor(() => expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PASSED" }));
});

it("左边圆钮:先选理由;没选时「不过 · 落印」是灰的,选了才发,带罪目", async () => {
  serve();
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("swipe-fail").props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByTestId("swipe-fail"));
  expect(screen.getByTestId("reject-confirm").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByTestId("reject-TRADE_FRAUD"));
  expect(screen.getByTestId("reject-preview")).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId("reject-confirm")));
  await waitFor(() =>
    expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "FAILED", fail_reasons: ["TRADE_FRAUD"], fail_reason_note: "" })
  );
});

it("埃及:天平判了通过,左边圆钮不可点", async () => {
  serve({ ...CASE, civilization: "EGYPTIAN", admitted_balance: { weighing: { weighed_verdict: "PASSED" } } });
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("swipe-pass").props.accessibilityState.disabled).toBe(false));
  expect(screen.getByTestId("swipe-fail").props.accessibilityState.disabled).toBe(true);
});

it("按住待定:松手后要写理由,空着不发", async () => {
  serve();
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("swipe-hold").props.accessibilityState.disabled).toBe(false));
  const hold = screen.getByTestId("swipe-hold");
  fireEvent(hold, "pressIn");
  fireEvent(hold, "longPress");
  fireEvent(hold, "pressOut");
  const sheet = await screen.findByTestId("swipe-defer-sheet");
  expect(sheet).toBeTruthy();
  fireEvent.press(screen.getByTestId("judgment-sheet-confirm"));
  expect(mockDefer).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId("judgment-reason"), "等证据");
  await act(async () => fireEvent.press(screen.getByTestId("judgment-sheet-confirm")));
  await waitFor(() => expect(mockDefer).toHaveBeenCalledWith("j-1", "等证据"));
  expect(await screen.findByTestId("swipe-undo")).toBeTruthy();
});

it("手上没有能判的:空状态", async () => {
  serve({ ...CASE, conclude_refusal: "at_city_god" });
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  expect(await screen.findByTestId("swipe-empty")).toBeTruthy();
});
