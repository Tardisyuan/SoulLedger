"use client";

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header skeleton */}
        <div className="h-32 bg-[hsl(var(--color-surface-1))] rounded-xl animate-pulse" />

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[hsl(var(--color-surface-1))] rounded-lg animate-pulse" />
          ))}
        </div>

        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-48 bg-[hsl(var(--color-surface-1))] rounded-lg animate-pulse" />
          <div className="h-48 bg-[hsl(var(--color-surface-1))] rounded-lg animate-pulse" />
        </div>
      </div>
    </div>
  );
}
