import type { CSSProperties, ReactNode } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { cn } from "@/lib/utils";

/**
 * 文明主视觉(规范 v4 第二批定稿,Design 第八批 `emblems/`):地府刻度转、欧洲九圈明暗、埃及横梁摆、希腊光流。
 * 落地页四张卡、概览主卡右上角、/rebirths 的「没有转世」页用它。
 *
 * 用 `<img>` 载 SVG:动画写在 SVG 自己的 <style> 里,只在图里生效,不进文档;那段样式自带
 * `prefers-reduced-motion` 一条(停在静态图)。深浅两份都放,`:root.light` 决定显示哪一份(globals.css
 * `.v4-emblem`)—— 首帧就对,不等主题上下文。装饰图,读屏跳过(文明名就写在它旁边)。
 *
 * 第十九批重画:地府的冥字印在 SVG 里已转成路径(Noto Serif SC 600 的字形)——`<img>` 里的 SVG
 * 不加载网页字体,留 `<text>` 就落回系统字体。32px 及以下换成单色小号(`-mark.svg`,24 网格):
 * 完整徽记缩到这么小,刻度和读数格糊成一片。小号内联,`currentColor` 跟随文字色。
 */
const MARK_MAX = 32;

// 与 public/v4/emblems/soulledger-emblem-<civ>-mark.svg 逐元素一致(underworldMap.test.ts 核对)。
const mark = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="block size-full">
    {children}
  </svg>
);
const MARKS: Record<SealCiv, ReactNode> = {
  cn: mark(
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 2.5v4M12 17.5v4M3.8 7.2l3.4 2M16.8 14.8l3.4 2M3.8 16.8l3.4-2M16.8 9.2l3.4-2" />
      <rect x="9" y="9" width="6" height="6" rx=".6" />
    </>,
  ),
  eu: mark(
    <>
      <path d="M6 11 12 3l6 8Z" />
      <path d="M3 13.5h18M5.5 13.5 12 21l6.5-7.5M8 16.5h8" />
    </>,
  ),
  eg: mark(<path d="M12 5v14M8.5 20.5h7M3.5 8h17M5.5 8 3 14h5ZM18.5 8 16 14h5Z" />),
  gr: mark(
    <>
      <path d="M12 21v-7M12 14 5.5 6.5M12 14V4.5M12 14l6.5-7.5" />
      <circle cx="12" cy="14" r="1.6" />
      <path d="M3 21.5h18" />
    </>,
  ),
};

export function CivEmblem({ civ, size, className }: { civ: SealCiv; size: number; className?: string }) {
  // 尺寸走 CSS 变量,调用点可以用 `md:size-…` 在宽屏换大小(行内 width 会压过类名)。
  const style = { "--emblem-size": `${size}px` } as CSSProperties;
  if (size <= MARK_MAX) {
    return (
      <span aria-hidden="true" data-testid="civ-emblem" data-emblem={civ} data-emblem-mark="" className={cn("pointer-events-none inline-block size-(--emblem-size)", className)} style={style}>
        {MARKS[civ]}
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-testid="civ-emblem" data-emblem={civ} className={cn("pointer-events-none inline-block size-(--emblem-size)", className)} style={style}>
      {(["dark", "light"] as const).map((theme) => (
        // 裸 <img>:静态 SVG 不经图片优化代理(next/image 对 SVG 也只是原样转发),而且要两份按主题切。
        <img
          key={theme}
          src={`/v4/emblems/soulledger-emblem-${civ}-${theme}.svg`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          data-theme={theme}
          className="v4-emblem block size-full"
        />
      ))}
    </span>
  );
}
