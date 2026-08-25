"use client";

/**
 * 迁移前这里是一个手搓的双环转圈:`border-amber-500/20` + `border-t-amber-500`
 * ——两处 Tailwind 原生调色板(基线里 `palette: 2` 就是它们),在浅色主题下
 * 那一档偏亮偏淡;而且 amber-500 恰好是 --color-accent 的值,于是一个纯粹的
 * 「正在加载」用掉了全站的强调色。
 *
 * 换成骨架屏而不是 `PageSpinner`,有两个理由:
 *  1. 这一页的主体是一张矩阵表,页面**自己**在数据到达前也渲染骨架行
 *     (page.tsx 的 `!matrixReady` 分支)。路由级也给骨架,两段加载态是同一种
 *     语言;给转圈则是先转一下再跳成骨架。
 *  2. `PageSpinner`(src/components/ui/Spinner.tsx:115)里写着 `min-h-screen`,
 *     而它渲染在 AppLayout 的 `min-h-[calc(100vh-4rem)]` 槽位里 —— 那正是
 *     PageShell 文件头第 3 条点名的 64px 死滚动。那个文件不在本次改动的所有权
 *     范围内,所以只挂账不动手。
 */
export default function Loading() {
  return (
    <div className="bg-canvas">
      <header className="border-b border-[hsl(var(--color-hairline))]">
        <div className="px-6 pt-10 pb-6">
          {/* h-10 对着 text-07 的 32px × 1.2;h-6 对着 text-04 副标题。 */}
          <div className="h-10 w-64 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          <div className="h-6 w-96 bg-[hsl(var(--color-surface-1))] animate-pulse mt-3" />
        </div>
      </header>

      {/* variant="full":矩阵的列数随角色数增长,这里也不设 max-width。 */}
      <div className="px-6 py-6 space-y-10">
        <div className="space-y-2">
          <div className="h-11 w-full bg-[hsl(var(--color-surface-1))] animate-pulse" />
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-8 w-full bg-[hsl(var(--color-surface-1))] animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
