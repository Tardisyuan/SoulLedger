import { describe, expect, it } from "vitest";

import { labelTooLongForVerticalPillar, pillarIsWide } from "../pillar";

// 补足 C14: ≤ 4 汉字 且 ≤ 8 拉丁字符 → 竖排;任一项超过 → 整根横排(App 底栏同一判断)。
describe("pillar width (C14)", () => {
  it("counts Han and Latin separately, at the exact thresholds", () => {
    expect(labelTooLongForVerticalPillar("待交付初")).toBe(false);
    expect(labelTooLongForVerticalPillar("待交付初始")).toBe(true);
    expect(labelTooLongForVerticalPillar("Ankh Pen")).toBe(false);
    expect(labelTooLongForVerticalPillar("Sesh Ba!!")).toBe(true);
    expect(labelTooLongForVerticalPillar("  本世  ")).toBe(false);
  });

  it("one long label widens the whole pillar / bar", () => {
    expect(pillarIsWide(["本世", "朋友圈", "书信", "申请"])).toBe(false);
    expect(pillarIsWide(["Ankh Pen", "Sesh Ba", "Medew", "Wehem Mesut"])).toBe(true);
    expect(pillarIsWide([])).toBe(false);
  });
});
