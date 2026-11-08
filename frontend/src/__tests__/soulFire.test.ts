/**
 * @jest-environment node
 *
 * 魂火(Design v4 第十六批 §2)的纯计算:疏密、生成位置、推进、亮度、什么时候只给静态图。数字是那张表上的。
 */
import {
  EMBLEM_DIM,
  FADE_IN,
  brightness,
  emblemRadius,
  particleCount,
  spawn,
  step,
  wantsStatic,
} from "@/src/lib/soulFire";

/** 可重放的伪随机(同一个种子同一串数)。 */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("soul fire density", () => {
  it("a desktop card (276 × 460) holds 14, a phone's landscape card about 6", () => {
    expect(particleCount(276, 460)).toBe(14);
    expect(particleCount(361, 148)).toBe(6);
    expect(particleCount(10, 10)).toBe(1);
  });
});

describe("spawning", () => {
  const ex = { x: 138, y: 300, r: 104 };
  it("comes up in the lower two thirds, outside the emblem's circle, with the table's sizes and opacities", () => {
    const rand = seeded(7);
    for (let i = 0; i < 500; i++) {
      const p = spawn(276, 460, "dark", ex, rand);
      expect(p.y).toBeGreaterThanOrEqual(460 / 3);
      expect(p.y).toBeLessThanOrEqual(460);
      expect((p.x - ex.x) ** 2 + (p.y - ex.y) ** 2 >= ex.r ** 2 || p.y === 460).toBe(true);
      expect(p.r === 3 || (p.r >= 1.2 && p.r <= 2.4)).toBe(true);
      expect(p.alpha).toBeGreaterThanOrEqual(0.35);
      expect(p.alpha).toBeLessThanOrEqual(0.85);
      expect(p.speed).toBeGreaterThanOrEqual(8);
      expect(p.speed).toBeLessThanOrEqual(14);
      expect(p.life).toBeGreaterThanOrEqual(7);
      expect(p.life).toBeLessThanOrEqual(11);
    }
  });

  it("is fainter in the light theme", () => {
    const rand = seeded(3);
    for (let i = 0; i < 200; i++) {
      const p = spawn(276, 460, "light", null, rand);
      expect(p.alpha).toBeGreaterThanOrEqual(0.28);
      expect(p.alpha).toBeLessThanOrEqual(0.58);
    }
  });

  it("about 15% are the big ones", () => {
    const rand = seeded(11);
    const big = Array.from({ length: 2000 }, () => spawn(276, 460, "dark", null, rand)).filter((p) => p.r === 3).length;
    expect(big / 2000).toBeGreaterThan(0.11);
    expect(big / 2000).toBeLessThan(0.19);
  });
});

describe("motion and brightness", () => {
  it("rises, sways at most 8px, and dies at the end of its life", () => {
    const p = spawn(276, 460, "dark", null, seeded(5));
    const y0 = p.y;
    let alive = true;
    for (let i = 0; i < 30; i++) alive = step(p, 1 / 30);
    expect(alive).toBe(true);
    expect(y0 - p.y).toBeCloseTo(p.speed, 0);
    expect(Math.abs(p.x - p.x0)).toBeLessThanOrEqual(8);
    expect(step(p, p.life)).toBe(false);
  });

  it("fades in, and is pressed down to 30% inside the emblem's circle", () => {
    const p = { ...spawn(276, 460, "dark", null, seeded(9)), age: 0 };
    expect(brightness(p, null)).toBe(0);
    p.age = FADE_IN * 2;
    const ex = { x: p.x, y: p.y, r: 10 };
    expect(brightness(p, ex)).toBeCloseTo(brightness(p, null) * EMBLEM_DIM, 5);
  });

  it("the emblem's circle is about 104 on desktop and 50 on a phone", () => {
    expect(emblemRadius(true)).toBe(104);
    expect(emblemRadius(false)).toBe(50);
  });
});

describe("when to show the still picture instead", () => {
  it("reduced motion, ≤ 4 cores or ≤ 4 GB → static; unknown values do not count as low-end", () => {
    expect(wantsStatic({ reducedMotion: true, cores: 16, memoryGb: 16 })).toBe(true);
    expect(wantsStatic({ reducedMotion: false, cores: 4 })).toBe(true);
    expect(wantsStatic({ reducedMotion: false, cores: 8, memoryGb: 4 })).toBe(true);
    expect(wantsStatic({ reducedMotion: false, cores: 8, memoryGb: 8 })).toBe(false);
    expect(wantsStatic({ reducedMotion: false })).toBe(false);
  });
});
