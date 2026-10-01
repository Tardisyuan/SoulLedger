/**
 * 规范 v2 动效令牌:CSS 一份(`app/globals.css` @theme),JS 一份(`lib/motion.ts`,给
 * motion 用,它读不了 CSS 变量)。两份手写的表是这个仓库最常漂移的形状,所以这里逐项
 * 对账;另外钉住「减少动态效果时一切时长为 0」——motion 自带的 reducedMotion 只关
 * transform,不够(动效第 2 轮「减少动态」一条)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";

import { MOTION_DURATIONS, MOTION_EASINGS } from "@/lib/motion";
import { useReducedMotionDurations } from "@/src/hooks/useReducedMotionDurations";
import { FRONTEND_ROOT, GLOBALS_CSS } from "./support/globalsCssTokens";

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

  /* 规范 v3 把中间两档各加长一档:fast 120 → 160(v3 local)、base 200 → 240
   * (v3 layout)。slow 320 本来就等于 v3 的 page。0 与 600 是 v2 独有的两档
   * (「不动画」与按住确认),v3 没有,所以留着 —— 对应关系写在 globals.css。 */
  it("the five spec durations are 0 / 160 / 240 / 320 / 600", () => {
    expect(Object.values(MOTION_DURATIONS).map((s) => Math.round(s * 1000))).toEqual([0, 160, 240, 320, 600]);
  });
});

/* 规范 v3「B2 · 通用」六行(2026-10-01 那一轮)。读源码文本:jsdom 不算 CSS 动画,
 * 也不评估 media query。浏览器里实测的时长表写在那一轮的提交信息里。 */
describe("v3 general motion rows", () => {
  const src = (rel: string) => readFileSync(path.join(FRONTEND_ROOT, rel), "utf8");

  it("the three off-table durations and the reduced fade are named tokens with v3's numbers", () => {
    expect(themeValue("--transition-duration-close")).toBe("180ms");
    expect(themeValue("--transition-duration-dismiss")).toBe("140ms");
    expect(themeValue("--transition-duration-reveal")).toBe("200ms");
    expect(themeValue("--transition-duration-reduced")).toBe("80ms");
  });

  it("page change: 240ms enter, 8px rise, no transform left behind", () => {
    expect(themeValue("--animate-page-enter")).toBe(
      "page-enter var(--transition-duration-base) var(--ease-enter) backwards"
    );
    expect(css).toMatch(/@keyframes page-enter\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(8px\);/);
    expect(src("app/template.tsx")).toMatch(/data-motion="fade" className="animate-page-enter"/);
  });

  it("modal / drawer: open 240 enter, close 180 exit, 12px", () => {
    for (const file of ["src/components/ui/Modal.tsx", "src/components/ui/Drawer.tsx"]) {
      const text = src(file);
      expect(text).not.toMatch(/data-ending-style:duration-fast/);
      expect(text).not.toMatch(/translate-[xy]-(2|full)\b/);
      expect(text).toMatch(/data-ending-style:duration-close/);
      expect(text).toMatch(/data-starting-style:translate-[xy]-3/);
    }
    expect(themeValue("--animate-drawer-out")).toMatch(/var\(--transition-duration-close\) var\(--ease-exit\)/);
    expect(themeValue("--animate-scrim-out")).toMatch(/var\(--transition-duration-close\) var\(--ease-exit\)/);
    expect(css).toMatch(/@keyframes drawer-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateX\(12px\);/);
  });

  it("toast: 160 in, 140 out, 8px", () => {
    expect(css).toMatch(/animation: toast-in var\(--transition-duration-fast\) var\(--ease-enter\);/);
    expect(css).toMatch(/opacity var\(--transition-duration-dismiss\) var\(--ease-exit\)/);
    expect(css).toMatch(/@keyframes toast-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(-8px\);/);
  });

  it("skeleton → content: PageShell fades the body in over `reveal` once the skeleton goes", () => {
    expect(themeValue("--animate-content-in")).toBe(
      "content-in var(--transition-duration-reveal) var(--ease-enter) backwards"
    );
    expect(src("src/components/ui/PageShell.tsx")).toMatch(/skeleton && !showingSkeleton && "animate-content-in"/);
  });

  it("danger confirm: the name-matched button enables without a tween", () => {
    expect(src("src/components/admin/NameConfirmDialog.tsx")).toMatch(/className="duration-instant"/);
  });

  it("reduced motion keeps an 80ms fade with NO movement on the fade set, and never `none`", () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-motion="fade"\],\s*\.toast \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/animation-duration: var\(--transition-duration-reduced\) !important/);
    expect(block).toMatch(/transition-duration: var\(--transition-duration-reduced\) !important/);
    expect(block).toMatch(/transform: none !important/);
    expect(block).toMatch(/translate: none !important/);
    expect(block).not.toMatch(/(animation|transition):\s*none/);
    // Same importance as the universal 1ms rule; the attribute selector wins on
    // specificity, and it sits after that rule so source order agrees.
    expect(css.indexOf('[data-motion="fade"],')).toBeGreaterThan(css.indexOf("transition-duration: 1ms !important"));
    for (const file of ["src/components/ui/Modal.tsx", "src/components/ui/Drawer.tsx"]) {
      expect(src(file).match(/data-motion="fade"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
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
