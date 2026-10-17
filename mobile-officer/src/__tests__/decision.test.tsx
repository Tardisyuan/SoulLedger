/**
 * The decision flow (spec §四, §五): the action bar, the two sheets, the reason that is flagged
 * only on confirm, a failure that keeps what was typed, and the "already handled" landing.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { Detail } from "../screens/detail";
import { ToastProvider } from "../shared";
import { httpError, renderOfficer } from "./harness";

const mockItem = jest.fn();
const mockApproveNode = jest.fn();
const mockAddCosigner = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { item: (...a: unknown[]) => mockItem(...a), addCosigner: (...a: unknown[]) => mockAddCosigner(...a), signerCandidates: jest.fn(async () => ({ data: [{ id: 2, name: "孟婆", username: "mengpo", role: "JUDGE" }] })) },
}));
jest.mock("@soulledger/core/api/workflow", () => ({ workflowApi: { approveNode: (...a: unknown[]) => mockApproveNode(...a) } }));
const mockDecideCross = jest.fn();
const mockDispatchApprove = jest.fn();
jest.mock("@soulledger/core/api/soul-accounts", () => ({
  ...jest.requireActual("@soulledger/core/api/soul-accounts"),
  soulAccountsApi: { decideCrossCivilization: (...a: unknown[]) => mockDecideCross(...a) },
}));
jest.mock("@soulledger/core/api/dispatch", () => ({
  ...jest.requireActual("@soulledger/core/api/dispatch"),
  dispatchApi: { approve: (...a: unknown[]) => mockDispatchApprove(...a), reject: jest.fn() },
}));

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
    expect(await screen.findByText("没能提交 · 他人已代签")).toBeTruthy();
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
    expect(await screen.findByText("没能提交 · 网络错误")).toBeTruthy();
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
    // The candidate row reads the role through the bundles (seen as raw "JUDGE" on the emulator).
    expect(await screen.findByText("mengpo · 审判者")).toBeTruthy();
    expect(screen.queryByText(/JUDGE/)).toBeNull();
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

// ── Design 第四十批 O-b / O-f ───────────────────────────────────────────

describe("a rebirth's first review on the phone (O-b)", () => {
  const REBIRTH = { ...ITEM, kind: "rebirth", id: "ra-1", title: "周阿满", facts: { node: { name: "初审", index: 1, total: 2, is_last: false, next_name: "复审" }, cross_civilization: null } };
  async function openRebirth(item: Record<string, unknown>) {
    mockItem.mockResolvedValue({ data: item });
    renderOfficer(<Detail target={{ type: "todo", kind: "rebirth", id: "ra-1" }} onBack={() => {}} onSettled={() => {}} />);
    await screen.findByTestId("todo-detail");
    await act(async () => {}); // 两张底页随详情挂上就去取各自的东西(加签名单等);先等它们落定
    fireEvent.press(screen.getByTestId("action-approve"));
    await act(async () => {});
  }

  it("says 不跨 above everything, and the button says so too; 在电脑上定 beside it", async () => {
    mockDecideCross.mockResolvedValue({});
    mockApproveNode.mockResolvedValue({});
    await openRebirth(REBIRTH);
    expect(await screen.findByText("⇄ 跨文明：不跨")).toBeTruthy();
    expect(screen.getByText("跨文明只能在初审定，要在电脑上定。现在批准，就按「不跨」定下来，以后不能再改。")).toBeTruthy();
    expect(screen.getByText("在电脑上定")).toBeTruthy();
    expect(screen.getByText("批准 · 不跨")).toBeTruthy();
    fireEvent.press(screen.getByTestId("decision-confirm"));
    await waitFor(() => expect(mockApproveNode).toHaveBeenCalled());
    expect(mockDecideCross).toHaveBeenCalledWith("ra-1", false);
    await act(async () => {}); // 底页收起、加签名单取回的更新
  });

  it("set to cross: no approval on the phone, only 在电脑上继续", async () => {
    await openRebirth({ ...REBIRTH, facts: { ...REBIRTH.facts, cross_civilization: true } });
    expect(await screen.findByTestId("decision-cross-wanted")).toBeTruthy();
    expect(screen.queryByTestId("decision-confirm")).toBeNull();
    expect(screen.getByTestId("decision-desk")).toBeTruthy();
    expect(screen.queryByText("⇄ 跨文明：不跨")).toBeNull();
    await act(async () => {});
  });

  it("an ordinary approval has no cross line and the plain 批准 button", async () => {
    await open();
    fireEvent.press(screen.getByTestId("action-approve"));
    await screen.findByTestId("sheet-approve");
    expect(screen.queryByTestId("decision-cross")).toBeNull();
    expect(screen.queryByText("批准 · 不跨")).toBeNull();
  });
});

describe("an approved dispatch still waits for the receiving hall (O-f)", () => {
  it("the detail says 「◐ 等接收方执行」 once approved", async () => {
    mockItem.mockResolvedValue({
      data: { ...ITEM, kind: "reassignment", id: "d1", actionable: false, state: "already_handled", facts: { status: "APPROVED" } },
    });
    renderOfficer(<Detail target={{ type: "todo", kind: "reassignment", id: "d1" }} onBack={() => {}} onSettled={() => {}} />);
    expect(await screen.findByTestId("detail-awaiting-receiver")).toBeTruthy();
    expect(screen.getByText("◐ 等接收方执行")).toBeTruthy();
  });

  it("a proposal still open says nothing of the kind", async () => {
    mockItem.mockResolvedValue({ data: { ...ITEM, kind: "reassignment", id: "d2", facts: { status: "PROPOSED" } } });
    renderOfficer(<Detail target={{ type: "todo", kind: "reassignment", id: "d2" }} onBack={() => {}} onSettled={() => {}} />);
    await screen.findByTestId("todo-detail");
    expect(screen.queryByTestId("detail-awaiting-receiver")).toBeNull();
  });

  it("approving says the receiving hall still has to carry it out on a computer", async () => {
    mockDispatchApprove.mockResolvedValue({});
    mockItem.mockResolvedValue({ data: { ...ITEM, kind: "reassignment", id: "d3", facts: { status: "PROPOSED" } } });
    renderOfficer(
      <ToastProvider>
        <Detail target={{ type: "todo", kind: "reassignment", id: "d3" }} onBack={() => {}} onSettled={() => {}} />
      </ToastProvider>
    );
    await screen.findByTestId("todo-detail");
    fireEvent.press(screen.getByTestId("action-approve"));
    fireEvent.press(await screen.findByTestId("decision-confirm"));
    await waitFor(() => expect(mockDispatchApprove).toHaveBeenCalledWith("d3"));
    expect(await screen.findByText("已批准。接收方殿还要在电脑上执行一次，灵魂才会动身。")).toBeTruthy();
  });
});

describe("a waiting item that is gone (O-c)", () => {
  it.each([404, 403])("%s: 「这条已经不在了」 and the way back, not the error or the denied state", async (status) => {
    mockItem.mockRejectedValue(httpError(status));
    const onBack = jest.fn();
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} from="待办" onBack={onBack} onSettled={() => {}} />);
    expect(await screen.findByTestId("state-gone")).toBeTruthy();
    expect(screen.getByText("可能已经删除，或者已经不在你能看的范围里。")).toBeTruthy();
    expect(screen.queryByTestId("state-denied")).toBeNull();
    expect(screen.queryByTestId("state-retry")).toBeNull();
    fireEvent.press(screen.getByText("回到待办"));
    expect(onBack).toHaveBeenCalled();
  });
});
