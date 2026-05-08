"use client";

import React, { useEffect, useState } from "react";
import { useToast, Toast as ToastType } from "@/src/contexts/ToastContext";

// ── Color Map ───────────────────────────────────────

const TOAST_COLORS: Record<string, string> = {
  success: "border-green-600 bg-green-950/90 text-green-200",
  error: "border-red-600 bg-red-950/90 text-red-200",
  info: "border-blue-600 bg-blue-950/90 text-blue-200",
};

const TOAST_ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

// ── Single Toast Item ──────────────────────────────

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismissToast } = useToast();
  const [exiting, setExiting] = useState(false);

  // Trigger exit animation just before auto-dismiss
  useEffect(() => {
    if (toast.duration <= 0) return;
    const exitTimer = setTimeout(() => setExiting(true), toast.duration - 300);
    return () => clearTimeout(exitTimer);
  }, [toast.duration]);

  const colorClasses = TOAST_COLORS[toast.type] || TOAST_COLORS.info;
  const icon = TOAST_ICONS[toast.type] || TOAST_ICONS.info;

  return (
    <div
      role="alert"
      className={`
        pointer-events-auto flex items-center justify-center gap-3 w-full
        px-6 py-3 border-b shadow-lg
        transition-all duration-300 ease-in-out
        ${colorClasses}
        ${exiting ? "opacity-0 -translate-y-full" : "opacity-100 translate-y-0"}
      `}
    >
      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/20 text-xs font-bold">
        {icon}
      </span>
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        onClick={() => {
          setExiting(true);
          setTimeout(() => dismissToast(toast.id), 300);
        }}
        className="flex-shrink-0 ml-1 w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-sm"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Toast Container ─────────────────────────────────

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-0 left-0 right-0 z-[9999] flex flex-col"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
