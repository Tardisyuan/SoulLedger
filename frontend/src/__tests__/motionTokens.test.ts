/**
 * 规范 v2 动效令牌:CSS 一份(`app/globals.css` @theme),JS 一份(`lib/motion.ts`,给
 * motion 用,它读不了 CSS 变量)。两份手写的表是这个仓库最常漂移的形状,所以这里逐项
 * 对账;另外钉住「减少动态效果时一切时长为 0」——motion 自带的 reducedMotion 只关
 * transform,不够(动效第 2 轮「减少动态」一条)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, renderHook } from "@testing-library/react";

import { MOTION_DURATIONS, MOTION_EASINGS } from "@/lib/motion";
import { useReducedMotionDurations } from "@/src/hooks/useReducedMotionDurations";
import { FRONTEND_ROOT, GLOBALS_CSS } from "./support/globalsCssTokens";
import { createElement, type ReactNode } from "react";
import Template from "@/app/template";

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
  });

  /* 同段换页:template 不重挂,换动画名才重播。两个名字必须是同一个动画。 */
  it("page change inside one segment: a second name with the identical value and keyframes", () => {
    expect(themeValue("--animate-page-enter-again")).toBe(
      themeValue("--animate-page-enter").replace(/^page-enter /, "page-enter-again ")
    );
    const body = (name: string) => new RegExp(`@keyframes ${name}\\s*(\\{[^@]*?\\}\\s*\\})`).exec(css)?.[1];
    expect(body("page-enter-again")).toBeDefined();
    expect(body("page-enter-again")).toBe(body("page-enter"));
  });

  /* Design 第三批回复(2026-10-03):展开 240 进场、收起 160 出场(内容前 80ms 淡出),
   * 超过 40 行的整节只淡入淡出 160。两个工具类只由 Collapse 挂,行展开与整节折叠都走它。 */
  it("row / section expand 240 enter, collapse 160 exit, one shared component", () => {
    expect(themeValue("--animate-row-expand")).toBe(
      "row-expand var(--transition-duration-base) var(--ease-enter) backwards"
    );
    expect(themeValue("--animate-row-collapse")).toBe(
      "row-collapse var(--transition-duration-fast) var(--ease-exit) forwards"
    );
    expect(themeValue("--transition-duration-base")).toBe("240ms");
    expect(themeValue("--transition-duration-fast")).toBe("160ms");
    expect(themeValue("--ease-enter")).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(themeValue("--ease-exit")).toBe("cubic-bezier(0.4, 0, 1, 1)");
    expect(css).toMatch(/@keyframes row-expand\s*\{\s*from\s*\{\s*grid-template-rows:\s*0fr;\s*overflow:\s*hidden;\s*\}\s*to\s*\{\s*grid-template-rows:\s*1fr;\s*overflow:\s*hidden;/);
    expect(css).toMatch(/@keyframes row-collapse\s*\{\s*from\s*\{\s*grid-template-rows:\s*1fr;\s*overflow:\s*hidden;\s*\}\s*to\s*\{\s*grid-template-rows:\s*0fr;\s*overflow:\s*hidden;/);
    expect(css).toMatch(/@utility row-expand \{\s*display: grid;\s*animation: var\(--animate-row-expand\);\s*& > \* \{\s*min-height: 0;/);
    // 内容在收起的前一半(80ms)淡出。
    expect(css).toMatch(
      /@utility row-collapse \{\s*display: grid;\s*animation: var\(--animate-row-collapse\);\s*& > \* \{\s*min-height: 0;\s*animation: row-exit calc\(var\(--transition-duration-fast\) \/ 2\) var\(--ease-exit\) forwards;/
    );
    expect(css).toMatch(/@utility collapse-fade-in \{\s*animation: content-in var\(--transition-duration-fast\) var\(--ease-enter\) backwards;/);
    expect(css).toMatch(/@utility collapse-fade-out \{\s*animation: row-exit var\(--transition-duration-fast\) var\(--ease-exit\) forwards;/);
    // v3 B3:减少动态效果下瞬时 —— 走 1ms 的通用规则,不能进 80ms 淡入的例外。
    expect(css).not.toMatch(/\.(row-expand|row-collapse|collapse-fade-\w+)[^{]*\{[^}]*--transition-duration-reduced/);
    // 没有哪个调用方再手挂 row-expand:都经过 Collapse(它才管 inert / hidden / 焦点)。
    for (const file of [
      "app/actors/page.tsx",
      "app/corpus/page.tsx",
      "app/organizations/page.tsx",
      "app/scheduler/page.tsx",
      "src/components/assist-admin/EvalPanel.tsx",
      "src/components/assist-admin/ProviderSection.tsx",
      "src/components/scheduler/TaskRunsDrawer.tsx",
      "src/components/souls/DateProblemsPanel.tsx",
      "src/components/souls/SoulLifecycleTimeline.tsx",
    ]) {
      const text = src(file);
      expect([file, /<Collapse\b/.test(text), /className="row-expand/.test(text)]).toEqual([file, true, false]);
    }
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

const mockPathname = jest.fn<string, []>();
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const page = (child: ReactNode) => createElement(Template, null, child);

describe("app/template: the page-enter animation replays on every pathname change", () => {
  it("swaps the animation name when the pathname changes inside one segment, and only then", () => {
    mockPathname.mockReturnValue("/souls");
    const { container, rerender } = render(page(createElement("p", null, "x")));
    const wrapper = () => container.firstElementChild as HTMLElement;
    expect(wrapper().getAttribute("data-motion")).toBe("fade");
    expect(wrapper().className).toBe("animate-page-enter");

    mockPathname.mockReturnValue("/souls/123");
    rerender(page(createElement("p", null, "x")));
    expect(wrapper().className).toBe("animate-page-enter-again");

    // Same pathname (a query-string change): no replay.
    rerender(page(createElement("p", null, "x")));
    expect(wrapper().className).toBe("animate-page-enter-again");

    mockPathname.mockReturnValue("/souls");
    rerender(page(createElement("p", null, "x")));
    expect(wrapper().className).toBe("animate-page-enter");
  });

  it("keeps the page mounted across the swap (state and focus survive)", () => {
    mockPathname.mockReturnValue("/souls");
    const { container, rerender } = render(page(createElement("input", { "aria-label": "kept" })));
    const input = container.querySelector("input")!;
    input.focus();
    mockPathname.mockReturnValue("/souls/9");
    rerender(page(createElement("input", { "aria-label": "kept" })));
    expect(container.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
  });
});
