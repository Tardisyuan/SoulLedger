/**
 * 落地页四张卡上文明主视觉的三样代码效果(2026-11-09 用户定 A,Design 第十九批之后):
 *   1. 第一次进视口时描线:主线(`.e-l` / `.e-l2`)约 1 秒画出,刻度(`.e-t`)随后淡入;只画一次。
 *   2. 金属光泽:每 11 秒一道斜光扫过(CSS,`globals.css` 的 `.emblem-sheen`)。
 *   3. 卡片随指针轻微倾斜(≤ 6°),主视觉比卡底多挪几像素。
 * 只认元素的类名(`.e-l` 主线、`.e-l2`、`.e-t` 刻度),不认几何:Design 还在改线稿(更细的线、2.5D 版)。
 * 这里只放纯逻辑与 DOM 小操作,组件在 `components/landing/LandingEmblem.tsx` 与 `Landing.tsx`。
 */

export const TILT_MAX_DEG = 6;
/** 主视觉相对卡底的视差,单位 px(指针在卡边时)。 */
export const PARALLAX_PX = 4;
/** 描线 1 s + 刻度 0.75 s 起淡入 0.45 s,收尾再留一点。 */
export const DRAW_MS = 1400;

export interface Tilt {
  /** rotateX / rotateY,单位度。 */
  rx: number;
  ry: number;
  /** 主视觉的平移,单位 px。 */
  px: number;
  py: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100 || 0;

/**
 * 指针 → 倾斜:卡中心为 0,卡边为 ±max;出了卡(拖出去、取整误差)也夹在 ±max 内。
 * 指针在右边时右边往里倒(rotateY 正),在上边时上边往里倒(rotateX 正);主视觉朝指针挪。
 */
export function tiltFor(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  max = TILT_MAX_DEG,
): Tilt {
  if (!(rect.width > 0) || !(rect.height > 0)) return { rx: 0, ry: 0, px: 0, py: 0 };
  const nx = clamp(((x - rect.left) / rect.width) * 2 - 1, -1, 1);
  const ny = clamp(((y - rect.top) / rect.height) * 2 - 1, -1, 1);
  return { rx: round2(-ny * max), ry: round2(nx * max), px: round2(nx * PARALLAX_PX), py: round2(ny * PARALLAX_PX) };
}

/** 键盘聚焦时的一点倾斜:像指针停在卡的上沿正中。 */
export const FOCUS_TILT: Tilt = { rx: 3, ry: 0, px: 0, py: -2 };

const query = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
/** 没有 matchMedia(jsdom、很老的浏览器)当作「要减少动态」:宁可不动。 */
export const reducedMotion = () => !query("(prefers-reduced-motion: no-preference)");
/** 倾斜只给精确指针(鼠标、触控板);触屏与减少动态效果都不倾斜。 */
export const tiltAllowed = () => query("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");

// 已经画过的文明。模块级:重渲染、换主题(换成另一份 SVG)、卡片重挂都不再画第二遍;整页刷新才重来。
const drawn = new Set<string>();
export const shouldDraw = (key: string, reduced: boolean) => !reduced && !drawn.has(key);
export const markDrawn = (key: string) => void drawn.add(key);

const LINES = ".e-l, .e-l2";

/**
 * 插进页面之前:主线设 `pathLength=1`,根上加 `fx-pre`(globals.css 把主线的虚线偏移压到 1、刻度压到透明)。
 * 这些文件里本来没有 `pathLength`,收尾时整个删掉就回到原样。
 */
export function primeDraw(svg: Element) {
  svg.querySelectorAll(LINES).forEach((el) => el.setAttribute("pathLength", "1"));
  svg.classList.add("fx-pre");
}

/** 开画:加 `fx-run`,两条 transition 把主线画出、刻度淡入。 */
export const runDraw = (svg: Element) => svg.classList.add("fx-run");

/** 画完:撤掉描线用的类和 `pathLength`,主线回到文件自己的样子(本来就没有虚线,看不出切换)。 */
export function finishDraw(svg: Element) {
  svg.classList.remove("fx-pre", "fx-run");
  svg.querySelectorAll(LINES).forEach((el) => el.removeAttribute("pathLength"));
}
