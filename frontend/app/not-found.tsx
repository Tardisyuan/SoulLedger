"use client";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-amber-500 mb-4">404</div>
        <h1 className="text-2xl font-bold text-ink mb-2">页面未找到</h1>
        <p className="text-[hsl(var(--color-ink-muted))] mb-6">抱歉，您访问的页面不存在</p>
        <a
          href="/"
          className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          返回首页
        </a>
      </div>
    </div>
  );
}
