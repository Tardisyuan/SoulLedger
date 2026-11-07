"use client";

import { Skeleton } from "@/components/ui/skeleton";

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
 *
 * 曾经还有第二个理由:`PageSpinner` 当时写着 `min-h-screen`,而它渲染在
 * AppLayout 的 `min-h-[calc(100vh-4rem)]` 槽位里 —— 那正是 PageShell 文件头
 * 第 3 条点名的 64px 死滚动。**那条已经修好了**,`PageSpinner` 现在用的是槽位
 * 高度,`Spinner.test.tsx` 同时钉住正值与 `min-h-screen` 的缺席。所以留骨架屏
 * 的理由只剩上面第 1 条 —— 它本身就足够,但它是一条设计判断,不是一个缺陷的
 * 权宜之计,两者要求的后续动作不同。
 */
/*
 * 形状跟着 v4 的页面走(PageShell `variant="full"`):页头 = 标题(text-lg,行高 28)+ 副标题(text-sm,行高 20),
 * 下面一条分段签(矩阵 / 角色 / 权限定义,`--control-h-sm`),正文是矩阵那一块:工具行、表头、
 * 按 `--table-row-h` 的行 —— 和页面自己的 `!matrixReady` 骨架同高,加载完成不跳版。
 */
export default function Loading() {
  return (
    <div className="bg-[oklch(var(--color-canvas))]">
      <header className="border-b border-[oklch(var(--color-line))]">
        <div className="px-4 md:px-8 pt-8 pb-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-96 max-w-full mt-3" />
        </div>
      </header>
      <div className="border-b border-[oklch(var(--color-line))]">
        <div className="px-4 md:px-8 py-2">
          <Skeleton className="h-(--control-h-sm) w-72 max-w-full" />
        </div>
      </div>

      {/* variant="full":矩阵的列数随角色数增长,这里也不设 max-width。 */}
      <div className="px-4 md:px-8 py-6 space-y-4">
        <Skeleton className="h-(--control-h-sm) w-full max-w-md" />
        <div className="space-y-1">
          <Skeleton className="h-(--control-h-sm) w-full" />
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="h-(--table-row-h) w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
