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

// Theme-aware surface. The previous literals (rgba(16,64,40,.98) with #d1fae5
// text) were a dark card with pale text, which inverted badly under .light.
// `accent` is the status hue; the toast body stays on an opaque surface token
// so the floating card never shows the page through it.
const COLOR = {
  success: { accent: "var(--color-status-success)", icon: "✓" },
  error: { accent: "var(--color-status-error)", icon: "✕" },
  info: { accent: "var(--color-status-info)", icon: "ℹ" },
} as const;

let toasts: ToastItem[] = [];
let nextId = 0;

function getContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("toast-container");
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
    `border:1px solid hsl(${c.accent} / 0.4)`,
    `border-left:3px solid hsl(${c.accent})`,
    "background:hsl(var(--color-surface-2))",
    "color:hsl(var(--color-ink))",
    "animation:toastIn 0.25s cubic-bezier(0.22,1,0.36,1)",
    "pointer-events:auto",
    "font-family:ui-sans-serif,system-ui,-apple-system,sans-serif",
    "font-size:14px",
    "line-height:1.4",
  ].join(";");

  // Icon span
  const iconSpan = document.createElement("span");
  // 10%, not 20% — the same badge-fill AA floor as the className-based
  // badges elsewhere (a 16% tint of --bad measured 4.37:1, below AA).
  // Stays circular: this is an 18px icon indicator, not a text-bearing
  // pill, so radius-full's dot/avatar/count-bubble carve-out applies.
  iconSpan.style.cssText = `flex-shrink:0;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:hsl(${c.accent} / 0.1);color:hsl(${c.accent});font-size:11px;font-weight:bold;border:1px solid hsl(${c.accent} / 0.35);`;
  iconSpan.textContent = c.icon;

  // Message span — use textContent to prevent XSS
  const msgSpan = document.createElement("span");
  msgSpan.style.cssText = "flex:1;";
  msgSpan.textContent = item.message;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.id = `toast-close-${item.id}`;
  closeBtn.style.cssText = "flex-shrink:0;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:3px;background:transparent;border:none;cursor:pointer;color:hsl(var(--color-ink));opacity:0.5;font-size:16px;padding:0;line-height:1;";
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
