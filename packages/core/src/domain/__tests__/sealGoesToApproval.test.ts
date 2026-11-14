import { describe, expect, it } from "vitest";

import { sealGoesToApproval } from "../verdictNames";

/** Mirrors backend `JudgmentService.conclude`: an original case goes through approval unless its verdict rehears it. */
describe("sealGoesToApproval (用户 2026-11-14)", () => {
  it("a case with a flow goes to approval for a destination verdict, in every civilization and spelling", () => {
    for (const civ of ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK", "cn", "eg"]) {
      expect(sealGoesToApproval(true, civ, "PASSED")).toBe(true);
      expect(sealGoesToApproval(true, civ, "FAILED")).toBe(true);
    }
  });

  it("RETRY rehears everywhere; PURGATORY rehears in 地府 and 埃及 only (`cosmology._outcome`)", () => {
    for (const civ of ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"]) expect(sealGoesToApproval(true, civ, "RETRY")).toBe(false);
    expect(sealGoesToApproval(true, "CHINESE", "PURGATORY")).toBe(false);
    expect(sealGoesToApproval(true, "EGYPTIAN", "PURGATORY")).toBe(false);
    expect(sealGoesToApproval(true, "cn", "PURGATORY")).toBe(false);
    expect(sealGoesToApproval(true, "EUROPEAN", "PURGATORY")).toBe(true);
    expect(sealGoesToApproval(true, "GREEK", "PURGATORY")).toBe(true);
  });

  it("no flow, no approval: the seal is final", () => {
    expect(sealGoesToApproval(false, "EUROPEAN", "FAILED")).toBe(false);
  });
});
