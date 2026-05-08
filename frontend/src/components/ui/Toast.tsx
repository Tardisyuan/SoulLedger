"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

// ── Store ───────────────────────────────────────────

declare global {
  interface Window {
    __toastSetter?: ((fn: (prev: ToastItem[]) => ToastItem[]) => void) | undefined;
  }
}

let toasts: ToastItem[] = [];
let nextId = 0;

function notify() {
  // Set by ToastPortal on first client render — available immediately (not in useEffect)
  if (typeof window !== "undefined") {
    window.__toastSetter?.(prev => [...prev]);
  }
}

// ── Show / Dismiss ─────────────────────────────────

export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 5000
): string {
  const id = String(nextId++);
  toasts = [...toasts, { id, message, type }];
  notify();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter(t => t.id !== id);
  notify();
}

// ── Color Map ──────────────────────────────────────

const COLOR_MAP = {
  success: { bg: "rgba(16,64,40,0.98)", border: "#10b981", text: "#d1fae5", icon: "✓" },
  error:   { bg: "rgba(64,16,16,0.98)", border: "#ef4444", text: "#fecaca",  icon: "✕" },
  info:    { bg: "rgba(20,50,120,0.98)", border: "#3b82f6", text: "#dbeafe",  icon: "ℹ" },
};

// ── ToastCard ──────────────────────────────────────

function ToastCard({ toast }: { toast: ToastItem }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const c = COLOR_MAP[toast.type] || COLOR_MAP.info;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: "240px",
        maxWidth: "420px",
        padding: "14px 16px",
        borderRadius: "6px",
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
        animation: visible ? "toastIn 0.25s cubic-bezier(0.22,1,0.36,1)" : "toastOut 0.2s ease-in forwards",
        fontFamily: "ui-sans-serif,system-ui,-apple-system,sans-serif",
        opacity: visible ? 1 : 0,
      }}
    >
      <span style={{
        flexShrink: 0, width: 18, height: 18,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: "50%",
        background: `${c.border}33`,
        color: c.border,
        fontSize: 11, fontWeight: "bold",
        border: `1px solid ${c.border}55`,
      }}>
        {c.icon}
      </span>
      <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        style={{
          flexShrink: 0, width: 18, height: 18,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 3, background: "transparent",
          border: "none", cursor: "pointer",
          color: c.text, opacity: 0.5, fontSize: 16,
          padding: 0, lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Portal Container ────────────────────────────────

function ToastPortal() {
  const [toastList, setToasts] = useState<ToastItem[]>([]);
  // Expose setter globally — available on FIRST render, not after useEffect
  if (typeof window !== "undefined") {
    window.__toastSetter = setToasts;
  }
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__toastSetter = setToasts;
    }
    return () => { if (typeof window !== "undefined") window.__toastSetter = undefined; };
  }, []);

  if (toastList.length === 0 && toasts.length === 0) return null;

  // Sync module store to React state on mount
  useEffect(() => {
    if (toasts.length > 0) setToasts(toasts);
  }, []);

  const displayList = toastList.length > 0 ? toastList : toasts;
  if (displayList.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      {displayList.map(toast => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}

// ── Inject keyframes ───────────────────────────────

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes toastOut {
      from { opacity: 1; transform: translateY(0); }
      to   { opacity: 0; transform: translateY(-6px); }
    }
  `;
  if (!document.getElementById("toast-keyframes")) {
    style.id = "toast-keyframes";
    document.head.appendChild(style);
  }
}

export { ToastPortal as ToastContainer };
