"use client";

import { createRoot } from "react-dom/client";
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

// ── Module-level store ──────────────────────────────

const store = {
  toasts: [] as ToastItem[],
  nextId: 0,
  listeners: new Set<(toasts: ToastItem[]) => void>(),
};

function emit() {
  store.listeners.forEach(l => l([...store.toasts]));
}

export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 5000
): string {
  const id = String(store.nextId++);
  store.toasts = [...store.toasts, { id, message, type }];
  emit();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id: string) {
  store.toasts = store.toasts.filter(t => t.id !== id);
  emit();
}

// ── Color map ─────────────────────────────────────

const COLOR = {
  success: { bg: "rgba(16,64,40,0.98)", border: "#10b981", text: "#d1fae5", icon: "✓" },
  error:   { bg: "rgba(64,16,16,0.98)", border: "#ef4444", text: "#fecaca",  icon: "✕" },
  info:    { bg: "rgba(20,50,120,0.98)", border: "#3b82f6", text: "#dbeafe",  icon: "ℹ" },
};

// ── ToastCard ─────────────────────────────────────

function ToastCard({ toast }: { toast: ToastItem }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const c = COLOR[toast.type] || COLOR.info;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 240,
        maxWidth: 420,
        padding: "14px 16px",
        borderRadius: 6,
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
        animation: visible ? "toastIn 0.25s cubic-bezier(0.22,1,0.36,1)" : "toastOut 0.2s ease-in forwards",
        opacity: visible ? 1 : 0,
        fontFamily: "ui-sans-serif,system-ui,-apple-system,sans-serif",
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <span style={{
        flexShrink: 0,
        width: 18, height: 18,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: "50%",
        background: `${c.border}33`,
        color: c.border,
        fontSize: 11, fontWeight: "bold",
        border: `1px solid ${c.border}55`,
      }}>
        {c.icon}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        style={{
          flexShrink: 0,
          width: 18, height: 18,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 3, background: "transparent",
          border: "none", cursor: "pointer",
          color: c.text, opacity: 0.5,
          fontSize: 16, padding: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Toast Root — uses its own React Root, completely independent ──

let reactRoot: ReturnType<typeof createRoot> | null = null;

function ensureRoot() {
  if (typeof document === "undefined") return;
  let el = document.getElementById("toast-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-root";
    document.body.appendChild(el);
  }
  if (!reactRoot) {
    reactRoot = createRoot(el);
  }
}

function ToastRoot() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    ensureRoot();
    const listener = (next: ToastItem[]) => setToasts(next);
    store.listeners.add(listener);
    listener([...store.toasts]); // sync current state
    return () => { store.listeners.delete(listener); };
  }, []);

  if (toasts.length === 0) return null;

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
      {toasts.map(t => <ToastCard key={t.id} toast={t} />)}
    </div>,
    document.body
  );
}

// ── Container export (renders inside provider) ──────

export function ToastContainer() {
  return <ToastRoot />;
}

// ── Keyframes ──────────────────────────────────────

if (typeof document !== "undefined") {
  const s = document.createElement("style");
  s.id = "toast-keyframes";
  s.textContent = `
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
    document.head.appendChild(s);
  }
}
