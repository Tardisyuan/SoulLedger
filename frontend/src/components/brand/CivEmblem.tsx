import type { CSSProperties } from "react";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { cn } from "@/lib/utils";

/**
 * 文明主视觉(规范 v4 第二批定稿,Design 第八批 `emblems/`):地府刻度转、欧洲九圈明暗、埃及横梁摆、希腊光流。
 * 落地页四张卡、概览主卡右上角、/rebirths 的「没有转世」页用它。
 *
 * 用 `<img>` 载 SVG:动画写在 SVG 自己的 <style> 里,只在图里生效,不进文档;那段样式自带
 * `prefers-reduced-motion` 一条(停在静态图)。深浅两份都放,`:root.light` 决定显示哪一份(globals.css
 * `.v4-emblem`)—— 首帧就对,不等主题上下文。装饰图,读屏跳过(文明名就写在它旁边)。
 */
export function CivEmblem({ civ, size, className }: { civ: SealCiv; size: number; className?: string }) {
  // 尺寸走 CSS 变量,调用点可以用 `md:size-…` 在宽屏换大小(行内 width 会压过类名)。
  const style = { "--emblem-size": `${size}px` } as CSSProperties;
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
