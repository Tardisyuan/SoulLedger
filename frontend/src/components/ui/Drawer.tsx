"use client";

import type { ReactNode, RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";

/**
 * 规范 v1 §2「抽屉 · 右侧 480 px · 不离开列表看详情」。
 *
 * The same Base UI `Dialog` the Modal is built on, so focus trapping, Escape,
 * scroll lock and focus return come from the primitive rather than from code
 * here. What this adds is the shape (a 480 px right panel, `shadow-overlay`,
 * block line under the header) and the J / K step between list rows.
 *
 * Focus return: Base UI returns focus to the element that had it on open. With
 * J / K the drawer is no longer showing the row that opened it, so callers pass
 * `finalFocus` to send focus back to the row the drawer is showing on close.
 */
interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Small mono hint at the header's right, e.g. "J / K 上下条 · Esc". */
  hint?: ReactNode;
  /** J — next row. Omitted (or undefined at the last row) means J does nothing. */
  onNext?: () => void;
  /** K — previous row. */
  onPrev?: () => void;
  /** Error bar under the header (spec: 错误时在抽屉头下出错误条). */
  error?: ReactNode;
  finalFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null);
  children: ReactNode;
}

/** J / K only when the keystroke is not text entry. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function Drawer({ isOpen, onClose, title, hint, onNext, onPrev, error, finalFocus, children }: DrawerProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          finalFocus={finalFocus}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
            const key = e.key.toLowerCase();
            if (key === "j" && onNext) { e.preventDefault(); onNext(); }
            else if (key === "k" && onPrev) { e.preventDefault(); onPrev(); }
          }}
          className="fixed inset-y-0 right-0 z-dialog flex w-full sm:w-[480px] flex-col bg-[oklch(var(--color-canvas))] border-l border-[oklch(var(--color-block))] shadow-overlay transition-transform duration-200 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full"
        >
          <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 py-3 border-b border-[oklch(var(--color-block))]">
            <Dialog.Title className="min-w-0 break-words text-md text-[oklch(var(--color-ink))]">{title}</Dialog.Title>
            <span className="flex items-baseline gap-3 shrink-0">
              {hint && <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{hint}</span>}
              <Dialog.Close
                className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))] border border-[oklch(var(--color-line))] px-1.5 py-0.5"
                aria-label="Close"
              >
                Esc
              </Dialog.Close>
            </span>
          </div>
          {error && (
            <div
              role="alert"
              className="shrink-0 px-4 py-2 text-sm bg-[oklch(var(--color-danger-tint))] text-[oklch(var(--color-danger))] border-b border-[oklch(var(--color-danger))]"
            >
              {error}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
