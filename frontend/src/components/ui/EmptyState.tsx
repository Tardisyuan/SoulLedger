import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 空态 —— Stage 11 B slots。
 *
 * 迁移前站内有 23 处手搓空态、15 种写法（`text-center py-12` 系、
 * 「暂无数据」裸 `<p>` 系、带插画的卡片系…）。这里收成一种。
 *
 * 三条规格，逐条对应下面的实现：
 *
 * 1) **居左，不居中。** 空态是卷宗里的一条注记，不是一张海报。居中会把它读成
 *    页面的主体内容，而它恰恰是「这里什么都没有」。所以没有 `text-center`、
 *    没有 `items-center`、没有 `mx-auto` —— `src/__tests__/EmptyState.test.tsx`
 *    盯着这四个类名。
 *
 * 2) **标题上方一个 28px 的 □ 字形**(规范 v3,2026-10-01;v1 / v2 是一条 24×2 的
 *    `--color-block` 短线),用 `--color-ink-muted`。它不按文明染色(规范 v1 §1.8 的
 *    那条照旧):空态说的是「这里没有东西」,和哪个文明无关。
 *
 * 3) 标题 15 / 600 + 12 ink3 一句原因 + 一个动作(规范 v2 补足 C15「空」:「本月没有账目」
 *    「换个月份，或清除类别筛选。」「清除筛选」)。v1 是 `text-2xs` 标题 + `text-sm` 原因。原因写成一句话，不是一个
 *    名词短语：「还没有灵魂被登记」而不是「无数据」。

 */
export interface EmptyStateProps {
  /** 标题,15 / 600。一个短语。 */
  title: React.ReactNode;
  /** 一句原因,12 ink3。为什么这里是空的、下一步去哪。 */
  reason?: React.ReactNode;
  /** 一个动作。**一个** —— 空态不是工具栏。 */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, reason, action, className }: EmptyStateProps) {
  return (
    <div data-empty-state="" className={cn("py-8", className)}>
      {/* 规范 v3 的 □,28px(text-xl)。aria-hidden —— 它是标记，不是内容。 */}
      <span
        data-empty-state-mark=""
        aria-hidden="true"
        className="block text-xl leading-none text-[oklch(var(--color-ink-muted))]"
      >
        □
      </span>

      <p data-empty-state-title="" className="text-md font-semibold text-[oklch(var(--color-ink))] mt-4">
        {title}
      </p>

      {reason ? (
        <p data-empty-state-reason="" className="text-xs text-[oklch(var(--color-ink-subtle))] mt-1">
          {reason}
        </p>
      ) : null}

      {action ? (
        <div data-empty-state-action="" className="mt-4">
          {action}
        </div>
      ) : null}
    </div>
  );
}
