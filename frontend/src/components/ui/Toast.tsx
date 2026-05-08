"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

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

// ── Store (module-level, shared across re-renders) ──

let toasts: ToastItem[] = [];
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach((fn) => fn());
}

export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 5000
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toasts = [...toasts, { id, message, type, duration }];
  notify();
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function useToasts(): ToastItem[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);
  return toasts;
}

// ── Portal component ───────────────────────────────

function ToastCard({ toast }: { toast: ToastItem }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => dismissToast(toast.id), 300);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);

  const color = TOAST_COLORS[toast.type] || TOAST_COLORS.info;
  const icon = TOAST_ICONS[toast.type] || TOAST_ICONS.info;

  return (
    <div
      role="alert"
      className={`
        pointer-events-auto flex items-center gap-3
        min-w-[300px] max-w-lg
        px-4 py-3 rounded-lg border shadow-2xl
        transition-all duration-300 ease-out
        ${color}
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

export function ToastContainer() {
  const items = useToasts();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || items.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="fixed top-5 left-1/2 -translate-x-1/2 z-[99999] flex flex-col items-center gap-2"
    >
      {items.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}
