// 审判台 F「展开全案」的转场。单独成块,由 JudgmentDeskStage 的 `loadDeskMotion` 在资料舱挂上时动态加载,
// gsap 与 CustomEase 因此不在审判台的首屏 JS 里(perf review 2026-10-27 #13)。
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { MOTION_EASINGS } from "@/lib/motion";
import type { DeskMaterial } from "./JudgmentDeskStage";

/* gsap 只有命名曲线;v3 的进场曲线用 CustomEase 按 token 镜像造一条。注册与 WorkflowEditor 一样只在浏览器里做。 */
export const DESK_ENTER_EASE = "desk-enter";
if (typeof window !== "undefined") {
  gsap.registerPlugin(CustomEase);
  CustomEase.create(DESK_ENTER_EASE, MOTION_EASINGS.enter.join(","));
}

/**
 * F「展开全案」/ 回聚焦的转场(v3 第 7 轮 `App.tsx` 动效表「F 展开全案」与 `TransitionFrames`):
 * 320ms、进场曲线。布局由 CSS 一步切到终态(grid 换栏),中间的视觉位移交给 transform:
 * - 资料舱 scaleX .94 → 1(整体展开,不逐项飞入);
 * - 判决区从原来的位置 translateX 到新栏(`shiftX` = 旧中心 − 新中心);
 * - 非当前内容先压到 40%,240–320ms 淡回 —— 进全案时是没选中的资料标签,回聚焦时是灵魂栏与草稿栏。
 * 减少动态效果:不位移,新布局整体 80ms 淡入。结束后清掉内联样式,不留 transform。
 * v3 规格写明 Web 动效限于 CSS 与现有 GSAP;这是 gsap 在审判台这条路由上的唯一用处(只用 core + CustomEase)。
 */
export function fullCaseTimeline(
  desk: HTMLElement,
  { toCase, shiftX, active, reduced }: { toCase: boolean; shiftX: number; active: DeskMaterial; reduced: boolean }
): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { duration: 0.32, ease: DESK_ENTER_EASE } });
  if (reduced) return tl.fromTo(desk, { opacity: 0 }, { opacity: 1, duration: 0.08, clearProps: "opacity" });
  const dock = desk.querySelector('[data-testid="material-dock"]');
  const verdict = desk.querySelector('[data-testid="current-decision"]');
  const others = Array.from(
    desk.querySelectorAll<HTMLElement>(toCase ? `[data-material]:not([data-material="${active}"])` : "#desk-soul, #desk-draft")
  );
  if (dock) tl.fromTo(dock, { scaleX: 0.94, transformOrigin: "left center" }, { scaleX: 1, clearProps: "transform,transformOrigin" }, 0);
  if (verdict && shiftX) tl.fromTo(verdict, { x: shiftX }, { x: 0, clearProps: "transform" }, 0);
  // `transition: none` 期间:资料标签自带 CSS 的 opacity 过渡,两边同时写 opacity 会互相追。
  if (others.length)
    tl.fromTo(others, { opacity: 0.4, transition: "none" }, { opacity: 1, duration: 0.08, clearProps: "opacity,transition" }, 0.24);
  return tl;
}
