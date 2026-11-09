/**
 * 落地页四张卡上文明主视觉的三样代码效果(2026-11-09 用户定 A,Design 第十九批之后):
 *   1. 页面一打开就描线(纯 CSS,不等 JS):主线(`.e-l` / `.e-l2`)约 1 秒画出,刻度(`.e-t`)随后淡入。
 *      JS 到了之后只做两件事:开头不在视口里的卡先停着、进视口再画;画过的不再画(重挂、换主题)。
 *   2. 金属光泽:每 11 秒一道斜光扫过(CSS,`globals.css` 的 `.emblem-sheen`)。
 *   3. 卡片随指针轻微倾斜(≤ 6°),主视觉比卡底多挪几像素。
 * 只认元素的类名(`.e-l` 主线、`.e-halo` 主线下的柔线、`.e-l2`、`.e-t` 刻度),不认几何。
 * 落地页用 Design 第二十四批的 F 版(嵌彩,`public/v4/emblems-f/`),别处用 G 版(天体仪,`public/v4/emblems/`)。
 * 这里只放纯逻辑与 DOM 小操作,组件在 `components/landing/LandingEmblem.tsx` 与 `Landing.tsx`。
 */

export const TILT_MAX_DEG = 6;
/** 主视觉相对卡底的视差,单位 px(指针在卡边时)。 */
export const PARALLAX_PX = 4;
/** 描线 0.15 s 起画 1 s,刻度 0.9 s 起淡入 0.45 s(globals.css 的 `emblem-draw` / `emblem-tick-in`),收尾再留一点。 */
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

// 已经画过的文明。模块级:重渲染、换主题(另一份从 display:none 出来会重启 CSS 动画)、卡片重挂都不再画第二遍;整页刷新才重来。
const drawn = new Set<string>();
export const shouldDraw = (key: string, reduced: boolean) => !reduced && !drawn.has(key);
export const markDrawn = (key: string) => void drawn.add(key);

/**
 * 描线要主线带 `pathLength="1"`(虚线长度按 1 算,CSS 动画才不用量长度)。在渲染时往 SVG 原文里加,
 * 服务端与客户端得到同一串,水合不会对不上。只加给类名里有 `e-l` / `e-l2` / `e-halo` 且自己没写 pathLength、没写虚线的元素
 * —— 这些线本来是实线,pathLength 对实线没有任何作用,所以画完留着也不改样子。`.e-halo` 和它上面的 `.e-l` 是同一条路径,
 * 一起画(第二十批 §1)。虚线由类名给的(`.e-tk` 刻度带、`.e-flow` 光流,写在图自己的 <style> 里)不在这三类里,不碰。
 */
export const DRAW_CLASSES = ["e-l", "e-l2", "e-halo"] as const;
export function withDrawLengths(svg: string): string {
  return svg.replace(/<([a-zA-Z]+)\b([^>]*)>/g, (tag, name: string, attrs: string) => {
    const cls = attrs.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    if (!DRAW_CLASSES.some((c) => cls.includes(c))) return tag;
    if (/\spathLength=|dasharray/.test(attrs)) return tag;
    return `<${name} pathLength="1"${attrs}>`;
  });
}

/** 画过的、离开视口等着画的:状态写成 SVG 根上的类(SVG 是原文插进去的,不归 React 管,重渲染不会抹掉)。 */
export const DRAW_WAIT = "fx-wait";
export const DRAW_DONE = "fx-done";
