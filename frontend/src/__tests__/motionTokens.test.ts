/**
 * 规范 v2 动效令牌:CSS 一份(`app/globals.css` @theme),JS 一份(`lib/motion.ts`,给
 * motion 用,它读不了 CSS 变量)。两份手写的表是这个仓库最常漂移的形状,所以这里逐项
 * 对账;另外钉住「减少动态效果时一切时长为 0」——motion 自带的 reducedMotion 只关
 * transform,不够(动效第 2 轮「减少动态」一条)。
 */
import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";

import { MOTION_DURATIONS, MOTION_EASINGS } from "@/lib/motion";
import { useReducedMotionDurations } from "@/src/hooks/useReducedMotionDurations";
import { GLOBALS_CSS } from "./support/globalsCssTokens";

const css = readFileSync(GLOBALS_CSS, "utf8");

function themeValue(name: string): string {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css);
  if (m === null) throw new Error(`${name} is not declared in globals.css — fix this reader, do not delete the check.`);
  return m[1].trim();
}

describe("motion tokens: the JS mirror equals the stylesheet", () => {
  it.each(Object.entries(MOTION_DURATIONS))("duration %s", (name, seconds) => {
    expect(themeValue(`--transition-duration-${name}`)).toBe(`${Math.round(seconds * 1000)}ms`);
  });

  it.each(Object.entries(MOTION_EASINGS))("easing %s", (name, curve) => {
    const nums = /cubic-bezier\(([^)]*)\)/.exec(themeValue(`--ease-${name}`))?.[1].split(",").map(Number);
    expect(nums).toEqual([...curve]);
  });

  it("the five spec durations are 0 / 120 / 200 / 320 / 600", () => {
    expect(Object.values(MOTION_DURATIONS).map((s) => Math.round(s * 1000))).toEqual([0, 120, 200, 320, 600]);
  });
});

// The hook's own decision is what is under test: given motion's answer to "does the
// operator want less motion", every duration goes to 0. motion's reading of the media
// query is motion's to test.
const mockReduce = jest.fn<boolean | null, []>();
jest.mock("motion/react", () => ({ useReducedMotion: () => mockReduce() }));

describe("useReducedMotionDurations", () => {
  it("returns the spec durations when motion is allowed (and on the first, unknown frame)", () => {
    for (const answer of [false, null]) {
      mockReduce.mockReturnValue(answer);
      expect(renderHook(() => useReducedMotionDurations()).result.current).toEqual(MOTION_DURATIONS);
    }
  });

  it("returns 0 for every duration under prefers-reduced-motion", () => {
    mockReduce.mockReturnValue(true);
    const d = renderHook(() => useReducedMotionDurations()).result.current;
    expect(Object.keys(d).sort()).toEqual(Object.keys(MOTION_DURATIONS).sort());
    expect(Object.values(d)).toEqual([0, 0, 0, 0, 0]);
  });
});
