/**
 * A cooldown-shortening item: the soul's 「希望缩短到几天」 pre-fills the officer's days field and
 * is shown beside it; the officer may edit it, and the 0 <= days < remaining rule is unchanged.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { Detail } from "../screens/detail";
import { renderOfficer } from "./harness";

const mockShortening = jest.fn();
const mockApprove = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { item: jest.fn(async () => ({ data: ITEM })), signerCandidates: jest.fn(async () => ({ data: [] })) },
}));
jest.mock("@soulledger/core/api/soul-accounts", () => ({
  soulAccountsApi: {
    cooldownShortening: (...a: unknown[]) => mockShortening(...a),
    approveCooldownShortening: (...a: unknown[]) => mockApprove(...a),
  },
}));

const ITEM = {
  kind: "cooldown",
  id: "c-1",
  title: "李四",
  created_at: "2026-10-09T01:00:00Z",
  actionable: true,
  state: "actionable",
  handled_by: null,
  handled_at: null,
};

const onSettled = jest.fn();

async function openApprove(desired: number | null) {
  mockShortening.mockResolvedValue({ data: { reason: "家中有事", remaining_days: 10, desired_remaining_days: desired } });
  renderOfficer(<Detail target={{ type: "todo", kind: "cooldown", id: "c-1" }} onBack={() => {}} onSettled={onSettled} />);
  await screen.findByTestId("todo-detail");
  await screen.findByText("家中有事");
  fireEvent.press(screen.getByTestId("action-approve"));
  await screen.findByTestId("sheet-approve");
}

beforeEach(() => jest.clearAllMocks());

it("pre-fills the days with the wish, shows it beside the field, and lets the officer edit it", async () => {
  mockApprove.mockResolvedValue({});
  await openApprove(3);
  expect(screen.getByTestId("decision-days").props.value).toBe("3");
  expect(screen.getByTestId("decision-desired").props.children).toBe("申请希望：还剩 3 天");
  fireEvent.changeText(screen.getByTestId("decision-days"), "5");
  fireEvent.press(screen.getByTestId("decision-confirm"));
  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("c-1", 5, ""));
  await waitFor(() => expect(onSettled).toHaveBeenCalled());
});

it("treats a wish of 0 as a wish, and keeps the rule: a value not below the days left is refused", async () => {
  await openApprove(0);
  expect(screen.getByTestId("decision-days").props.value).toBe("0");
  expect(screen.getByTestId("decision-desired").props.children).toBe("申请希望：还剩 0 天");
  fireEvent.changeText(screen.getByTestId("decision-days"), "10");
  fireEvent.press(screen.getByTestId("decision-confirm"));
  expect(await screen.findByText(/天数要是整数/)).toBeTruthy();
  expect(mockApprove).not.toHaveBeenCalled();
});

it("without a wish the field starts empty as before and no wish line is shown", async () => {
  await openApprove(null);
  expect(screen.getByTestId("decision-days").props.value).toBe("");
  expect(screen.queryByTestId("decision-desired")).toBeNull();
  expect(screen.queryByTestId("detail-desired")).toBeNull();
});
