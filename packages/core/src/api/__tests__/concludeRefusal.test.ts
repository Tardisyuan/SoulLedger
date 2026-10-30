import { describe, expect, it } from "vitest";

import {
  NOT_CONCLUDABLE_REFUSALS,
  PLACEMENT_REFUSALS,
  SENTENCE_PLAN_REFUSAL_CODES,
  WEIGHING_REFUSALS,
  concludeRefusalOf,
} from "../judgment";

const refused = (code: unknown, status = 409) => ({ response: { status, data: { code, error: "English." } } });

/** 结案被拒的分类:页面(`app/judgment/[id]/page.tsx`)按 `kind` 分发,每一类做的事不同。 */
describe("concludeRefusalOf", () => {
  it.each([
    ...PLACEMENT_REFUSALS.map((code) => ["placement", code] as const),
    ["cross_open", "cross_judgment_open"] as const,
    ...SENTENCE_PLAN_REFUSAL_CODES.map((code) => ["plan", code] as const),
    ...WEIGHING_REFUSALS.map((code) => ["weighing", code] as const),
    ...NOT_CONCLUDABLE_REFUSALS.map((code) => ["not_concludable", code] as const),
  ])("reads %s for %s", (kind, code) => {
    expect(concludeRefusalOf(refused(code))).toEqual({ kind, code });
  });

  it("puts every code in exactly one class, so the order of the checks cannot matter", () => {
    const all = [
      ...PLACEMENT_REFUSALS,
      "cross_judgment_open",
      ...SENTENCE_PLAN_REFUSAL_CODES,
      ...WEIGHING_REFUSALS,
      ...NOT_CONCLUDABLE_REFUSALS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("reads nothing for a code it does not know, a segment refusal, or a failure without a code", () => {
    expect(concludeRefusalOf(refused("segment_closed"))).toBeNull();
    expect(concludeRefusalOf(refused("final_needs_flow"))).toBeNull();
    expect(concludeRefusalOf(refused(["realm_full"], 400))).toBeNull();
    expect(concludeRefusalOf({ response: { status: 500 } })).toBeNull();
    expect(concludeRefusalOf(new Error("Network Error"))).toBeNull();
    expect(concludeRefusalOf(null)).toBeNull();
  });
});
