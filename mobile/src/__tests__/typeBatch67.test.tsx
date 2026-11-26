/**
 * Design batch 67 二 / 三 / 四 (docs/design-handoff/v4-replies/batch67): the type scale on the 4px grid,
 * `caption` no longer equal to `body`, three fade tiers, and no tracking on 12pt text.
 */
import { GONE_OPACITY, PENDING_OPACITY, RECEDE_OPACITY } from "@soulledger/mobile-ui/src/theme";
import { TYPE } from "@soulledger/mobile-ui/src/ui";

describe("Design batch 67 type", () => {
  it("caption is 12 / 16 / 400 (tai.caption) and no longer the same as body", () => {
    expect(TYPE.caption).toMatchObject({ fontSize: 12, lineHeight: 16, fontFamily: TYPE.body.fontFamily });
    expect(TYPE.caption).not.toEqual(TYPE.body);
    expect(TYPE.body).toMatchObject({ fontSize: 14, lineHeight: 20 });
  });

  it("every size sits on the ten steps and every line height on the 4px grid", () => {
    const steps = [11, 12, 14, 16, 20, 24, 32, 40, 56, 88];
    for (const [name, s] of Object.entries(TYPE)) {
      expect([name, steps.includes(s.fontSize)]).toEqual([name, true]);
      expect([name, s.lineHeight % 4]).toEqual([name, 0]);
    }
  });

  it("no 12pt variant is tracked; only the 11pt upper-case eyebrow keeps the web's 0.08em", () => {
    const tracked = Object.entries(TYPE).filter(([, s]) => "letterSpacing" in s && s.letterSpacing);
    expect(tracked.map(([name]) => name)).toEqual(["eyebrow"]);
    expect(TYPE.eyebrow).toMatchObject({ fontSize: 11, letterSpacing: 0.88, textTransform: "uppercase" });
    expect(TYPE.label).not.toHaveProperty("letterSpacing");
  });
});

describe("Design batch 67 fade tiers", () => {
  it("are 0.45 gone / 0.6 in progress / 0.85 receded", () => {
    expect([GONE_OPACITY, PENDING_OPACITY, RECEDE_OPACITY]).toEqual([0.45, 0.6, 0.85]);
  });
});
