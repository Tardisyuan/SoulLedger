/**
 * The officer app's rules that are not pixels: what a decision sends to which endpoint, why one
 * failed, where a push lands, where "continue on desktop" points.
 */
import type { TodoItemDetail } from "@soulledger/core/api/officer-app";

import {
  decisionFailure,
  deskPath,
  failureReasonKey,
  hallChoiceOf,
  handledNotice,
  isDenied,
  landingOf,
  loginFailureKey,
  reasonMissing,
  passVerdictsOf,
  submitDecision,
} from "../rules";

const mockApproveNode = jest.fn();
const mockCooldownApprove = jest.fn();
const mockCooldownReject = jest.fn();
const mockDispatchApprove = jest.fn();
const mockDispatchReject = jest.fn();
jest.mock("@soulledger/core/api/workflow", () => ({ workflowApi: { approveNode: (...a: unknown[]) => mockApproveNode(...a) } }));
jest.mock("@soulledger/core/api/soul-accounts", () => ({
  soulAccountsApi: {
    approveCooldownShortening: (...a: unknown[]) => mockCooldownApprove(...a),
    rejectCooldownShortening: (...a: unknown[]) => mockCooldownReject(...a),
  },
}));
jest.mock("@soulledger/core/api/dispatch", () => ({
  dispatchApi: { approve: (...a: unknown[]) => mockDispatchApprove(...a), reject: (...a: unknown[]) => mockDispatchReject(...a) },
}));

const detail = (over: Partial<TodoItemDetail>): TodoItemDetail => ({
  kind: "approval",
  id: "item-1",
  title: "t",
  created_at: "2026-10-09T00:00:00Z",
  actionable: true,
  state: "actionable",
  handled_by: null,
  handled_at: null,
  workflow_id: "wf-1",
  node_id: "node-1",
  ...over,
});
const http = (status: number, data?: unknown) => ({ response: { status, data } });

beforeEach(() => jest.clearAllMocks());

describe("a decision goes to the endpoint the desk uses for that kind", () => {
  it("approval: approve_node with require_reason, PASSED to approve and REJECTED to reject", async () => {
    await submitDecision({ detail: detail({}), verdict: "approve", reason: "" });
    expect(mockApproveNode).toHaveBeenLastCalledWith("wf-1", "node-1", { verdict: "PASSED", notes: "", require_reason: true });
    await submitDecision({ detail: detail({}), verdict: "reject", reason: " 材料不全 " });
    expect(mockApproveNode).toHaveBeenLastCalledWith("wf-1", "node-1", { verdict: "REJECTED", notes: "材料不全", require_reason: true });
  });

  it("the verdict sent comes from the node's required_verdicts", async () => {
    const send = async (required_verdicts: string[], verdict: "approve" | "reject", passVerdict?: string) => {
      await submitDecision({ detail: detail({ required_verdicts }), verdict, reason: "r", passVerdict });
      return mockApproveNode.mock.calls.at(-1)![2].verdict;
    };
    expect(await send([], "approve")).toBe("PASSED");
    expect(await send(["CONFIRMED", "FAILED"], "approve")).toBe("CONFIRMED");
    expect(await send(["PASSED", "CONFIRMED"], "approve", "CONFIRMED")).toBe("CONFIRMED");
    expect(await send(["PASSED", "FAILED"], "reject")).toBe("FAILED");
    expect(await send(["PASSED", "REJECTED", "FAILED"], "reject")).toBe("REJECTED");
    expect(passVerdictsOf({ required_verdicts: ["PASSED", "CONFIRMED", "RETRY"] })).toEqual(["PASSED", "CONFIRMED"]);
    expect(passVerdictsOf({ required_verdicts: ["REJECTED"] })).toEqual(["PASSED"]);
  });

  it("a rebirth rejection also fills the words the soul reads", async () => {
    await submitDecision({ detail: detail({ kind: "rebirth" }), verdict: "reject", reason: "理由" });
    expect(mockApproveNode).toHaveBeenLastCalledWith("wf-1", "node-1", expect.objectContaining({ rejection_reason_for_soul: "理由", require_reason: true }));
  });

  it("cooldown shortening: approve with the days, reject with the note", async () => {
    await submitDecision({ detail: detail({ kind: "cooldown", id: "c1" }), verdict: "approve", reason: "", days: 3 });
    expect(mockCooldownApprove).toHaveBeenCalledWith("c1", 3, "");
    await submitDecision({ detail: detail({ kind: "cooldown", id: "c1" }), verdict: "reject", reason: "不合规" });
    expect(mockCooldownReject).toHaveBeenCalledWith("c1", "不合规");
  });

  it("reassignment (a dispatch proposal): approve, or reject with the reason", async () => {
    await submitDecision({ detail: detail({ kind: "reassignment", id: "d1" }), verdict: "approve", reason: "" });
    expect(mockDispatchApprove).toHaveBeenCalledWith("d1");
    await submitDecision({ detail: detail({ kind: "reassignment", id: "d1" }), verdict: "reject", reason: "不收" });
    expect(mockDispatchReject).toHaveBeenCalledWith("d1", "不收");
  });

  it("a reject with no reason never leaves the phone", async () => {
    await expect(submitDecision({ detail: detail({}), verdict: "reject", reason: "  " })).rejects.toThrow("reason_required");
    expect(mockApproveNode).not.toHaveBeenCalled();
    expect(reasonMissing("reject", " ")).toBe(true);
    expect(reasonMissing("approve", "")).toBe(false);
  });

  it("an item without a node cannot be decided", async () => {
    await expect(submitDecision({ detail: detail({ node_id: undefined }), verdict: "approve", reason: "" })).rejects.toThrow("no_node");
  });
});

describe("why a decision failed", () => {
  it("reads the server's code, and who handled it", () => {
    expect(decisionFailure(http(409, { code: "already_handled", handled_by: { id: 3, name: "阎罗" } }))).toEqual({ reason: "already_handled", handledBy: "阎罗" });
    expect(decisionFailure(http(409, { code: "deadline_passed" })).reason).toBe("deadline_passed");
    expect(decisionFailure(http(400, { code: "reason_required" })).reason).toBe("reason_required");
  });

  it("a bare 403 is a changed permission; no response is the network; any other answer is 'other'", () => {
    expect(decisionFailure(http(403)).reason).toBe("permission_changed");
    expect(decisionFailure(new Error("Network Error")).reason).toBe("network");
    expect(decisionFailure(http(500)).reason).toBe("other");
  });

  it("each reason has words in the bundle", () => {
    expect(failureReasonKey("already_handled")).toBe("officer_app.confirm.reasons.already_handled");
    expect(failureReasonKey("network")).toBe("officer_app.confirm.reasons.network");
    expect(failureReasonKey("reason_required")).toBe("officer_app.confirm.reason_required");
    expect(failureReasonKey("other")).toBe("officer_app.confirm.reasons.other");
    expect(failureReasonKey("no_approver")).toBe("officer_app.confirm.reasons.other");
  });
});

describe("a pushed item someone else already settled", () => {
  it("names who handled it; hides nothing while it is still ours", () => {
    expect(handledNotice({ actionable: true, state: "actionable", handled_by: null })).toBeNull();
    expect(handledNotice({ actionable: false, state: "already_handled", handled_by: { id: 1, name: "孟婆" } })).toEqual({ kind: "handled", name: "孟婆" });
    expect(handledNotice({ actionable: false, state: "already_handled", handled_by: null })).toEqual({ kind: "handled", name: null });
    expect(handledNotice({ actionable: false, state: "deadline_passed", handled_by: null })).toEqual({ kind: "deadline_passed" });
    expect(handledNotice({ actionable: false, state: "permission_changed", handled_by: null })).toEqual({ kind: "permission_changed" });
  });
});

describe("where a tapped push lands", () => {
  it("the server's generic count push lands on the to-do list", () => {
    expect(landingOf({ category: "officer_todo" })).toEqual({ tab: "todo" });
  });
  it("a payload that names an item lands on its detail", () => {
    expect(landingOf({ category: "officer_todo", target: { kind: "approval", id: "wf-9" } })).toEqual({ tab: "todo", item: { kind: "approval", id: "wf-9" } });
  });
  it("an unknown kind, an empty id or no payload just opens the app", () => {
    expect(landingOf({ target: { kind: "mystery", id: "1" } })).toBeNull();
    expect(landingOf({ target: { kind: "approval", id: "" } })).toBeNull();
    expect(landingOf(undefined)).toBeNull();
    expect(landingOf({ category: "soul_thing" })).toBeNull();
  });
});

describe("login", () => {
  it("409 hall_required carries the halls; nothing else does", () => {
    const halls = [{ code: "CN", display_name: "地府" }];
    expect(hallChoiceOf(http(409, { code: "hall_required", detail: "x", halls }))).toEqual({ halls });
    expect(hallChoiceOf(http(409, { code: "something_else", halls }))).toBeNull();
    expect(hallChoiceOf(http(401, { code: "hall_required", halls }))).toBeNull();
  });
  it("names the failure by step", () => {
    expect(loginFailureKey(http(401), "login")).toBe("officer_app.login.reasons.bad_credentials");
    expect(loginFailureKey(http(429, { code: "login_locked" }), "login")).toBe("officer_app.login.reasons.locked");
    expect(loginFailureKey(new Error("x"), "login")).toBe("officer_app.login.reasons.network");
    expect(loginFailureKey(http(401, { code: "wrong" }), "mfa")).toBe("officer_app.mfa.reasons.wrong");
    expect(loginFailureKey(http(401, { code: "expired" }), "mfa")).toBe("officer_app.mfa.reasons.expired");
    expect(loginFailureKey(http(429, { code: "locked" }), "mfa")).toBe("officer_app.mfa.reasons.locked");
  });
});

describe("desk links and denial", () => {
  it("each kind points at the desk's page for it", () => {
    expect(deskPath({ kind: "approval", id: "a" })).toBe("/workflow/a");
    expect(deskPath({ kind: "reassignment", id: "d" })).toBe("/dispatch/d");
    expect(deskPath({ kind: "cooldown", id: "c" })).toBe("/rebirth-applications");
    expect(deskPath({ kind: "rebirth", id: "r" })).toBe("/rebirth-applications");
    expect(deskPath({ kind: "judgment", id: "j" })).toBe("/judgment/j");
    expect(deskPath({ kind: "soul", id: "s" })).toBe("/souls/s");
  });
  it("only a 403 is 'no access'", () => {
    expect(isDenied(http(403))).toBe(true);
    expect(isDenied(http(500))).toBe(false);
    expect(isDenied(new Error("x"))).toBe(false);
  });
});
