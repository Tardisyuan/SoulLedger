"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CivEmblem } from "@/src/components/brand/CivEmblem";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { useTheme } from "@/src/contexts/ThemeContext";
import { DRAW_MS, finishDraw, markDrawn, primeDraw, reducedMotion, runDraw, shouldDraw } from "@/src/lib/emblemFx";
import { loadSvg, parseMapSvg } from "@/src/lib/underworldMap";
import { cn } from "@/lib/utils";

/**
 * 落地页卡上的文明主视觉,内联 SVG 版(`emblemFx.ts` 的描线与光泽要够到图里的元素,`<img>` 里的够不到)。
 * 只放当前主题那一份(两份同在时渐变 id 会撞);文件按网址只取一次,和地图共用 `loadSvg`。
 * 取不到(jsdom 没有 fetch、网络错、解析失败)就退回 `CivEmblem` 的 `<img>`,效果没有,图照样在。
 *
 * 离开视口或标签页藏起来时 `data-paused`:光泽和图里自己的动画都停(globals.css)。
 */
export function LandingEmblem({ civ, size, className }: { civ: SealCiv; size: number; className?: string }) {
  const { theme } = useTheme();
  const src = `/v4/emblems/soulledger-emblem-${civ}-${theme === "light" ? "light" : "dark"}.svg`;
  // undefined = 还在取;null = 取不到,退回 <img>。
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [paused, setPaused] = useState(true);
  const box = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (typeof fetch !== "function" || typeof DOMParser === "undefined") {
      setText(null);
      return;
    }
    let alive = true;
    loadSvg(src).then(
      (t) => alive && setText(t),
      () => alive && setText(null),
    );
    return () => {
      alive = false;
    };
  }, [src]);

  // 插图要在绘制之前(否则先闪一帧整图再从头画),所以是 layout effect。
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !text) return;
    const svg = parseMapSvg(text, { keepStyle: true });
    if (!svg) {
      setText(null);
      return;
    }
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    let pending = typeof IntersectionObserver === "function" && shouldDraw(civ, reducedMotion());
    if (pending) primeDraw(svg);
    el.replaceChildren(svg);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let onScreen = false;
    const sync = () => setPaused(!onScreen || document.visibilityState === "hidden");
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1].isIntersecting;
            sync();
            if (!onScreen || !pending) return;
            pending = false;
            markDrawn(civ);
            frame = requestAnimationFrame(() => {
              runDraw(svg);
              timer = setTimeout(() => finishDraw(svg), DRAW_MS);
            });
          })
        : null;
    if (io && box.current) io.observe(box.current);
    else {
      onScreen = true;
      sync();
    }
    document.addEventListener("visibilitychange", sync);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      // 画到一半被换掉(换主题):这份图不再用,不用收尾;下一份按 shouldDraw 已经是「画过」。
    };
  }, [text, civ]);

  if (text === null) return <CivEmblem civ={civ} size={size} className={className} />;
  const style = { "--emblem-size": `${size}px`, "--sheen-mask": `url("${src}")` } as CSSProperties;
  return (
    <span
      ref={box}
      aria-hidden="true"
      data-testid="civ-emblem"
      data-emblem={civ}
      data-emblem-fx=""
      data-paused={paused ? "" : undefined}
      className={cn("emblem-fx pointer-events-none relative inline-block size-(--emblem-size)", className)}
      style={style}
    >
      <span ref={host} className="block size-full [&>svg]:block [&>svg]:size-full" />
      {text && <span className="emblem-sheen" />}
    </span>
  );
}
