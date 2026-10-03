"use client";

import { translate } from "@/lib/i18n/activeTranslator";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  timer: ReturnType<typeof setTimeout>;
}

// ── Pure DOM toast — no React state, no effects, no portals ──

// 规范 v3(2026-10-01):toast 是一块实心 ink 底、反白字;失败是实心冷玫红
// (`--color-danger`)底。颜色全部在 `app/globals.css` 的 `.toast` 块里,按
// `data-type` 选 —— 这里只给字形。图标跟着字色走,不再各带一种状态色:在实心 ink
// 底上,浅色主题的状态绿 / 蓝是深色字形压在近黑底上,读不出来。
const ICON: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

/**
 * Which live-region role a toast carries.
 *
 * `role="alert"` is ASSERTIVE — it interrupts whatever a screen reader is
 * reading. Every toast used to carry it, and 22 of the 76 `showToast` call
 * sites pass `"success"`: a save confirmation was cutting across the sentence
 * the operator was in the middle of.
 *
 * `status` for success and info, `alert` for error. An error is the one kind
 * that can be worth interrupting for — it says something did not happen.
 */
const ROLE: Record<ToastType, "alert" | "status"> = {
  success: "status",
  info: "status",
  error: "alert",
};

let toasts: ToastItem[] = [];
let nextId = 0;

function getContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    document.body.appendChild(el);
  }
  return el;
}

function buildToastEl(item: ToastItem): HTMLElement {
  const type: ToastType = item.type in ICON ? item.type : "info";
  const el = document.createElement("div");
  el.id = `toast-${item.id}`;
  el.setAttribute("role", ROLE[type]);
  el.className = "toast";
  // 底色由 `.toast[data-type="error"]` 选,不再往元素上写任何内联样式 —— v2 时
  // 唯一的内联是 `--toast-accent` 这个 token 名,v3 图标不再按状态着色,它也就没了。
  el.dataset.type = type;

  // Icon span
  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  // The glyph duplicates what the role already conveys, and a screen reader
  // reading "✓" before the message is noise.
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.textContent = ICON[type];

  // Message span — use textContent to prevent XSS
  const msgSpan = document.createElement("span");
  msgSpan.className = "toast-message";
  msgSpan.textContent = item.message;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.id = `toast-close-${item.id}`;
  closeBtn.className = "toast-close";
  // `type`, because a toast can be raised from inside a form and a default
  // `<button>` submits it. And an accessible name: this is a real tab stop
  // appended to `document.body`, and it announced as "× button".
  closeBtn.type = "button";
  // Through the same translator the notify port uses — see
  // `lib/i18n/activeTranslator.ts`. With no provider mounted it returns the
  // key, which is what `t` itself does for a key it cannot find; that is
  // reachable only in a server render (where nothing raises a toast) and in a
  // jest suite with no `I18nProvider`.
  closeBtn.setAttribute("aria-label", translate("common.close"));
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
    // A class, not three inline properties — the leaving transition is a
    // motion decision and belongs beside the arriving one. 200ms was a fourth
    // bare duration; `.toast-leaving` uses `dismiss` (140ms, 规范 v3) and
    // `ease-exit`. The 200 below only has to outlast it.
    el.classList.add("toast-leaving");
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
  // 默认停留 4 秒(规范 v3;v2 是 5 秒)。调用方显式传的时长照旧生效。
  duration: number = 4000
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

// The `@keyframes toastIn` that used to be injected here as a `<style>` node
// now lives in `app/globals.css` as `toast-in`, with the rest of this
// component's CSS. A stylesheet appended at import time is another way of
// being outside the token layer: nothing scans it, and its duration and easing
// were a bare `0.25s` and a third curve.

// ── Container component (renders nothing — toast is pure DOM) ──

export function ToastContainer() {
  return null;
}
