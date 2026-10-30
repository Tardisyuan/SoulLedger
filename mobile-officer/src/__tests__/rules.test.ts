/**
 * The officer app's rules that are not pixels: what a decision sends to which endpoint, why one
 * failed, where a push lands, where "continue on desktop" points.
 */
import type { TodoItemDetail } from "@soulledger/core/api/officer-app";

import {
  TODO_GROUPS,
  VIEW_ONLY_KINDS,
  decisionFailure,
  deskPath,
  failureReasonKey,
  goneKey,
  hallChoiceOf,
  handledNotice,
  isDenied,
  judgmentAdminItems,
  landingGoneKey,
  landingOf,
  looksLikeCaseNumber,
  noticeIsDeskOnly,
  noticeLanding,
  loginFailureKey,
  reasonMissing,
  passVerdictsOf,
  passwordFailure,
  reassignCandidates,
  rebirthCross,
} from "../rules";
import { submitDecision } from "../decisions";

const mockApproveNode = jest.fn();
const mockCooldownApprove = jest.fn();
const mockCooldownReject = jest.fn();
const mockDispatchApprove = jest.fn();
const mockDispatchReject = jest.fn();
const mockDecideCross = jest.fn();
jest.mock("@soulledger/core/api/workflow", () => ({ workflowApi: { approveNode: (...a: unknown[]) => mockApproveNode(...a) } }));
jest.mock("@soulledger/core/api/soul-accounts", () => ({
  soulAccountsApi: {
    approveCooldownShortening: (...a: unknown[]) => mockCooldownApprove(...a),
    rejectCooldownShortening: (...a: unknown[]) => mockCooldownReject(...a),
    decideCrossCivilization: (...a: unknown[]) => mockDecideCross(...a),
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
  it("a notification row lands like a push: a workflow is an approval, anything unnamed stays put", () => {
    expect(noticeLanding({ related_resource: "workflow", related_id: "wf-9" })).toEqual({ tab: "todo", item: { kind: "approval", id: "wf-9" } });
    expect(noticeLanding({ related_resource: "cooldown", related_id: "4" })).toEqual({ tab: "todo", item: { kind: "cooldown", id: "4" } });
    // A rebirth workflow's notice names the application -- what the rebirth item is keyed by, not the workflow (that was a 404).
    expect(noticeLanding({ related_resource: "rebirth_application", related_id: "ra-3" })).toEqual({ tab: "todo", item: { kind: "rebirth", id: "ra-3" } });
    expect(noticeLanding({ related_resource: "scheduler", related_id: "5" })).toBeNull();
    expect(noticeLanding({ related_resource: "judgment", related_id: "j1" })).toEqual({ tab: "todo", judgment: "j1" });
    expect(noticeLanding({ related_resource: "soul", related_id: "s1" })).toEqual({ tab: "todo", soul: "s1" });
    expect(noticeIsDeskOnly({ related_resource: "scheduler" })).toBe(true);
    expect(noticeIsDeskOnly({ related_resource: "CrossTenantJudgment" })).toBe(true);
    expect(noticeIsDeskOnly({ related_resource: "judgment" })).toBe(false);
    expect(noticeLanding({ related_resource: "workflow", related_id: null })).toBeNull();
    expect(noticeLanding({})).toBeNull();
  });
  it("an unknown kind, an empty id or no payload just opens the app", () => {
    expect(landingOf({ target: { kind: "mystery", id: "1" } })).toBeNull();
    expect(landingOf({ target: { kind: "approval", id: "" } })).toBeNull();
    expect(landingOf(undefined)).toBeNull();
    expect(landingOf({ category: "soul_thing" })).toBeNull();
  });
});

describe("passwordFailure", () => {
  it("too many wrong old passwords is said by key, never the server's Chinese sentence", () => {
    const locked = passwordFailure(http(429, { code: "login_locked", error: "尝试次数过多" }));
    expect(locked).toEqual({ network: false, old: ["profile.password_locked"], next: [], other: [] });
    expect(passwordFailure(http(400, { old_password: ["wrong"] })).old).toEqual(["profile.password_old_wrong"]);
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
    // A recovery code that is wrong says so (as the soul app and the web), not 「动态码不对」.
    expect(loginFailureKey(http(401, { code: "wrong" }), "mfa", true)).toBe("mfa.verify.error_recovery_wrong");
    expect(loginFailureKey(http(400), "mfa", true)).toBe("mfa.verify.error_recovery_wrong");
    expect(loginFailureKey(http(429, { code: "locked" }), "mfa", true)).toBe("officer_app.mfa.reasons.locked");
    // `expired` is a stale code (reads as wrong); `pending_invalid` is the sign-in timing out (2026-10-23: they were swapped).
    expect(loginFailureKey(http(401, { code: "expired" }), "mfa")).toBe("officer_app.mfa.reasons.wrong");
    expect(loginFailureKey(http(401, { code: "pending_invalid" }), "mfa")).toBe("officer_app.mfa.reasons.expired");
    expect(loginFailureKey(http(401, { code: "pending_invalid" }), "mfa", true)).toBe("officer_app.mfa.reasons.expired");
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

// ── Design 第四十批 ─────────────────────────────────────────────────────

describe("O-b: approving a rebirth's first review on the phone", () => {
  const rebirth = (facts: Record<string, unknown>, over: Partial<TodoItemDetail> = {}) =>
    detail({ kind: "rebirth", id: "ra-1", facts: facts as TodoItemDetail["facts"], ...over });

  it("says 不跨 at the first review, sends no-cross first, then the approval", async () => {
    expect(rebirthCross(rebirth({ cross_civilization: null, node: { index: 1 } }))).toBe("no");
    mockDecideCross.mockResolvedValue({});
    await submitDecision({ detail: rebirth({ cross_civilization: null, node: { index: 1 } }), verdict: "approve", reason: "" });
    expect(mockDecideCross).toHaveBeenCalledWith("ra-1", false);
    expect(mockDecideCross.mock.invocationCallOrder[0]).toBeLessThan(mockApproveNode.mock.invocationCallOrder[0]);
  });

  it("does not write the flag again once it is set, nor on a reject", async () => {
    await submitDecision({ detail: rebirth({ cross_civilization: false, node: { index: 1 } }), verdict: "approve", reason: "" });
    await submitDecision({ detail: rebirth({ cross_civilization: null, node: { index: 1 } }), verdict: "reject", reason: "r" });
    expect(mockDecideCross).not.toHaveBeenCalled();
    expect(mockApproveNode).toHaveBeenCalledTimes(2);
  });

  it("a 409 from the flag (first review already past) still approves; any other refusal stops it", async () => {
    mockDecideCross.mockRejectedValueOnce(http(409, { code: "not_in_initial_review" }));
    await submitDecision({ detail: rebirth({ cross_civilization: null }), verdict: "approve", reason: "" });
    expect(mockApproveNode).toHaveBeenCalledTimes(1);
    mockDecideCross.mockRejectedValueOnce(http(403, { code: "not_the_approver" }));
    await expect(submitDecision({ detail: rebirth({ cross_civilization: null }), verdict: "approve", reason: "" })).rejects.toEqual(http(403, { code: "not_the_approver" }));
    expect(mockApproveNode).toHaveBeenCalledTimes(1);
  });

  it("set to cross: the phone only sends it to the desk; a later step or an appeal has no cross line at all", () => {
    expect(rebirthCross(rebirth({ cross_civilization: true, node: { index: 1 } }))).toBe("desk");
    expect(rebirthCross(rebirth({ cross_civilization: true, node: { index: 2 } }))).toBe("desk");
    expect(rebirthCross(rebirth({ cross_civilization: null, node: { index: 2 } }))).toBeNull();
    expect(rebirthCross(rebirth({ cross_civilization: null }, { is_appeal: true }))).toBeNull();
    expect(rebirthCross(detail({}))).toBeNull();
  });
});

describe("O-a: an admin's ⋯ on a case someone else holds", () => {
  const j = (over: Record<string, unknown> = {}) => ({ claimed_by: 7, deferred_at: null, concluded_at: null, ...over });
  it("改派给… · 替他放回 · 暂缓, or 取消暂缓 when deferred", () => {
    expect(judgmentAdminItems(j(), 1, true)).toEqual(["reassign_to", "release_for", "defer"]);
    expect(judgmentAdminItems(j({ deferred_at: "2026-10-17T00:00:00Z" }), 1, true)).toEqual(["reassign_to", "release_for", "undefer"]);
  });
  it("nothing without judgment.assign, on my own case, an unclaimed one, or a closed one", () => {
    expect(judgmentAdminItems(j(), 1, false)).toEqual([]);
    expect(judgmentAdminItems(j({ claimed_by: 1 }), 1, true)).toEqual([]);
    expect(judgmentAdminItems(j({ claimed_by: null }), 1, true)).toEqual([]);
    expect(judgmentAdminItems(j({ concluded_at: "2026-10-17T00:00:00Z" }), 1, true)).toEqual([]);
  });
  it("the picker: never the holder, fewest cases first, the count column only when every row has one", () => {
    const o = (id: number, name: string, in_hand?: number) => ({ id, display_name: name, username: `u${id}`, role: "JUDGE", ...(in_hand === undefined ? {} : { in_hand }) });
    const people = [o(7, "王判官", 1), o(2, "韩判官", 7), o(3, "陆判官", 2), o(4, "钟判官", 4)];
    const { rows, counts } = reassignCandidates(people, 7, "");
    expect(rows.map((r) => r.display_name)).toEqual(["陆判官", "钟判官", "韩判官"]);
    expect(counts).toBe(true);
    expect(reassignCandidates(people, 7, "钟").rows.map((r) => r.id)).toEqual([4]);
    expect(reassignCandidates([o(2, "韩判官"), o(3, "陆判官", 2)], 7, "").counts).toBe(false);
  });
});

describe("O-c / O-d / O-f", () => {
  it("a gone detail and the row that opened it share one key", () => {
    expect(goneKey({ type: "todo", kind: "approval", id: "a" })).toBe(landingGoneKey({ tab: "todo", item: { kind: "approval", id: "a" } }));
    expect(goneKey({ type: "judgment", id: "j" })).toBe(landingGoneKey({ tab: "todo", judgment: "j" }));
    expect(goneKey({ type: "soul", id: "s" })).toBe(landingGoneKey({ tab: "todo", soul: "s" }));
    expect(goneKey({ type: "judgment", id: "x" })).not.toBe(goneKey({ type: "soul", id: "x" }));
    expect(landingGoneKey(null)).toBeNull();
  });
  it("only a whole case number adds the 案件 group", () => {
    for (const q of ["CN-2026-0042", " cn-2026-0042 ", "SL-2026-10000", "EGDUAT-2026-0001"]) expect(looksLikeCaseNumber(q)).toBe(true);
    for (const q of ["CN-2026-004", "CN-2026", "王守仁", "S00420031", "CN 2026 0042", "CN-26-0042"]) expect(looksLikeCaseNumber(q)).toBe(false);
  });
  it("sentence-plan changes are a to-do kind that only opens the desk", () => {
    expect(TODO_GROUPS.map((g) => g.kind)).toContain("sentence_change");
    expect(VIEW_ONLY_KINDS).toEqual(["sentence_change"]);
    expect(deskPath({ kind: "sentence_change", id: "r" })).toBe("/sentence-requests");
  });
});
