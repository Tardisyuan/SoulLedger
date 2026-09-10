"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { groupDigits } from "@/src/components/dashboard/numberFormat";
import { MissingValue } from "@/src/components/ui/DomainValue";

/**
 * 概览页顶部那四张 KPI 卡。原先长在 app/dashboard/page.tsx 里，那个文件越过
 * 仓库 500 行的上限之后搬到这里；标记与 `data-kpi` 锚都逐字未改。
 */
function StatCardInner({
  label,
  value,
  isLoading,
  color = "text-[oklch(var(--color-ink))]",
}: {
  label: string;
  value?: number;
  isLoading: boolean;
  color?: string;
}) {
  return (
    // `data-kpi-card` 是**卡片**的锚,`data-kpi` 是**值**的锚,两者的分工就是
    // 这轮守卫的全部机制:值那一格只在数据落地后存在,所以 `[data-kpi]` 的计数
    // 从 0 变 4 正是「加载态 → 落地态」这个跃迁,而卡片的高度在两次都量得到。
    // 见 `e2e/kpi-row-does-not-jump-when-data-lands.spec.ts`。
    <div
      data-kpi-card=""
      className="bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))]"
    >
      <div className="text-01 uppercase text-[oklch(var(--color-ink-subtle))]">{label}</div>
      {isLoading ? (
        // 骨架屏得和它替换的东西一样高,否则数据落地时整行会往下跳一格。
        // text-08 是 56px / line-height 1,所以 h-14。
        <Skeleton className="h-14 w-24 mt-2" />
      ) : (
        // `data-kpi` 是给测试用的锚:DashboardPage.test.tsx 原先靠
        // `className.includes("text-2xl font-bold")` 认出这四张卡,那把断言
        // 钉在了一个这轮改版**就是要改**的字号上。属性说的是「这是一个 KPI」,
        // 字号说的是「它现在多大」——只有前者是测试真正关心的。
        //
        // `mt-2` 必须和骨架屏的一致,而它此前是缺的。上面那条注释说两者得一样高,
        // 否则数据落地时整行会跳 —— **高度**确实对上了(h-14 对 text-08 的 56px/1),
        // **外边距**没有:骨架屏带 mt-2,这里没有,于是加载时整条 KPI 高 8px,数据
        // 到达时往上弹回去。对齐了盒子、没对齐盒子周围的空隙,留下的正是那条注释
        // 写来防止的缺陷,差在隔壁一个属性上。
        //
        // 这条修复曾经**无守卫**,而那句话是修复自己写下的:jsdom 没有布局引擎,
        // 量不出「加载时高 8px」,所以任何单测都测不到它。现在有了 ——
        // `e2e/kpi-row-does-not-jump-when-data-lands.spec.ts` 在真浏览器里把
        // `/ledger/stats/overview/` 的响应挂起,量加载态的卡片高度,放行,再量
        // 落地态,断言两者相等。把这里的 `mt-2` 删掉并重新 build,那条 E2E 实测
        // 报「加载时 113.9375px,数据落地后 105.9375px —— 差 -8.00px」,
        // chromium 与 mobile-chrome 上是同一组数(退出码 1)。
        <div data-kpi="" className={`text-08 tabular-nums mt-2 ${color}`}>
          {/* `value ?? 0` printed a confident, grouped **0** for a value the
              API did not send — the exact defect class this repo already
              eradicated from the souls balance column. A KPI reading 0 is a
              claim about the ledger; an em dash is a claim about this cell.
              `unrecorded`, not `inapplicable`: the stat applies, we just do
              not have it. */}
          {value === undefined || value === null ? (
            <MissingValue kind="unrecorded" />
          ) : (
            groupDigits(value)
          )}
        </div>
      )}
    </div>
  );
}

export const StatCard = React.memo(StatCardInner);
