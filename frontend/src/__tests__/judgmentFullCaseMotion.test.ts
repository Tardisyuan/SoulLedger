/**
 * 审判台 F「展开全案」的转场(v3 第 7 轮 App.tsx 动效表):320ms 进场曲线;资料舱 scaleX .94→1;
 * 判决区 translateX 到新栏;非当前内容先降到 40%,240–320ms 淡回。减少动态效果:只有 80ms 淡入。
 * jsdom 不排版,所以这里检查时间线本身(谁、从哪儿、到哪儿、什么时候、多久、什么曲线)。
 */
import { createElement, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { gsap } from "gsap";

import { DESK_ENTER_EASE, MaterialDock, fullCaseTimeline } from "@/src/components/judgment/JudgmentDeskStage";
import { MOTION_EASINGS } from "@/lib/motion";

function desk(): HTMLElement {
  document.body.innerHTML = `
    <div data-view="case">
      <section id="desk-soul"></section>
      <section data-testid="current-decision"></section>
      <section id="desk-draft"></section>
      <section data-testid="material-dock">
        <div data-material="confession"></div><div data-material="evidence"></div><div data-material="law"></div>
      </section>
    </div>`;
  return document.querySelector("[data-view]")!;
}

type Tween = gsap.core.Tween;
const tweens = (tl: gsap.core.Timeline) => tl.getChildren(false, true, false) as Tween[];
const targetOf = (tw: Tween) => (tw.targets() as HTMLElement[]).map((el) => el.dataset.testid ?? el.dataset.material ?? el.id);

/** cubic-bezier(x1,y1,x2,y2) 在 x 处的 y —— 二分求参数,与 CSS 的定义一致。 */
function bezier([x1, y1, x2, y2]: readonly number[], x: number): number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

// Block body: a gsap timeline is a thenable, and jest would await it.
afterEach(() => {
  gsap.globalTimeline.clear();
});

it("enter full case: 320ms on v3's enter curve, dock scaleX .94→1, verdict slides by the measured shift", () => {
  const tl = fullCaseTimeline(desk(), { toCase: true, shiftX: -180, active: "evidence", reduced: false });
  expect(tl.duration()).toBeCloseTo(0.32, 5);
  const ease = gsap.parseEase(DESK_ENTER_EASE);
  for (const x of [0.1, 0.3, 0.5, 0.8]) expect(ease(x)).toBeCloseTo(bezier(MOTION_EASINGS.enter, x), 2);
  expect(MOTION_EASINGS.enter).toEqual([0.2, 0.8, 0.2, 1]);

  const [dock, verdict, dim] = tweens(tl);
  expect(targetOf(dock)).toEqual(["material-dock"]);
  expect([dock.startTime(), dock.duration(), dock.vars.ease]).toEqual([0, 0.32, DESK_ENTER_EASE]);
  expect((dock.vars.startAt as gsap.TweenVars).scaleX).toBe(0.94);
  expect(dock.vars.scaleX).toBe(1);

  expect(targetOf(verdict)).toEqual(["current-decision"]);
  expect((verdict.vars.startAt as gsap.TweenVars).x).toBe(-180);
  expect([verdict.vars.x, verdict.startTime(), verdict.duration()]).toEqual([0, 0, 0.32]);

  // 非当前 = 没选中的两个资料标签,不含当前的那个。
  expect(targetOf(dim)).toEqual(["confession", "law"]);
  expect((dim.vars.startAt as gsap.TweenVars).opacity).toBe(0.4);
  expect([dim.vars.opacity, dim.startTime(), dim.duration()]).toEqual([1, 0.24, 0.08]);
});

it("back to focus: the soul and draft columns are what dims", () => {
  const tl = fullCaseTimeline(desk(), { toCase: false, shiftX: 180, active: "evidence", reduced: false });
  expect(targetOf(tweens(tl)[2])).toEqual(["desk-soul", "desk-draft"]);
});

it("no shift measured → no verdict tween", () => {
  const tl = fullCaseTimeline(desk(), { toCase: true, shiftX: 0, active: "law", reduced: false });
  expect(tweens(tl).flatMap(targetOf)).not.toContain("current-decision");
});

it("reduced motion: no movement, the new layout fades in over 80ms", () => {
  const tl = fullCaseTimeline(desk(), { toCase: true, shiftX: -180, active: "law", reduced: true });
  const all = tweens(tl);
  expect(all).toHaveLength(1);
  expect(all[0].targets()).toEqual([document.querySelector("[data-view]")]);
  expect((all[0].vars.startAt as gsap.TweenVars).opacity).toBe(0);
  expect([all[0].vars.opacity, all[0].duration()]).toEqual([1, 0.08]);
  expect(all[0].vars).not.toHaveProperty("x");
  expect(all[0].vars).not.toHaveProperty("scaleX");
});

/* MaterialDock 本身:F 一换版式就起一条时间线,判决区要走的距离 = 旧中心 − 新中心;
   别的重渲染不起。jsdom 不排版,判决区的位置按当前版式假造。 */
it("the dock starts one timeline per layout switch, with the verdict's measured shift", () => {
  function Harness() {
    const [fullCase, setFullCase] = useState(false);
    const [, bump] = useState(0);
    const panel = { label: "x", node: null };
    return createElement(
      "div",
      { "data-view": fullCase ? "case" : "focus" },
      createElement("section", { "data-testid": "current-decision" }),
      createElement("button", { type: "button", onClick: () => bump((n) => n + 1) }, "rerender"),
      createElement(MaterialDock, {
        active: "evidence",
        onActive: () => {},
        fullCase,
        onToggleFullCase: () => setFullCase((v) => !v),
        panels: { confession: panel, evidence: panel, law: panel },
      })
    );
  }
  const spy = jest.spyOn(gsap, "timeline");
  document.body.innerHTML = "";
  render(createElement(Harness));
  const verdictEl = screen.getByTestId("current-decision");
  jest.spyOn(verdictEl, "getBoundingClientRect").mockImplementation(() => {
    const left = verdictEl.closest("[data-view]")?.getAttribute("data-view") === "case" ? 900 : 400;
    return { left, width: 100, top: 0, height: 0, right: left + 100, bottom: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  fireEvent.click(screen.getByRole("button", { name: "rerender" }));
  expect(spy).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { pressed: false }));
  expect(spy).toHaveBeenCalledTimes(1);
  const verdict = tweens(spy.mock.results[0].value as gsap.core.Timeline).find((tw) => targetOf(tw)[0] === "current-decision")!;
  expect((verdict.vars.startAt as gsap.TweenVars).x).toBe(400 - 900);

  fireEvent.click(screen.getByRole("button", { name: "rerender" }));
  expect(spy).toHaveBeenCalledTimes(1);
  jest.restoreAllMocks();
});
