"use client";

/**
 * 与 app/dashboard/page.tsx 同形的骨架屏:PageShell 的页头(标题 + 副标题 +
 * 右侧动作)、一条标签页带,然后是四张 KPI 卡与两张图表。
 *
 * 换掉的是一个手搓双环转圈,它的两个环写着 `border-amber-500/20` 与
 * `border-t-amber-500` —— Tailwind 原生调色板(基线里的 `palette: 2`),而
 * amber-500 恰好就是 --color-accent 的值,于是一个「正在加载」用掉了全站的
 * 强调色。骨架屏还多做一件转圈做不到的事:KPI 现在是 `text-08`(56px),
 * 加载态若不占住那个高度,数据落地时整页会往下跳一格。
 *
 * 没有 `min-h-screen` —— AppLayout 的槽位已经是 min-h-[calc(100vh-4rem)]。
 */
export default function Loading() {
  return (
    <div className="bg-[hsl(var(--color-canvas))]">
      <header className="border-b border-[hsl(var(--color-hairline))]">
        <div className="max-w-page mx-auto px-6 pt-10 pb-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-64 bg-[hsl(var(--color-surface-1))] animate-pulse" />
            <div className="ml-auto h-9 w-32 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          </div>
          <div className="h-6 w-96 bg-[hsl(var(--color-surface-1))] animate-pulse mt-3" />
        </div>
      </header>

      <div className="border-b border-[hsl(var(--color-hairline))]">
        <div className="max-w-page mx-auto px-6 flex items-center gap-1">
          <div className="h-10 w-24 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          <div className="h-10 w-24 bg-[hsl(var(--color-surface-1))] animate-pulse" />
        </div>
      </div>

      <div className="max-w-page mx-auto px-6 py-6 space-y-6">
        {/* 四张 KPI 卡。h-28 = 11px 标签 + 8px 间隔 + 56px 数字 + 16px 上下内距。 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          <div className="h-72 bg-[hsl(var(--color-surface-1))] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
