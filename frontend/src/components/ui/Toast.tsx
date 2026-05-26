"use client";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  timer: ReturnType<typeof setTimeout>;
}

// ── Pure DOM toast — no React state, no effects, no portals ──

const COLOR = {
  success: { bg: "rgba(16,64,40,0.98)", border: "hsl(142 76% 36%)", text: "#d1fae5", icon: "✓" },
  error:   { bg: "rgba(64,16,16,0.98)", border: "hsl(0 84% 60%)", text: "#fecaca",  icon: "✕" },
  info:    { bg: "rgba(20,50,120,0.98)", border: "hsl(217 91% 60%)", text: "#dbeafe",  icon: "ℹ" },
};

let toasts: ToastItem[] = [];
let nextId = 0;

function getContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("toast-container") as HTMLElement;
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    el.style.cssText = [
      "position:fixed",
      "top:20px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:99999",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "gap:10px",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(el);
  }
  return el;
}

function buildToastEl(item: ToastItem): HTMLElement {
  const c = COLOR[item.type] || COLOR.info;
  const el = document.createElement("div");
  el.id = `toast-${item.id}`;
  el.setAttribute("role", "alert");
  el.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:10px",
    "min-width:240px",
    "max-width:420px",
    "padding:14px 16px",
    "border-radius:6px",
    `border:1px solid ${c.border}`,
    `border-left:3px solid ${c.border}`,
    `background:${c.bg}`,
    `color:${c.text}`,
    "animation:toastIn 0.25s cubic-bezier(0.22,1,0.36,1)",
    "pointer-events:auto",
    "font-family:ui-sans-serif,system-ui,-apple-system,sans-serif",
    "font-size:14px",
    "line-height:1.4",
  ].join(";");

  // Icon span
  const iconSpan = document.createElement("span");
  iconSpan.style.cssText = `flex-shrink:0;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${c.border}33;color:${c.border};font-size:11px;font-weight:bold;border:1px solid ${c.border}55;`;
  iconSpan.textContent = c.icon;

  // Message span — use textContent to prevent XSS
  const msgSpan = document.createElement("span");
  msgSpan.style.cssText = "flex:1;";
  msgSpan.textContent = item.message;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.id = `toast-close-${item.id}`;
  closeBtn.style.cssText = "flex-shrink:0;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:3px;background:transparent;border:none;cursor:pointer;color:" + c.text + ";opacity:0.5;font-size:16px;padding:0;line-height:1;";
  closeBtn.textContent = "×";

  el.appendChild(iconSpan);
  el.appendChild(msgSpan);
  el.appendChild(closeBtn);

  el.querySelector(`#toast-close-${item.id}`)?.addEventListener("click", () => removeToast(item.id));

  return el;
}

function removeToast(id: string) {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx === -1) return;
  clearTimeout(toasts[idx].timer);
  toasts = toasts.filter(t => t.id !== id);

  const el = document.getElementById(`toast-${id}`);
  if (el) {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    el.style.transition = "all 0.2s ease-in";
    setTimeout(() => el.remove(), 200);
  }

  if (toasts.length === 0) {
    const container = document.getElementById("toast-container");
    if (container) container.remove();
  }
}

export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 5000
): string {
  if (typeof document === "undefined") return "";

  const id = String(nextId++);
  const timer = setTimeout(() => removeToast(id), duration);
  const item: ToastItem = { id, message, type, timer };
  toasts = [...toasts, item];

  const container = getContainer();
  if (!container) return "";
  const el = buildToastEl(item);
  container.appendChild(el);

  return id;
}

export function dismissToast(id: string) {
  removeToast(id);
}

// ── Inject keyframes once ─────────────────────────────

if (typeof document !== "undefined" && !document.getElementById("toast-keyframes")) {
  const s = document.createElement("style");
  s.id = "toast-keyframes";
  s.textContent = `
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(s);
}

// ── Container component (renders nothing — toast is pure DOM) ──

export function ToastContainer() {
  return null;
}
