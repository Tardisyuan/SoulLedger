"use client";

export function PermissionDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
      <div className="text-6xl mb-4">🔒</div>
      <h1 className="text-2xl font-bold text-ink mb-2">权限不足</h1>
      <p className="text-ink-muted">
        您没有权限访问此页面或执行此操作。
      </p>
    </div>
  );
}
