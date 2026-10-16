/**
 * The officer app's readers of a refused decision / co-sign, in packages/core/src/api/officer-app.ts.
 * Each result picks the sentence the confirm sheet shows; a misread code shows the wrong one.
 */
import { cosignRefusalOf, decisionFailureOf } from "@soulledger/core/api/officer-app";

const refused = (status: number, data?: unknown) => ({ response: { status, data } });

describe("decisionFailureOf", () => {
  it("reads a known code, with who handled it when the body says", () => {
    expect(decisionFailureOf(refused(409, { code: "already_handled", handled_by: { id: 3, name: "秦广王" } }))).toEqual({
      code: "already_handled",
      handledBy: { id: 3, name: "秦广王" },
    });
    expect(decisionFailureOf(refused(400, { code: "reason_required" }))).toEqual({ code: "reason_required", handledBy: null });
  });

  it("reads a bare 403 as permission_changed", () => {
    expect(decisionFailureOf(refused(403))).toEqual({ code: "permission_changed", handledBy: null });
    expect(decisionFailureOf(refused(403, { code: "not_ours" }))).toEqual({ code: "permission_changed", handledBy: null });
  });

  it("is null for what is not a decision refusal", () => {
    expect(decisionFailureOf(refused(500))).toBeNull();
    expect(decisionFailureOf(refused(400, { code: "mystery" }))).toBeNull();
    expect(decisionFailureOf(new Error("offline"))).toBeNull();
    expect(decisionFailureOf(undefined)).toBeNull();
  });
});

describe("cosignRefusalOf", () => {
  it.each(["not_allowed", "not_eligible", "duplicate"] as const)("reads %s", (code) => {
    expect(cosignRefusalOf(refused(400, { code }))).toBe(code);
  });

  it("is null for anything else", () => {
    expect(cosignRefusalOf(refused(400, { code: "other" }))).toBeNull();
    expect(cosignRefusalOf(refused(500))).toBeNull();
    expect(cosignRefusalOf(null)).toBeNull();
  });
});
