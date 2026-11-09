import type { CSSProperties, ReactNode } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { cn } from "@/lib/utils";

/**
 * 文明主视觉(Design 第二十四批定稿 G 版天体仪,`emblems/`):外圈刻度慢转、中心呼吸;四个文明靠中心物与底座区分。
 * 概览主卡右上角、/rebirths 的「没有转世」页、空态用它;落地页四张卡用内联版 `LandingEmblem`(原文构建时嵌进 JS,水合后插入 —— 写进服务端 HTML 会让整页被外置成隐藏的第二份,见那个文件)。
 *
 * 用 `<img>` 载 SVG:动画写在 SVG 自己的 <style> 里,只在图里生效,不进文档;那段样式自带
 * `prefers-reduced-motion` 一条(停在静态图)。深浅两份都放,`:root.light` 决定显示哪一份(globals.css
 * `.v4-emblem`)—— 首帧就对,不等主题上下文。装饰图,读屏跳过(文明名就写在它旁边)。
 *
 * 第十九批重画:地府的冥字印在 SVG 里已转成路径(Noto Serif SC 600 的字形)——`<img>` 里的 SVG
 * 不加载网页字体,留 `<text>` 就落回系统字体。32px 及以下换成单色小号(`-mark.svg`,24 网格):
 * 完整徽记缩到这么小,刻度和读数格糊成一片。小号内联,`currentColor` 跟随文字色。
 *
 * 第二十四批(用户 2026-11-10 定):这里用 G 版天体仪(public/v4/emblems),落地页卡上用 F 版嵌彩(emblems-f)。
 * 小号是一圈环加伸出环外的一段地平环,中间是各文明的中心物(Design:只留环加中心物时像靶心)。
 */
const MARK_MAX = 32;

// 与 public/v4/emblems/soulledger-emblem-<civ>-mark.svg 逐元素一致(underworldMap.test.ts 核对;属性名按 JSX 写成驼峰)。
const mark = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" className="block size-full">
    <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M22.75 8.51L22.8 8.74L22.8 8.98L22.76 9.24L22.67 9.51L22.53 9.79L22.35 10.08L22.13 10.38L21.86 10.69M3.25 16.74L2.85 16.65L2.5 16.54L2.18 16.41L1.91 16.26L1.68 16.09L1.49 15.91L1.35 15.71L1.25 15.49L1.2 15.26L1.2 15.02L1.24 14.76L1.33 14.49L1.47 14.21L1.65 13.92L1.87 13.62L2.14 13.31M20.75 7.26L21.15 7.35L21.5 7.46L21.82 7.59L22.09 7.74L22.32 7.91L22.51 8.09L22.65 8.29L22.75 8.51" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    {children}
  </svg>
);
const MARKS: Record<SealCiv, ReactNode> = {
  cn: mark(<circle cx="12" cy="12" r="3.6" fill="currentColor" />),
  eu: mark(
    <>
      <circle cx="12" cy="12" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.9 11.1h4.2L12 14.3Z" fill="currentColor" />
    </>,
  ),
  eg: mark(
    <>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="1" />
    </>,
  ),
  gr: mark(
    <>
      <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 7.6v8.8M7.6 12h8.8M10 8.1Q8.4 12 10 15.9M14 8.1Q15.6 12 14 15.9" fill="none" stroke="currentColor" strokeWidth="1" />
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
