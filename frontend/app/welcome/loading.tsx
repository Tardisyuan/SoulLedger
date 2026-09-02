"use client";

/**
 * 骨架屏跟着 app/welcome/page.tsx 一起迁移到 PageShell 的形状:
 * 一条 `border-b` 页头(标题 + 副标题两行)压在 `max-w-page` 的正文之上。
 *
 * 没有 `min-h-screen` —— AppLayout 给的槽位已经是 min-h-[calc(100vh-4rem)],
 * 再写一次就永远多出 64px 死滚动(见 PageShell 文件头第 3 条)。
 * 也没有 `rounded-*` —— borderRadius 表里除 full/focus 之外全部是 0,写了
 * 也不圆,只会让读代码的人以为这里是圆的。
 */
export default function Loading() {
  return (
    <div className="bg-[hsl(var(--color-canvas))]">
      <header className="border-b border-[hsl(var(--color-hairline))]">
        <div className="max-w-page mx-auto px-6 pt-10 pb-6">
          {/* h-10 对着 text-07 的 32px × 1.2 行高;h-6 对着 text-04 的副标题。 */}
          <div className="h-10 w-80 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          <div className="h-6 w-96 bg-[hsl(var(--color-surface-1))] animate-pulse mt-3" />
        </div>
      </header>

      <div className="max-w-page mx-auto px-6 py-6 space-y-6">
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          ))}
        </div>

        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-48 bg-[hsl(var(--color-surface-1))] animate-pulse" />
          <div className="h-48 bg-[hsl(var(--color-surface-1))] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
