"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { groupDigits } from "@/src/components/dashboard/numberFormat";

/**
 * 概览页顶部那四张 KPI 卡。原先长在 app/dashboard/page.tsx 里，那个文件越过
 * 仓库 500 行的上限之后搬到这里；标记与 `data-kpi` 锚都逐字未改。
 */
function StatCardInner({
  label,
  value,
  isLoading,
  color = "text-[hsl(var(--color-ink))]",
}: {
  label: string;
  value?: number;
  isLoading: boolean;
  color?: string;
}) {
  return (
    <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
      <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{label}</div>
      {isLoading ? (
        // 骨架屏得和它替换的东西一样高,否则数据落地时整行会往下跳一格。
        // text-08 是 56px / line-height 1,所以 h-14。
        <Skeleton className="h-14 w-24 mt-2" />
      ) : (
        // `data-kpi` 是给测试用的锚:DashboardPage.test.tsx 原先靠
        // `className.includes("text-2xl font-bold")` 认出这四张卡,那把断言
        // 钉在了一个这轮改版**就是要改**的字号上。属性说的是「这是一个 KPI」,
        // 字号说的是「它现在多大」——只有前者是测试真正关心的。
        <div data-kpi="" className={`text-08 tabular-nums ${color}`}>
          {groupDigits(value ?? 0)}
        </div>
      )}
    </div>
  );
}

export const StatCard = React.memo(StatCardInner);
