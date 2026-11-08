"use client";

import { useEffect, useRef, useState } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import {
  FPS,
  HALO,
  brightness,
  emblemRadius,
  particleCount,
  spawn,
  step,
  wantsStatic,
  type Exclusion,
  type Particle,
  type Theme,
} from "@/src/lib/soulFire";

/**
 * 魂火(Design v4 第十六批 §2):落地页每张文明卡里一层慢慢往上飘的光点,压在卡的底色与内容之间,随卡裁切。
 * 手写 canvas,不用库;计算在 `src/lib/soulFire.ts`。
 *
 * - 颜色取这张卡自己文明的令牌(卡的 `<li data-civ>` 下 `--color-glow` 是文明光晕色,`--color-main-ink` 是文明字色):
 *   深色芯偏白、外圈光晕色;浅色芯用文明字色(即 Design 的 `--tL`)、外圈光晕色。光点按颜色各画一张小图,之后每帧只贴图。
 * - 30 fps;卡不在视窗里、标签页不在前台时停。不响应鼠标。没有拖尾(每帧清屏)。
 * - 减少动态效果、低端机(≤ 4 核或 ≤ 4 GB)、或浏览器缺 canvas / IntersectionObserver / matchMedia 时:
 *   换成 `public/v4/soulfire/soulfire-<文明>-<深浅>.svg` 静态图,铺满卡、居中裁切(深浅两份按 `.v4-themed` 只显示一份)。
 */

/** 深色时的芯:Design 第十六批定的偏白暖色(#FFF6E8),不是令牌 —— 只在这一处。 */
const DARK_CORE = "rgb(255 246 232)";
const SPRITE = 64;

function sprite(core: string, halo: string): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = c.height = SPRITE;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  // 芯占外圈半径的 1 / 3.6;芯到外圈之间是光晕色,渐隐到 0。
  grad.addColorStop(0, core);
  grad.addColorStop(1 / HALO, halo);
  grad.addColorStop(1, "transparent");
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}

const themeNow = (): Theme => (document.documentElement.classList.contains("light") ? "light" : "dark");

function canAnimate(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" || typeof IntersectionObserver === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return !wantsStatic({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    cores: nav.hardwareConcurrency || undefined,
    memoryGb: nav.deviceMemory,
  });
}

export function SoulFire({ civ }: { civ: SealCiv }) {
  const [mode, setMode] = useState<"pending" | "live" | "static">("pending");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setMode(canAnimate() ? "live" : "static");
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    const canvas = canvasRef.current;
    const card = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !card || !ctx) {
      setMode("static");
      return;
    }
    let particles: Particle[] = [];
    let image: HTMLCanvasElement | null = null;
    let theme: Theme = themeNow();
    let ex: Exclusion | null = null;
    let w = 0;
    let h = 0;
    let visible = false;
    let raf = 0;
    let last = 0;

    const paintSprite = () => {
      theme = themeNow();
      const css = getComputedStyle(card);
      const glow = `oklch(${css.getPropertyValue("--color-glow").trim()})`;
      const ink = `oklch(${css.getPropertyValue("--color-main-ink").trim()})`;
      try {
        image = sprite(theme === "dark" ? DARK_CORE : ink, glow);
      } catch {
        image = null; // 认不得 oklch 的老浏览器:addColorStop 抛 SyntaxError
      }
      if (!image) setMode("static");
    };
    const layout = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = card.clientWidth;
      h = card.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const emblem = card.querySelector("[data-testid='civ-emblem']");
      if (emblem) {
        const a = emblem.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        ex = { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, r: emblemRadius(window.matchMedia("(min-width: 768px)").matches) };
      }
      const n = particleCount(w, h);
      particles = Array.from({ length: n }, () => {
        const p = spawn(w, h, theme, ex);
        // 开场就是满的:每颗随机已活了一段,并按那段时间往上挪过。
        const age = Math.random() * p.life * 0.8;
        step(p, age);
        return p;
      });
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS - 1) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      ctx.clearRect(0, 0, w, h);
      if (!image) return;
      particles = particles.map((p) => (step(p, dt) ? p : spawn(w, h, theme, ex)));
      for (const p of particles) {
        const size = p.r * HALO * 2;
        ctx.globalAlpha = brightness(p, ex);
        ctx.drawImage(image, p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };
    const start = () => {
      if (!raf && visible && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    paintSprite();
    layout();
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    io.observe(card);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
    resize?.observe(card);
    const themeWatch = new MutationObserver(() => themeNow() !== theme && paintSprite());
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      resize?.disconnect();
      themeWatch.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, [mode]);

  if (mode === "pending") return null;
  if (mode === "static") {
    return (
      <span aria-hidden="true" data-soulfire="static" className="pointer-events-none absolute inset-0">
        {(["dark", "light"] as const).map((theme) => (
          <img
            key={theme}
            src={`/v4/soulfire/soulfire-${civ}-${theme}.svg`}
            alt=""
            loading="lazy"
            decoding="async"
            data-theme={theme}
            className="v4-themed size-full object-cover"
          />
        ))}
      </span>
    );
  }
  return <canvas ref={canvasRef} aria-hidden="true" data-soulfire="live" className="pointer-events-none absolute inset-0 size-full" />;
}
