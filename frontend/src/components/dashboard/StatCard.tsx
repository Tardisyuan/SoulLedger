"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { groupDigits } from "@/src/components/dashboard/numberFormat";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { sharePercent } from "@/src/components/dashboard/LegendLedger";

/**
 * 概览页的状态卡(Design A4):「字形 + 状态名」→ 标题字体 28/36 的数 → 6px 进度条
 * (底 s2,填充是这个状态在冷灰蓝梯度上的那一档)→ 等宽 12px 占比。
 *
 * 393 宽下前四张进 2 × 2 网格(20/28 的数、4px 的条),`compactLine` 那一张(已终结)
 * 不进网格,写成一行小字 —— 它仍是一个 `data-kpi-card`、仍有高度,只是排法不同。
 *
 * `data-kpi-card` 是**卡片**的锚,`data-kpi` 是**值**的锚:值那一格只在数据落地后存在,
 * 所以 `[data-kpi]` 从 0 变 5 正是「加载态 → 落地态」。加载态与落地态必须一样高,
 * 否则整条在数据到达时跳一下 —— `e2e/kpi-row-does-not-jump-when-data-lands.spec.ts`
 * 在真浏览器里量这件事。所以骨架与值共用同一个定高的盒子(`h-9` / 窄屏 `h-7`),
 * 进度条与占比在加载时也占着位置。
 */
function StatCardInner({
  label,
  value,
  total,
  barClass,
  isLoading,
  compactLine = false,
}: {
  label: React.ReactNode;
  value?: number;
  /** The whole the share is of; the bar and percent are drawn against it. */
  total: number;
  /** A background utility for the fill (the state's ramp step). */
  barClass: string;
  isLoading: boolean;
  /** 393: this card is a line of small type below the 2 × 2 grid. */
  compactLine?: boolean;
}) {
  const known = !isLoading && value !== undefined && value !== null;
  const share = known && total > 0 ? (value as number) / total : 0;
  return (
    <div
      data-kpi-card=""
      className={
        compactLine
          ? "flex flex-col gap-1 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-4 py-4 max-md:col-span-2 max-md:flex-row max-md:items-center max-md:gap-2 max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:text-xs max-md:text-[oklch(var(--color-ink-muted))]"
          : "flex flex-col gap-1 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-3 md:px-4 md:py-4"
      }
    >
      <div className="text-xs text-[oklch(var(--color-ink-muted))] md:text-sm">{label}</div>
      <div className={`flex items-center ${compactLine ? "h-4.5 md:h-9" : "h-7 md:h-9"}`}>
        {isLoading ? (
          <Skeleton className={`w-12 md:h-8 ${compactLine ? "h-4" : "h-6"}`} />
        ) : (
          // `value ?? 0` would print a confident, grouped 0 for a value the API did
          // not send; an em dash is a claim about this cell, not about the ledger.
          <div
            data-kpi=""
            className={`font-title tabular-nums text-[oklch(var(--color-ink))] ${compactLine ? "md:text-xl max-md:font-sans max-md:text-xs max-md:text-[oklch(var(--color-ink-muted))]" : "text-lg md:text-xl"}`}
          >
            {known ? groupDigits(value as number) : <MissingValue kind="unrecorded" />}
          </div>
        )}
      </div>
      <div aria-hidden="true" className={`h-1 bg-[oklch(var(--color-surface-2))] md:h-1.5 ${compactLine ? "max-md:hidden" : ""}`}>
        {known && (value as number) > 0 && (
          <div className={`h-full min-w-0.5 ${barClass}`} style={{ width: `${share * 100}%` }} />
        )}
      </div>
      <div className="font-mono text-xs text-[oklch(var(--color-ink-muted))] max-md:hidden">
        {known ? sharePercent(value as number, total) : "\u00a0"}
      </div>
    </div>
  );
}

export const StatCard = React.memo(StatCardInner);
