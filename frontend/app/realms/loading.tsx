"use client";

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <div className="relative w-16 h-16 mx-auto mb-4">
          <div className="absolute inset-0 border-4 border-amber-500/20 rounded-full" />
          <div className="absolute inset-0 border-4 border-transparent border-t-amber-500 rounded-full animate-spin" />
        </div>
        <p className="text-[hsl(var(--color-ink-muted))] animate-pulse">加载中...</p>
      </div>
    </div>
  );
}
