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
 * 2) **一条 24px 长、2px 粗的短线压在标题上方**，用 `--civ-mark` 着色。
 *    这是全站少数几处直接读 `--civ-mark` 的地方之一（另一处是
 *    `src/components/layout/TenantSignal.tsx`）。
 *
 * 3) `text-01` 标题 + `text-04` 一句原因 + 一个动作。原因写成一句话，不是一个
 *    名词短语：「还没有灵魂被登记」而不是「无数据」。
 *
 * **`--civ-mark` 在未映射租户下是灰色（`app/globals.css:57`，`215 8% 57%`），
 * 这是刻意的** —— 那条注释说得很清楚：灰色说的是「没有文明」，而那是真话。
 * 不要在这里给它兜一个彩色 fallback。
 */
export interface EmptyStateProps {
  /** 标题，`text-01`。一个短语。 */
  title: React.ReactNode;
  /** 一句原因，`text-04` + `text-ink-subtle`。为什么这里是空的。 */
  reason?: React.ReactNode;
  /** 一个动作。**一个** —— 空态不是工具栏。 */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, reason, action, className }: EmptyStateProps) {
  return (
    <div data-empty-state="" className={cn("py-10", className)}>
      {/* 24px × 2px。用 border-t 而不是 h-[2px]+bg：2 是 borderWidth 里已有的档，
          高度用任意值会绕开那道阶梯。aria-hidden —— 它是标记，不是内容。 */}
      <span
        data-empty-state-mark=""
        aria-hidden="true"
        className="block w-6 border-t-2 border-[hsl(var(--civ-mark))]"
      />

      <p data-empty-state-title="" className="text-01 text-ink mt-4">
        {title}
      </p>

      {reason ? (
        <p data-empty-state-reason="" className="text-04 text-ink-subtle mt-2">
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
