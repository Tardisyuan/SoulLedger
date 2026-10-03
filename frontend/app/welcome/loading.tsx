"use client";

/**
 * 骨架屏跟着 app/welcome/page.tsx 的 A9 版式:一块四格的统计面板,下面「接着做」400 宽与
 * 「最近活动」并排。静态(补足 C15「静态,不闪光」),没有 `min-h-screen`(AppLayout 的槽位
 * 已经给了高度,见 PageShell 文件头第 3 条)。圆角是 v3 的面板档。
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="bg-[oklch(var(--color-canvas))] px-4 py-6 md:p-6">
      <div className="flex flex-col gap-6">
        <div className="h-36 rounded-panel bg-[oklch(var(--color-surface-2))]" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="h-72 rounded-panel bg-[oklch(var(--color-surface-2))]" />
          <div className="h-72 rounded-panel bg-[oklch(var(--color-surface-2))]" />
        </div>
      </div>
    </div>
  );
}
