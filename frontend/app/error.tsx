"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-red-500 mb-4">500</div>
        <h1 className="text-2xl font-bold text-ink mb-2">服务器错误</h1>
        <p className="text-[hsl(var(--color-ink-muted))] mb-6">抱歉，服务器遇到了问题</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg font-medium hover:opacity-90 transition-opacity mr-3"
        >
          重试
        </button>
        <a
          href="/"
          className="px-4 py-2 bg-[hsl(var(--color-surface-2))] text-ink rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          返回首页
        </a>
      </div>
    </div>
  );
}
