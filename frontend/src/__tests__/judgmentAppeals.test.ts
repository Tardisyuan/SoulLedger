/**
 * @jest-environment node
 *
 * 审判申诉(第五十二批 W-1 ~ W-4)网页侧的纯规则:「距截止」、被拒的读法、时间线三种事件的后半行。
 */
import type { SoulEvent } from "@soulledger/core/api/events";
import { appealsLeftAfterWithdraw, compensationOrder } from "@soulledger/core/domain/appeals";
import { APPEAL_IN_DIALOG_CODES, appealDeadline, appealRefusalMessage, appealRefusalOf } from "@/src/components/judgment/appealDisplay";
import { describeSystemEvent, makeSystemEventLabels } from "@/src/components/souls/soulLifecycleRows";
import { tZh } from "./support/zhBundle";

const refused = (data: Record<string, unknown>, status = 409) => ({ response: { status, data } });

describe("appealDeadline", () => {
  it("is thirty days after the judgment concluded, for a first appeal", () => {
    expect(appealDeadline({ round: 1, judgment_concluded_at: "2026-10-09T12:00:00Z" })?.toISOString()).toBe("2026-11-08T12:00:00.000Z");
  });

  it("is unknown for a second appeal (it runs from the first decision, which this payload lacks)", () => {
    expect(appealDeadline({ round: 2, judgment_concluded_at: "2026-10-09T12:00:00Z" })).toBeNull();
  });
});

describe("refusals", () => {
  it("names each code the dialog and the claim can meet, and falls back for the rest", () => {
    expect(appealRefusalMessage(refused({ code: "plan_busy" }), tZh)).toBe(tZh("appeals.error.plan_busy"));
    expect(appealRefusalMessage(refused({ code: "original_judge" }, 403), tZh)).toBe("你作出了原判，不能复核");
    expect(appealRefusalMessage(refused({ code: "something_new" }), tZh)).toBe(tZh("judgment.claim.refused.generic"));
    expect(appealRefusalMessage(new Error("offline"), tZh)).toBe(tZh("judgment.claim.refused.generic"));
  });

  it("carries the foreign stops' orders when the server asks for the choice", () => {
    expect(appealRefusalOf(refused({ code: "foreign_stops_choice_required", foreign_orders: [3, 4] }, 400))).toEqual({
      code: "foreign_stops_choice_required",
      foreignOrders: [3, 4],
    });
  });

  it("keeps exactly the two plan refusals inside the dialog", () => {
    expect(APPEAL_IN_DIALOG_CODES).toEqual(["plan_in_transit", "plan_busy"]);
  });
});

describe("the timeline's appeal lines", () => {
  const labels = makeSystemEventLabels(tZh);
  const event = (event_type: string, payload: Record<string, unknown>) =>
    ({ id: "e", soul: "s", event_type, actor: "system", create_time: "2026-10-20T00:00:00Z", payload }) as unknown as SoulEvent;

  it("says the round after the event, and the result (and new verdict) on a decision", () => {
    expect(describeSystemEvent(event("JUDGMENT_APPEAL_FILED", { round: 1, status: "PENDING" }), labels)).toBe("提出申诉 · 第 1 次申诉");
    expect(describeSystemEvent(event("JUDGMENT_APPEAL_DECIDED", { round: 2, status: "UPHELD" }), labels)).toBe(
      "申诉已复核 · 第 2 次申诉 · 维持原判"
    );
    expect(
      describeSystemEvent(event("JUDGMENT_APPEAL_DECIDED", { round: 1, status: "AMENDED", new_verdict: "PASSED" }), labels)
    ).toBe("申诉已复核 · 第 1 次申诉 · 已改判 · 新判 通过");
  });

  it("falls back to the bare event name when the payload has no round", () => {
    expect(describeSystemEvent(event("JUDGMENT_APPEAL_WITHDRAWN", {}), labels)).toBe("撤回申诉");
  });
});

describe("shared appeal rules", () => {
  it("reads a compensation's station from the backend's description, null for the original disposition", () => {
    expect(compensationOrder({ description: "申诉改判补偿:CN-2026-0007 第 2 站(CN),原判 FAILED → PASSED" })).toBe(2);
    expect(compensationOrder({ description: "申诉改判补偿:CN-2026-0007 原处置,原判 FAILED → PASSED" })).toBeNull();
  });

  it("counts what is left after a withdrawal: 2 − rounds filed, never below zero", () => {
    expect(appealsLeftAfterWithdraw(1)).toBe(1);
    expect(appealsLeftAfterWithdraw(2)).toBe(0);
    expect(appealsLeftAfterWithdraw(3)).toBe(0);
  });
});
