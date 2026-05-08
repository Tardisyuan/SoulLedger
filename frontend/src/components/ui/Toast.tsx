"use client";

import React, { useEffect, useState } from "react";
import { useToast, Toast as ToastType } from "@/src/contexts/ToastContext";

// ── Color Map ───────────────────────────────────────

const TOAST_COLORS: Record<string, string> = {
  success: "border-emerald-600 bg-emerald-950/95 text-emerald-100",
  error: "border-red-600 bg-red-950/95 text-red-100",
  info: "border-blue-600 bg-blue-950/95 text-blue-100",
};

const TOAST_ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

// ── Single Toast Item (ElementUI Message style) ─────

function ToastItem({ toast }: { toast: ToastType }) {
  const { dismissToast } = useToast();
  const [visible, setVisible] = useState(false);

  // Enter animation on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => dismissToast(toast.id), 300);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, toast.id, dismissToast]);

  const colorClasses = TOAST_COLORS[toast.type] || TOAST_COLORS.info;
  const icon = TOAST_ICONS[toast.type] || TOAST_ICONS.info;

  return (
    <div
      role="alert"
      className={`
        pointer-events-auto flex items-center gap-3
        min-w-[300px] max-w-lg
        px-4 py-3 rounded-lg border shadow-2xl
        transition-all duration-300 ease-out
        ${colorClasses}
        ${visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-4"
        }
      `}
    >
      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/20 text-xs font-bold">
        {icon}
      </span>
      <span className="flex-1 text-sm">{toast.message}</span>
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => dismissToast(toast.id), 300);
        }}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-sm opacity-60 hover:opacity-100"
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
      className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
