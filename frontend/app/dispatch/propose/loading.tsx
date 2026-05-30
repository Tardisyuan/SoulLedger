"use client";

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <div className="relative w-16 h-16 mx-auto mb-4">
          <div className="absolute inset-0 border-4 border-[hsl(var(--color-accent))]/20 rounded-full" />
          <div className="absolute inset-0 border-4 border-transparent border-t-[hsl(var(--color-accent))] rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
}
