"use client";

import { createRoot, Root } from "react-dom/client";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

// ── Toast Store ─────────────────────────────────────

let toasts: ToastItem[] = [];
let nextId = 0;

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

function renderToasts() {
  const container = document.getElementById("toast-root");
  if (!container) return;
  const root = createRoot(container);
  root.render(
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const color = TOAST_COLORS[toast.type] || TOAST_COLORS.info;
  const icon = TOAST_ICONS[toast.type] || TOAST_ICONS.info;

  return (
    <div
      role="alert"
      id={`toast-${toast.id}`}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minWidth: "300px",
        maxWidth: "500px",
        padding: "12px 16px",
        borderRadius: "8px",
        border: `1px solid var(--toast-${toast.type}-border, #4ade80)`,
        backgroundColor: `var(--toast-${toast.type}-bg, rgba(6,78,59,0.95))`,
        color: `var(--toast-${toast.type}-text, #d1fae5)`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        animation: "toastIn 0.3s ease-out",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: "20px",
          height: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          fontSize: "12px",
          fontWeight: "bold",
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, fontSize: "14px" }}>{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        style={{
          flexShrink: 0,
          width: "20px",
          height: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          opacity: 0.6,
          color: "inherit",
          fontSize: "16px",
          padding: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        #toast-${toast.id} {
          --toast-success-border: #059669;
          --toast-success-bg: rgba(6,78,59,0.97);
          --toast-success-text: #d1fae5;
          --toast-error-border: #dc2626;
          --toast-error-bg: rgba(97,26,26,0.97);
          --toast-error-text: #fecaca;
          --toast-info-border: #2563eb;
          --toast-info-bg: rgba(29,50,139,0.97);
          --toast-info-text: #dbeafe;
        }
      `}</style>
    </div>
  );
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length === 0) {
    const container = document.getElementById("toast-root");
    if (container) container.innerHTML = "";
  } else {
    renderToasts();
  }
}

export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 5000
): string {
  // Ensure toast root element exists
  if (!document.getElementById("toast-root")) {
    const root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }

  const id = String(nextId++);
  toasts = [...toasts, { id, message, type }];
  renderToasts();

  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }

  return id;
}

export function dismissToast(id: string) {
  removeToast(id);
}

export function ToastContainer() {
  // Container is injected directly via showToast's document.body manipulation
  return null;
}
