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
        gap: "10px",
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
  const colorMap = {
    success: {
      bg: "rgba(16, 64, 40, 0.98)",
      border: "#10b981",
      text: "#d1fae5",
      icon: "✓",
    },
    error: {
      bg: "rgba(64, 16, 16, 0.98)",
      border: "#ef4444",
      text: "#fecaca",
      icon: "✕",
    },
    info: {
      bg: "rgba(20, 50, 120, 0.98)",
      border: "#3b82f6",
      text: "#dbeafe",
      icon: "ℹ",
    },
  };
  const c = colorMap[toast.type] || colorMap.info;

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
        boxShadow: "0 4px 20px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2)",
        animation: "toastIn 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
        pointerEvents: "auto",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Icon */}
      <span
        style={{
          flexShrink: 0,
          width: "18px",
          height: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          background: `${c.border}33`,
          color: c.border,
          fontSize: "11px",
          fontWeight: "bold",
          border: `1px solid ${c.border}55`,
        }}
      >
        {c.icon}
      </span>
      {/* Message */}
      <span style={{ flex: 1, fontSize: "14px", lineHeight: 1.4 }}>{toast.message}</span>
      {/* Dismiss */}
      <button
        onClick={() => removeToast(toast.id)}
        style={{
          flexShrink: 0,
          width: "18px",
          height: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "3px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: c.text,
          opacity: 0.5,
          fontSize: "16px",
          padding: 0,
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  const container = document.getElementById("toast-root");
  if (!container) return;
  if (toasts.length === 0) {
    container.innerHTML = "";
  } else {
    renderToasts();
  }
}

export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 5000
): string {
  // Ensure root element exists
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

// Inject keyframes once
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  if (!document.getElementById("toast-keyframes")) {
    style.id = "toast-keyframes";
    document.head.appendChild(style);
  }
}
