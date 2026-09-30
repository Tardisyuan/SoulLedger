"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Seal } from "./Seal";

/**
 * 页头匾(规范 v2 §四「匾」、补足 C14):匾色底 + 题字 + 印 + 纹样带(band-{civ},≤ 393 用
 * compact)。颜色、纹样、题字字体都由 <html data-civ> 经 globals.css 选定。深色档上沿有
 * 1px onMain 20% 的高光(§七「是一条线,不算阴影」)。
 *
 * 题字按**实测宽度**降档,不按字数(C14):题字字体 40 放得下就 40;放不下 28;还放不下
 * 改用界面字体 20、最多两行、末尾截断,完整文字在 title 里。40 只给匾和登录页
 * (eslint.config.mjs 的 DISPLAY_ALLOW 放行的正是这个目录)。
 */

const TIER_CLASS = [
  "font-[family-name:var(--font-plaque)] text-display whitespace-nowrap",
  "font-[family-name:var(--font-plaque)] text-xl whitespace-nowrap",
  "font-sans text-lg line-clamp-2",
] as const;

const tierClass = (tier: 0 | 1 | 2) => `min-w-0 overflow-hidden ${TIER_CLASS[tier]}`;

/** 从 40 起逐档试,第一个不溢出的档就是它;都溢出就是两行 20。导出给测试。 */
export function fitTier(el: HTMLElement): 0 | 1 | 2 {
  for (const tier of [0, 1, 2] as const) {
    // 先把这一档的样式写到元素上再量 —— React 随后按同一档重渲染,写的是同一个值。
    el.dataset.tier = String(tier);
    el.className = tierClass(tier);
    if (tier === 2 || el.scrollWidth <= el.clientWidth) return tier;
  }
  return 2;
}


export function Plaque({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tier, setTier] = useState<0 | 1 | 2>(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      if (live) setTier(fitTier(el));
    };
    fit();
    // 题字字体是 swap 加载的:字到了宽度才对,所以字到之后再量一次;容器变宽窄也要再量。
    void document.fonts?.ready.then(fit);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(el.parentElement ?? el);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [title]);

  return (
    <div
      data-testid="plaque"
      className="bg-[oklch(var(--color-main))] text-[oklch(var(--color-on-main))] dark:border-t dark:border-[oklch(var(--color-on-main)/0.2)]"
    >
      <div className="flex min-h-12 items-center gap-3 px-4 py-1 md:px-8">
        <Seal size={40} />
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <div ref={ref} data-tier={tier} title={title} className={tierClass(tier)}>
            {title}
          </div>
          {meta ? <div className="min-w-0 shrink max-md:hidden">{meta}</div> : null}
        </div>
        {children}
      </div>
      {/* 纹样带是遮罩,遮罩会连它的伪元素一起遮,所以质感挂在外面这一层上(globals.css .plaque-tex)。 */}
      <div aria-hidden="true" data-testid="plaque-band" className="plaque-tex">
        <div className="plaque-band" />
      </div>
    </div>
  );
}
