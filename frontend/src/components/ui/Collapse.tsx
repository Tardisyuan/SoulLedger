"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { usePrinting } from "@/src/hooks/usePrinting";

/** 超过这么多行的整节不做高度动画,只淡入淡出(Design 第三批回复)。 */
export const COLLAPSE_FADE_ONLY_ABOVE = 40;

type Phase = "unmounted" | "rest" | "enter" | "leave" | "hidden";

/**
 * 行展开 / 整节折叠的共享外壳(规范 v3 + Design 第三批回复,2026-10-03)。
 *
 * - 展开:`row-expand`,grid-template-rows 0fr→1fr,240ms 进场曲线。
 * - 收起:内容立刻 `inert`;`row-collapse` 1fr→0fr,160ms 出场曲线,内容前 80ms 淡出;
 *   动画结束(`animationend`)再加 `hidden`。焦点若在内容里,先还给触发按钮。
 * - `rows` > 40:不动高度,只淡入淡出 160ms。
 * - 减少动态效果:globals.css 的 1ms 规则让两段都瞬时,animationend 照样触发。
 *
 * 触发按钮由调用方渲染,必须带 `aria-expanded={open}` 与 `aria-controls={id}` ——
 * 焦点就是按 `aria-controls` 找回去的。一开始就是收起的内容不渲染;展开过之后收起,
 * 内容留在 DOM 里(`hidden`)。一开始就是展开的内容不播展开动画。
 */
export function Collapse({
  open: openProp,
  id,
  rows,
  className,
  children,
}: {
  open: boolean;
  id: string;
  /** 整节折叠传这一节的行数,超过 40 行只淡入淡出。 */
  rows?: number;
  className?: string;
  children: ReactNode;
}) {
  // 打印时一律展开:收着的内容这里根本不渲染,光靠打印样式展不开(`usePrinting`)。
  const printing = usePrinting();
  const open = openProp || printing;
  const [phase, setPhase] = useState<Phase>(open ? "rest" : "unmounted");
  const closed = phase === "unmounted" || phase === "leave" || phase === "hidden";
  if (open === closed) setPhase(open ? "enter" : "leave");

  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (phase !== "leave" || !ref.current?.contains(document.activeElement)) return;
    const trigger = Array.from(document.querySelectorAll<HTMLElement>("[aria-controls]")).find(
      (el) => el.getAttribute("aria-controls") === id
    );
    trigger?.focus();
  }, [phase, id]);

  if (phase === "unmounted") return null;
  const leaving = phase === "leave" || phase === "hidden";
  const fade = (rows ?? 0) > COLLAPSE_FADE_ONLY_ABOVE;
  const motion = leaving
    ? fade
      ? "collapse-fade-out"
      : "row-collapse"
    : phase === "enter"
      ? fade
        ? "collapse-fade-in"
        : "row-expand"
      : undefined;

  return (
    <div
      ref={ref}
      id={id}
      className={cn(motion, className)}
      inert={leaving}
      hidden={phase === "hidden"}
      data-collapse={phase}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && phase === "leave") setPhase("hidden");
      }}
    >
      <div>{children}</div>
    </div>
  );
}
