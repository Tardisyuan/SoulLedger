/**
 * The decision flow (spec §四, §五): the action bar, the two sheets, the reason that is flagged
 * only on confirm, a failure that keeps what was typed, and the "already handled" landing.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { Detail } from "../screens/detail";
import { httpError, renderOfficer } from "./harness";

const mockItem = jest.fn();
const mockApproveNode = jest.fn();
const mockAddCosigner = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { item: (...a: unknown[]) => mockItem(...a), addCosigner: (...a: unknown[]) => mockAddCosigner(...a), signerCandidates: jest.fn(async () => ({ data: [{ id: 2, name: "孟婆", username: "mengpo", role: "JUDGE" }] })) },
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

describe("approve with several passing verdicts", () => {
  it("sends the single accepted verdict as is", async () => {
    mockApproveNode.mockResolvedValue({});
    const { onSettled } = await open({ ...ITEM, required_verdicts: ["CONFIRMED", "FAILED"] });
    fireEvent.press(screen.getByTestId("action-approve"));
    await screen.findByTestId("sheet-approve");
    expect(screen.queryByTestId("decision-verdict")).toBeNull();
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(mockApproveNode).toHaveBeenCalledWith("wf-1", "node-1", { verdict: "CONFIRMED", notes: "", require_reason: true }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it("lets the officer choose when the node accepts more than one", async () => {
    mockApproveNode.mockResolvedValue({});
    const { onSettled } = await open({ ...ITEM, required_verdicts: ["PASSED", "CONFIRMED"] });
    fireEvent.press(screen.getByTestId("action-approve"));
    await screen.findByTestId("decision-verdict");
    fireEvent.press(screen.getByTestId("decision-verdict-CONFIRMED"));
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(mockApproveNode).toHaveBeenCalledWith("wf-1", "node-1", { verdict: "CONFIRMED", notes: "", require_reason: true }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });
});

describe("add signer", () => {
  it("adds the picked colleague through the server and reloads the item", async () => {
    mockAddCosigner.mockResolvedValue({ data: {} });
    await open();
    fireEvent.press(screen.getByTestId("action-cosign"));
    fireEvent.press(await screen.findByTestId("cosign-2"));
    fireEvent.press(screen.getByTestId("cosign-confirm"));
    await waitFor(() => expect(mockAddCosigner).toHaveBeenCalledWith("approval", "wf-1", 2));
    await waitFor(() => expect(mockItem.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByTestId("cosign-unavailable")).toBeNull();
  });

  it("turns into the disabled state (reason above the button) only when the server says not allowed", async () => {
    mockAddCosigner.mockRejectedValue(httpError(403, { code: "not_allowed", detail: "x" }));
    await open();
    fireEvent.press(screen.getByTestId("action-cosign"));
    fireEvent.press(await screen.findByTestId("cosign-2"));
    expect(screen.queryByTestId("cosign-unavailable")).toBeNull();
    fireEvent.press(screen.getByTestId("cosign-confirm"));
    expect(await screen.findByTestId("cosign-unavailable")).toBeTruthy();
    expect(screen.getByText(/现在不能加签/)).toBeTruthy();
    expect(screen.getByTestId("cosign-confirm").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("cosign-confirm").props.accessibilityHint).toBe("现在不能加签，只能查看候选人。");
    // the candidates stay choosable
    expect(screen.getByTestId("cosign-2")).toBeTruthy();
  });

  it("a refusal about the person is said in place and does not disable the button", async () => {
    mockAddCosigner.mockRejectedValue(httpError(400, { code: "duplicate", detail: "x" }));
    await open();
    fireEvent.press(screen.getByTestId("action-cosign"));
    fireEvent.press(await screen.findByTestId("cosign-2"));
    fireEvent.press(screen.getByTestId("cosign-confirm"));
    expect(await screen.findByTestId("cosign-problem")).toBeTruthy();
    expect(screen.getByTestId("cosign-confirm").props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId("cosign-unavailable")).toBeNull();
    expect(screen.getByTestId("cosign-confirm").props.accessibilityHint).toBeUndefined();
  });

  it("states the rules under the title", async () => {
    await open();
    fireEvent.press(screen.getByTestId("action-cosign"));
    expect(await screen.findByTestId("cosign-rules")).toBeTruthy();
    expect(screen.getByText(/加签人先批，你才能批/)).toBeTruthy();
  });
});

describe("waiting for an added signer", () => {
  const WAITING = {
    ...ITEM,
    cosigners: [{ user_id: 2, name: "孟判官", signed: false }],
    waiting_on_cosigner: { id: 2, name: "孟判官" },
  };

  it("lists the signer as owed, greys 批准 with the reason above and in its hint, and leaves 驳回 and 加签 alone", async () => {
    await open(WAITING);
    expect(screen.getByTestId("cosigner-2").props.children).toBe("◐ 孟判官 · 加签 · 待批");
    const reason = "等孟判官先批，你才能批。孟判官驳回则这一节点驳回。";
    expect(screen.getByTestId("detail-wait-cosigner").props.children).toBe(`◇ ${reason}`);
    const approve = screen.getByTestId("action-approve");
    expect(approve.props.accessibilityState.disabled).toBe(true);
    expect(approve.props.accessibilityHint).toBe(reason);
    expect(screen.getByTestId("action-reject").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId("action-cosign").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(approve);
    expect(screen.queryByTestId("sheet-approve")).toBeNull();
  });

  it("shows a signed co-signer with a tick and frees 批准", async () => {
    await open({ ...ITEM, cosigners: [{ user_id: 2, name: "孟判官", signed: true }], waiting_on_cosigner: null });
    expect(screen.getByTestId("cosigner-2").props.children).toBe("✓ 孟判官");
    expect(screen.queryByTestId("detail-wait-cosigner")).toBeNull();
    expect(screen.getByTestId("action-approve").props.accessibilityState.disabled).toBe(false);
  });
});
