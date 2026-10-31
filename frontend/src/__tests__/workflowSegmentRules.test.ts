/**
 * @jest-environment node
 */
/**
 * The pure rules of `@soulledger/core/domain/workflowSegments` (第四十三批), read directly.
 *
 * `workflowSegments.test.tsx` drives them through the pickers and banners; this file pins the branches
 * those screens do not happen to reach — a refusal with no code, a segment-less workflow, a chain of jump
 * targets, the gate's four views — because the officer app (`mobile-officer/src/screens/pick.tsx`) reads the
 * same functions and its own suite is not in this coverage count.
 */
import type { ApprovalNode, ApprovalWorkflow, JumpSource, WorkflowSegment } from "@soulledger/core/api";
import {
  adjustableSegment,
  circled,
  gateView,
  isRestorable,
  jumpReason,
  OVERDUE_DAYS,
  pickHall,
  runningJumpSources,
  segmentNodes,
  segmentRealm,
  segmentRefusalOf,
  segmentRefusalText,
  settleJumpTargets,
  staleOf,
  stationNo,
} from "@soulledger/core/domain/workflowSegments";
import { tZh } from "./support/zhBundle";

/** Key echo with the params, so an assertion says which sentence was chosen and with what. */
const echo = (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key);

const node = (over: Partial<ApprovalNode>): ApprovalNode => ({ id: "n", node_order: 1, segment_order: 1, kind: "APPROVAL", status: "PENDING", ...over }) as ApprovalNode;
const source = (key: string, node_name: string, via?: "branch" | "on_fail"): JumpSource => ({ key, node_name, via }) as JumpSource;
const refusal = (status: number | undefined, data: Record<string, unknown> | undefined) => ({ response: { status, data } });

describe("segmentNodes / isRestorable / stationNo", () => {
  it("lists one segment's stations in station order, without its END node or another segment's", () => {
    const wf = {
      nodes: [
        node({ id: "c", node_order: 3 }),
        node({ id: "a", node_order: 1 }),
        node({ id: "end", node_order: 4, kind: "END" }),
        node({ id: "other", node_order: 2, segment_order: 2 }),
      ],
    };
    expect(segmentNodes(wf, 1).map((n) => n.id)).toEqual(["a", "c"]);
    expect(segmentNodes({ nodes: undefined } as unknown as Pick<ApprovalWorkflow, "nodes">, 1)).toEqual([]);
  });

  it("restores only a skip made at the pick or later, never a cancelled one or a route skip (no kind)", () => {
    expect(isRestorable(node({ status: "SKIPPED", skip_kind: "AT_PICK" }))).toBe(true);
    expect(isRestorable(node({ status: "SKIPPED", skip_kind: "LATER" }))).toBe(true);
    expect(isRestorable(node({ status: "SKIPPED", skip_kind: "CANCELLED" }))).toBe(false);
    expect(isRestorable(node({ status: "SKIPPED", skip_kind: null }))).toBe(false);
    expect(isRestorable(node({ status: "PENDING", skip_kind: "AT_PICK" }))).toBe(false);
  });

  it("numbers a station within its segment, and falls back to the global order on an old backend", () => {
    expect(stationNo(node({ node_order: 7, order_in_segment: 2 }))).toBe(2);
    expect(stationNo(node({ node_order: 7, order_in_segment: undefined }))).toBe(7);
  });
});

describe("segmentRealm / pickHall", () => {
  it("names a segment by its civilization, the server's tenant name only when the code is unknown, nothing for none", () => {
    expect(segmentRealm(tZh, { tenant_code: "EG_DUAT", realm_name: "Egyptian Afterlife" })).toBe(tZh("souls.civilizations.EGYPTIAN"));
    expect(segmentRealm(tZh, { tenant_code: "XX_UNKNOWN", realm_name: "Somewhere" })).toBe("Somewhere");
    expect(segmentRealm(tZh, null)).toBe("");
  });

  it("writes the realm and the court; the realm alone without a court; the court alone without a realm", () => {
    const withBoth = pickHall(tZh, { realm: "CN_DIYU", hall: "Diyu", court: "第十殿" });
    expect(withBoth).toContain(tZh("plaque.realm.cn"));
    expect(pickHall(tZh, { realm: "CN_DIYU", hall: "Diyu" })).toBe(tZh("plaque.realm.cn"));
    expect(pickHall(tZh, { realm: "XX", court: "第十殿" })).not.toContain("XX");
    expect(pickHall(tZh, {})).toBe("");
  });
});

describe("jump targets (驳回时会转到的站)", () => {
  it("a source still running keeps the target locked; a skipped source does not; no sources is none", () => {
    const sources = [source("2", "初审"), source("3", "复核")];
    expect(runningJumpSources(sources, new Set(["2"])).map((s) => s.key)).toEqual(["3"]);
    expect(runningJumpSources(undefined, new Set())).toEqual([]);
  });

  it("says a branch target and a fail target in their own sentence, both when both, and reads an old source as on_fail", () => {
    expect(jumpReason(echo, [source("1", "分流", "branch")])).toBe('workflow.pick.route_target_reason {"source":"分流"}');
    expect(jumpReason(echo, [source("1", "初审")])).toBe('workflow.pick.jump_target_reason {"source":"初审"}');
    expect(jumpReason(echo, [source("1", "分流", "branch"), source("2", "初审", "on_fail"), source("3", "复核", "on_fail")])).toBe(
      'workflow.pick.route_target_reason {"source":"分流"} · workflow.pick.jump_target_reason {"source":"初审、复核"}',
    );
    expect(jumpReason(echo, [])).toBe("");
  });

  it("un-skips a target whose source runs again, through a chain, and leaves an unrelated skip alone", () => {
    // 4 is the target of 3, 3 the target of 2. Re-running 2 brings back 3, and with it 4.
    const rows = [
      { key: "2" },
      { key: "3", jumpSources: [source("2", "初审")] },
      { key: "4", jumpSources: [source("3", "复核")] },
      { key: "5" },
    ];
    expect([...settleJumpTargets(rows, new Set(["3", "4", "5"]))].sort()).toEqual(["5"]);
    // Every source skipped: the targets may stay skipped.
    expect([...settleJumpTargets(rows, new Set(["2", "3", "4"]))].sort()).toEqual(["2", "3", "4"]);
  });
});

describe("circled", () => {
  it("draws ① to ⑳ and writes anything outside that as a plain number", () => {
    expect(circled(1)).toBe("①");
    expect(circled(20)).toBe("⑳");
    expect(circled(21)).toBe("21.");
    expect(circled(0)).toBe("0.");
  });
});

describe("refusals (409 / 429 of the segment routes)", () => {
  it("reads status, code and body; no code or no response is an empty code, never a throw", () => {
    expect(segmentRefusalOf(refusal(409, { code: "segment_changed", changed_by: "崔判官" }))).toEqual({
      status: 409, code: "segment_changed", data: { code: "segment_changed", changed_by: "崔判官" },
    });
    expect(segmentRefusalOf(refusal(500, { code: 7 }))).toEqual({ status: 500, code: "", data: { code: 7 } });
    expect(segmentRefusalOf(new Error("network"))).toEqual({ status: undefined, code: "", data: {} });
    expect(segmentRefusalOf(null)).toEqual({ status: undefined, code: "", data: {} });
  });

  it("names the station and its sources for jump_target_required; nothing usable in the body is no sentence", () => {
    const one = segmentRefusalText(echo, {
      code: "jump_target_required",
      data: { jump_targets: [{ node_name: "复核", sources: ["初审", 3, "二审"] }, { node_name: 9, sources: "x" }] },
    });
    expect(one).toBe(
      'workflow.refusal.jump_target_required {"station":"复核","source":"初审、二审"} workflow.refusal.jump_target_required {"station":"","source":""}',
    );
    expect(segmentRefusalText(echo, { code: "jump_target_required", data: {} })).toBeNull();
  });

  it("gives every known code its sentence and an unknown code none, so the caller's fallback shows", () => {
    expect(segmentRefusalText(echo, { code: "remind_too_soon", data: {} })).toBe("workflow.gate.remind_too_soon");
    expect(segmentRefusalText(echo, { code: "too_early", data: {} })).toBe(`workflow.refusal.too_early {"days":"${OVERDUE_DAYS}"}`);
    for (const moved of ["segment_closed", "node_locked", "workflow_closed"]) {
      expect(segmentRefusalText(echo, { code: moved, data: {} })).toBe("workflow.refusal.moved_on");
    }
    expect(segmentRefusalText(echo, { code: "reason_required", data: {} })).toBe("workflow.refusal.reason_required");
    expect(segmentRefusalText(echo, { code: "something_new", data: {} })).toBeNull();
    expect(segmentRefusalText(echo, { code: "", data: {} })).toBeNull();
  });

  it("reads who changed the segment and when from segment_changed only", () => {
    expect(staleOf({ code: "segment_changed", data: { changed_by: "崔判官", changed_at: "2026-10-19T08:00:00Z" } })).toEqual({
      by: "崔判官", at: "2026-10-19T08:00:00Z",
    });
    expect(staleOf({ code: "segment_changed", data: { changed_by: 3 } })).toEqual({ by: "", at: null });
    expect(staleOf({ code: "node_locked", data: { changed_by: "x" } })).toBeNull();
  });
});

describe("adjustableSegment / gateView", () => {
  const seg = (order: number, tenant_code: string, state: string) => ({ order, tenant_code, state }) as WorkflowSegment;
  const wf = (over: Partial<ApprovalWorkflow>) => ({ segments: [], nodes: [], current_node: null, ...over }) as unknown as ApprovalWorkflow;

  it("prefers the segment the current station is in, when it is mine (or I am hall-less)", () => {
    const w = wf({
      segments: [seg(1, "CN_DIYU", "RUNNING"), seg(2, "EG_DUAT", "WAITING")],
      nodes: [node({ id: "cur", segment_order: 1 })],
      current_node: "cur",
    });
    expect(adjustableSegment(w, "CN_DIYU")?.order).toBe(1);
    expect(adjustableSegment(w, null)?.order).toBe(1);
  });

  it("otherwise my own running or picked segment; another hall's current segment, or a finished one, is not mine to change", () => {
    const w = wf({
      segments: [seg(1, "CN_DIYU", "RUNNING"), seg(2, "EG_DUAT", "PICKED"), seg(3, "EG_DUAT", "DONE")],
      nodes: [node({ id: "cur", segment_order: 1 })],
      current_node: "cur",
    });
    expect(adjustableSegment(w, "EG_DUAT")?.order).toBe(2);
    expect(adjustableSegment(w, "GR_HADES")).toBeNull();
    expect(adjustableSegment(wf({ segments: undefined, nodes: undefined }), "CN_DIYU")).toBeNull();
  });

  it("tells the four gate views apart, the overdue line only after three full days", () => {
    expect(gateView({ tenant_code: "EG_DUAT", no_picker: true, gate_days: 9 }, "EG_DUAT")).toBe("foreign");
    expect(gateView({ tenant_code: "EG_DUAT", no_picker: true, gate_days: 9 }, "CN_DIYU")).toBe("no_picker");
    expect(gateView({ tenant_code: "EG_DUAT", no_picker: false, gate_days: OVERDUE_DAYS + 1 }, null)).toBe("overdue");
    expect(gateView({ tenant_code: "EG_DUAT", no_picker: false, gate_days: OVERDUE_DAYS }, null)).toBe("waiting");
    expect(gateView({ tenant_code: "EG_DUAT", no_picker: false, gate_days: undefined } as unknown as WorkflowSegment, null)).toBe("waiting");
  });
});
