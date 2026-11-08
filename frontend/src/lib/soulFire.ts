/**
 * 落地页卡片里的魂火(Design v4 第十六批 §2)。这里是纯计算:生成、推进、亮度;画在 `components/landing/SoulFire.tsx`。
 * 数都照第十六批那张表,改之前先改那张表:
 *   芯半径 1.2–2.4px,外圈约芯的 3.6 倍;15% 是大颗,芯 3px。
 *   每约 9000 px² 一颗(桌面 276 × 460 的卡 14 颗,手机横卡 6 颗)。
 *   不透明度深色 .35–.85、浅色 .28–.58;明灭 ±15%、0.5–1 Hz。
 *   向上 8–14 px/s;左右摆 ±8px、周期 5–8 秒;寿命 7–11 秒,淡入 1.5 秒、淡出 2 秒;从卡的下三分之二生成。
 *   徽记一圈(半径桌面约 104、手机约 50)里不生成;飘进去的亮度压到三成。
 * 周期刻意不和徽记动画的 3.2 / 6 / 7 / 90 秒对齐(摆动 5–8 秒的随机值、明灭 1–2 秒)。
 */

export interface Particle {
  x: number;
  y: number;
  /** 芯半径(px);外圈 = 芯 × HALO。 */
  r: number;
  /** 基础不透明度。 */
  alpha: number;
  /** 向上的速度(px/s)。 */
  speed: number;
  /** 左右摆的周期(s)与相位。 */
  swayPeriod: number;
  swayPhase: number;
  /** 明灭频率(Hz)与相位。 */
  flickerHz: number;
  flickerPhase: number;
  /** 寿命(s)与已活的时间(s)。 */
  life: number;
  age: number;
  /** 生成时的 x(摆动以它为中心)。 */
  x0: number;
}

export const HALO = 3.6;
export const SWAY = 8;
export const FADE_IN = 1.5;
export const FADE_OUT = 2;
export const AREA_PER_PARTICLE = 9000;
export const EMBLEM_DIM = 0.3;
export const FPS = 30;

export type Theme = "dark" | "light";
const ALPHA: Record<Theme, [number, number]> = { dark: [0.35, 0.85], light: [0.28, 0.58] };

/** 一张卡同时有几颗:按面积,至少 1 颗。 */
export const particleCount = (width: number, height: number) => Math.max(1, Math.round((width * height) / AREA_PER_PARTICLE));

const between = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand();

export interface Exclusion {
  x: number;
  y: number;
  r: number;
}

const inside = (x: number, y: number, ex: Exclusion | null) => !!ex && (x - ex.x) ** 2 + (y - ex.y) ** 2 < ex.r ** 2;

/**
 * 生成一颗:卡的下三分之二里、徽记圈外(试 12 次都落在圈里就放在卡底)。`age` 给随机值时整张卡开场就是满的,
 * 不是从底下一起冒出来。
 */
export function spawn(width: number, height: number, theme: Theme, ex: Exclusion | null, rand: () => number = Math.random, age = 0): Particle {
  let x = between(rand, 0, width);
  let y = between(rand, height / 3, height);
  for (let i = 0; i < 12 && inside(x, y, ex); i++) {
    x = between(rand, 0, width);
    y = between(rand, height / 3, height);
  }
  if (inside(x, y, ex)) y = height;
  const big = rand() < 0.15;
  const [lo, hi] = ALPHA[theme];
  return {
    x,
    y,
    x0: x,
    r: big ? 3 : between(rand, 1.2, 2.4),
    alpha: between(rand, lo, hi),
    speed: between(rand, 8, 14),
    swayPeriod: between(rand, 5, 8),
    swayPhase: between(rand, 0, Math.PI * 2),
    flickerHz: between(rand, 0.5, 1),
    flickerPhase: between(rand, 0, Math.PI * 2),
    life: between(rand, 7, 11),
    age,
  };
}

/** 推进 dt 秒:往上飘、左右摆。寿命到了或飘出卡顶返回 false(调用方换一颗新的)。 */
export function step(p: Particle, dt: number): boolean {
  p.age += dt;
  p.y -= p.speed * dt;
  p.x = p.x0 + SWAY * Math.sin((2 * Math.PI * p.age) / p.swayPeriod + p.swayPhase);
  return p.age < p.life && p.y + p.r * HALO > 0;
}

/** 此刻的不透明度:淡入 1.5 秒、淡出 2 秒、明灭 ±15%,在徽记圈里压到三成。 */
export function brightness(p: Particle, ex: Exclusion | null): number {
  const fadeIn = Math.min(1, p.age / FADE_IN);
  const fadeOut = Math.min(1, Math.max(0, (p.life - p.age) / FADE_OUT));
  const flicker = 1 + 0.15 * Math.sin(2 * Math.PI * p.flickerHz * p.age + p.flickerPhase);
  const dim = inside(p.x, p.y, ex) ? EMBLEM_DIM : 1;
  return Math.max(0, Math.min(1, p.alpha * fadeIn * fadeOut * flicker * dim));
}

/** 徽记圈的半径:桌面约 104,手机约 50。 */
export const emblemRadius = (desktop: boolean) => (desktop ? 104 : 50);

/** 减少动态效果或低端机(≤ 4 核、≤ 4 GB)只给静态图。缺的值不算低端。 */
export function wantsStatic(env: { reducedMotion: boolean; cores?: number; memoryGb?: number }): boolean {
  return env.reducedMotion || (env.cores !== undefined && env.cores <= 4) || (env.memoryGb !== undefined && env.memoryGb <= 4);
}
