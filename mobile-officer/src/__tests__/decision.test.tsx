/**
 * The decision flow (spec §四, §五): the action bar, the two sheets, the reason that is flagged
 * only on confirm, a failure that keeps what was typed, and the "already handled" landing.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { Detail } from "../screens/detail";
import { httpError, renderOfficer } from "./harness";

const mockItem = jest.fn();
const mockApproveNode = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { item: (...a: unknown[]) => mockItem(...a), signerCandidates: jest.fn(async () => ({ data: [{ id: 2, name: "孟婆", username: "mengpo", role: "JUDGE" }] })) },
}));
jest.mock("@soulledger/core/api/workflow", () => ({ workflowApi: { approveNode: (...a: unknown[]) => mockApproveNode(...a) } }));

const ITEM = {
  kind: "approval",
  id: "wf-1",
  title: "转生配额审批",
  created_at: "2026-10-09T01:00:00Z",
  actionable: true,
  state: "actionable",
  handled_by: null,
  handled_at: null,
  workflow_id: "wf-1",
  node_id: "node-1",
};

async function open(item: Record<string, unknown> = ITEM) {
  mockItem.mockResolvedValue({ data: item });
  const onSettled = jest.fn();
  renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={onSettled} />);
  await screen.findByTestId("todo-detail");
  return { onSettled };
}

beforeEach(() => jest.clearAllMocks());

describe("the action bar", () => {
  it("is 加签 · 驳回 · 批准 while the step is ours", async () => {
    await open();
    expect(screen.getByTestId("action-cosign")).toBeTruthy();
    expect(screen.getByTestId("action-reject")).toBeTruthy();
    expect(screen.getByTestId("action-approve")).toBeTruthy();
    expect(screen.getByTestId("detail-your-step")).toBeTruthy();
  });

  it("is gone, and a notice names who handled it, when someone else already did", async () => {
    await open({ ...ITEM, actionable: false, state: "already_handled", handled_by: { id: 3, name: "孟婆" } });
    expect(screen.queryByTestId("action-bar")).toBeNull();
    expect(screen.getByTestId("detail-handled").props.children).toContain("已由孟婆处理");
  });
});

describe("approve", () => {
  it("asks 批准这一签？ and sends the approval", async () => {
    mockApproveNode.mockResolvedValue({});
    const { onSettled } = await open();
    fireEvent.press(screen.getByTestId("action-approve"));
    expect(await screen.findByText("批准这一签？")).toBeTruthy();
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(mockApproveNode).toHaveBeenCalledWith("wf-1", "node-1", { verdict: "PASSED", notes: "", require_reason: true }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });
});

describe("reject", () => {
  async function openReject() {
    const view = await open();
    fireEvent.press(screen.getByTestId("action-reject"));
    await screen.findByTestId("sheet-reject");
    return view;
  }

  it("does not flag the empty reason until confirm is pressed, and never disables the button", async () => {
    await openReject();
    expect(screen.queryByText(/驳回必须写理由/)).toBeNull();
    expect(screen.getByTestId("decision-confirm").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText(/驳回必须写理由/)).toBeTruthy();
    expect(mockApproveNode).not.toHaveBeenCalled();
  });

  it("on failure shows 没能提交 · reason inside the sheet and keeps the typed reason", async () => {
    mockApproveNode.mockRejectedValue(httpError(409, { code: "already_handled", handled_by: { id: 3, name: "孟婆" } }));
    await openReject();
    fireEvent.changeText(screen.getByTestId("decision-reason"), "材料不全");
    fireEvent.press(screen.getByTestId("decision-confirm"));
    expect(await screen.findByText("! 没能提交 · 他人已代签")).toBeTruthy();
    expect(screen.getByTestId("decision-reason").props.value).toBe("材料不全");
    expect(mockApproveNode).toHaveBeenCalledWith("wf-1", "node-1", { verdict: "REJECTED", notes: "材料不全", require_reason: true });
  });

  it("a network error reads 网络错误 and also keeps the reason", async () => {
    mockApproveNode.mockRejectedValue(new Error("Network Error"));
    await openReject();
    fireEvent.changeText(screen.getByTestId("decision-reason"), "先退回");
    await act(async () => {
      fireEvent.press(screen.getByTestId("decision-confirm"));
    });
    expect(await screen.findByText("! 没能提交 · 网络错误")).toBeTruthy();
    expect(screen.getByTestId("decision-reason").props.value).toBe("先退回");
  });
});

describe("add signer", () => {
  it("lists the hall's colleagues, but cannot be submitted yet and says why", async () => {
    await open();
    fireEvent.press(screen.getByTestId("action-cosign"));
    expect(await screen.findByTestId("cosign-2")).toBeTruthy();
    expect(screen.getByTestId("cosign-confirm").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/还没开通/)).toBeTruthy();
  });
});
