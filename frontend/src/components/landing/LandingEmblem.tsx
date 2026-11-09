"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { EMBLEM_SVGS } from "@/src/generated/emblemSvgs";
import { DRAW_DONE, DRAW_MS, DRAW_WAIT, markDrawn, reducedMotion, shouldDraw, withDrawLengths } from "@/src/lib/emblemFx";
import { cn } from "@/lib/utils";

/**
 * 落地页卡上的文明主视觉,内联 SVG 版(描线与光泽要够到图里的元素,`<img>` 里的够不到)。
 *
 * 用 Design 第二十批的 C 版(2.5D,public/v4/emblems-c;用户 2026-11-09 定:卡上用 C,别处的 CivEmblem 用 B)。
 * SVG 原文在构建时嵌进来(`src/generated/emblemSvgs.ts`,由 `scripts/gen-emblem-svgs.mjs` 从 public/v4/emblems-c 生成,
 * underworldMap.test.ts 核对它和文件逐字相同、消毒后不少一样东西)—— 所以服务端渲染的第一帧就有图,不等水合和请求。
 * 深浅两份都在 DOM 里,按 `:root.light` 只显示一份(globals.css 的 `.v4-emblem`,和 `<img>` 版同一条规则);
 * 两份的渐变 id 各带文明与主题,不会撞(同一测试核对)。
 *
 * 描线是纯 CSS,页面一打开就画,没有 JS 也画。JS 到了之后(`fx-wait` / `fx-done` 写在 SVG 根上):
 *   - 开头就不在视口里的(手机上往下的卡):先停着,快进视口时再从头画;
 *   - 画过的不再画(卡片重挂、换主题时另一份从 display:none 出来);
 *   - 离开视口或标签页藏起来时 `data-paused`:光泽和图里自己的动画都停。
 */
export function LandingEmblem({ civ, size, className }: { civ: SealCiv; size: number; className?: string }) {
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const svgs = Array.from(el.querySelectorAll("svg"));
    const mark = (c: string, on: boolean) => svgs.forEach((s) => s.classList.toggle(c, on));
    const done = () => {
      mark(DRAW_WAIT, false);
      mark(DRAW_DONE, true);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = el.getBoundingClientRect();
    const onScreenNow = r.bottom > 0 && r.top < window.innerHeight;
    const canWatch = typeof IntersectionObserver === "function";
    let waiting = false;
    if (!shouldDraw(civ, reducedMotion())) done();
    else if (onScreenNow || !canWatch) {
      // 正在画(CSS 从页面打开就开始了):画完再标 done,之后换主题不重画。
      markDrawn(civ);
      timer = setTimeout(done, DRAW_MS);
    } else {
      waiting = true;
      mark(DRAW_WAIT, true);
    }

    let onScreen = onScreenNow;
    const sync = () => setPaused(!onScreen || document.visibilityState === "hidden");
    // 下沿多留 15%:等着画的卡在露出来之前一点点就重启动画(重启时线先藏起来),不会先露一帧整图。
    const io = canWatch
      ? new IntersectionObserver(
          (entries) => {
            onScreen = entries[entries.length - 1].isIntersecting;
            sync();
            if (!onScreen || !waiting) return;
            waiting = false;
            markDrawn(civ);
            mark(DRAW_WAIT, false);
            timer = setTimeout(done, DRAW_MS);
          },
          { rootMargin: "0px 0px 15% 0px" },
        )
      : null;
    io?.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (timer) clearTimeout(timer);
    };
  }, [civ]);

  return (
    <span
      ref={box}
      aria-hidden="true"
      data-testid="civ-emblem"
      data-emblem={civ}
      data-emblem-fx=""
      data-paused={paused ? "" : undefined}
      className={cn("emblem-fx pointer-events-none relative inline-block size-(--emblem-size)", className)}
      style={{ "--emblem-size": `${size}px` } as CSSProperties}
    >
      {(["dark", "light"] as const).map((theme) => (
        <span
          key={theme}
          data-theme={theme}
          className="v4-emblem relative block size-full"
          style={{ "--sheen-mask": `url("/v4/emblems-c/soulledger-emblem-${civ}-${theme}.svg")` } as CSSProperties}
        >
          {/* 原文来自仓库里的静态文件,构建时嵌入;没有脚本、事件属性、外链(underworldMap.test.ts 逐份核对)。 */}
          <span className="block size-full [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: withDrawLengths(EMBLEM_SVGS[`${civ}-${theme}`]) }} />
          <span className="emblem-sheen" />
        </span>
      ))}
    </span>
  );
}
