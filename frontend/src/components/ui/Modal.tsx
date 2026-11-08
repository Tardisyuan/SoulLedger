"use client";

import { useRef } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

// ── BaseModal ─────────────────────────────────────

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * `false` keeps an outside click from closing the dialog (Escape and the
   * close button still do). For content that cannot be shown again — the
   * one-time password in `RevealCredentialDialog` — a stray click on the
   * backdrop would destroy it.
   *
   * Independent of this prop, a dialog whose body holds an editable text field
   * (input / textarea) also ignores outside clicks: a stray tap beside a
   * bottom sheet discarded typed text with no warning. Escape and the close
   * button still close it.
   */
  dismissOnOutsideClick?: boolean;
  /** 640 wide on sm+ instead of 440 (A11 缩短冷却详情); below sm it is the bottom sheet either way. */
  wide?: boolean;
  /** 880 wide on sm+ — a four-column preview table (第四十六批 补录出身地域 W-3). Wins over `wide`. */
  extraWide?: boolean;
  /** Replaces the title's `text-lg` (A11: 缩短冷却详情 uses `font-title text-xl`). */
  titleClassName?: string;
}

const NON_TEXT_INPUT = /^(checkbox|radio|button|submit|reset|hidden|file|image|range|color)$/;

/** True when `root` holds an enabled, writable text field (input / textarea). */
function hasEditableText(root: HTMLElement | null): boolean {
  if (!root) return false;
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).some(
    (el) => !el.disabled && !el.readOnly && !(el instanceof HTMLInputElement && NON_TEXT_INPUT.test(el.type)),
  );
}

/**
 * MIGRATED FROM @headlessui TO Base UI, and the anatomy is the visible part of
 * the change.
 *
 * `@headlessui` is in maintenance mode — Tailwind Labs still fixes bugs, but
 * the changelog carries no feature releases and there is an open "Next
 * release?" discussion. It has no command palette and no data-grid-adjacent
 * primitives, which is what a console like this reaches for next. Base UI 1.7
 * is the layer shadcn/ui itself switched its default to in July 2026, built by
 * the people who wrote Radix and Floating UI.
 *
 * WHAT DID NOT CHANGE, deliberately: the layout. `max-h` + `flex flex-col` +
 * a scrollable body is one mechanism with a measured reason (see the note
 * below), and swapping the primitive underneath is not an excuse to redesign
 * it. Same classes, same structure, different owner.
 *
 * WHAT DID: `<Dialog>` becomes the five-part anatomy
 * `Root / Portal / Backdrop / Viewport / Popup`, `onClose` becomes
 * `onOpenChange`, and the animation hooks move from headlessui's `transition`
 * prop to Base UI's `data-starting-style` / `data-ending-style` attributes.
 */
export function BaseModal({ isOpen, onClose, title, children, footer, dismissOnOutsideClick = true, wide = false, extraWide = false, titleClassName = "text-lg" }: BaseModalProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open={isOpen}
      disablePointerDismissal={!dismissOnOutsideClick}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details?.reason === "outside-press" && hasEditableText(bodyRef.current)) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Backdrop
          data-motion="fade"
          className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-opacity duration-base ease-enter data-ending-style:duration-close data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:opacity-0"
        />

      {/* Centered panel.
       *
       * `max-h` + `flex flex-col` + 可滚动的 body,三者是一套,缺一不可 ——
       * 而缺的后果只在小屏上出现,所以在桌面尺寸下看不出任何问题。
       *
       * 之前面板没有高度上限。内容一旦比视口高,`items-center` 会让它**上下对称
       * 溢出**:页脚连同提交按钮被挤到视口之外,而外层是 `fixed inset-0`,于是那个
       * 按钮既「可见、可用、可滚动到」,又点不动 —— Playwright 的报错原文是
       * `<div class="fixed inset-0 ...">intercepts pointer events`,在
       * mobile-chrome(375×812)上稳定复现,桌面两个引擎全绿。
       *
       * 用 `100dvh` 而不是 `100vh`:移动端浏览器的地址栏会吃掉 `vh` 算进去的那一段,
       * 差值恰好又是页脚的高度 —— 正是要保住的那一块。
       *
       * 外层加 `overflow-y-auto` 是兜底:若某天 body 内部出现不可压缩的元素,
       * 至少整个面板还能滚,而不是把内容藏到视口外。 */}
        <Dialog.Viewport className="fixed inset-0 z-dialog flex w-screen items-end justify-center overflow-y-auto sm:items-center sm:p-4">
          <Dialog.Popup
            data-motion="fade"
            className={`flex max-h-[calc(100dvh-2rem)] w-full ${extraWide ? "sm:max-w-[880px]" : wide ? "sm:max-w-[640px]" : "sm:max-w-[440px]"} flex-col rounded-panel shadow-overlay bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))] transition-[opacity,translate] duration-base ease-enter data-ending-style:duration-close data-ending-style:ease-exit data-ending-style:opacity-0 data-ending-style:translate-y-3 data-starting-style:opacity-0 data-starting-style:translate-y-3`}
          >
            {/* Header */}
            {/* 规范 v1 §3.3:标题 16/600,下接区块边界线;右上角写 Esc(键盘上真正关它的那个键)。 */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3 border-b border-[oklch(var(--color-block))]">
              <Dialog.Title className={`text-[oklch(var(--color-ink))] ${titleClassName}`}>{title}</Dialog.Title>
              <Dialog.Close
                className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))] border border-[oklch(var(--color-line))] px-1 py-0.5"
                aria-label={t("common.close")}
              >
                Esc
              </Dialog.Close>
            </div>

            {/* Body —— 唯一允许收缩与滚动的一段。header 与 footer 都是 `shrink-0`,
             * 因为「关闭」和「提交」在任何视口高度下都必须留在屏幕上。 */}
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="shrink-0 px-6 pb-4 border-t border-[oklch(var(--color-line))] pt-4">
                {footer}
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Modal alias ─────────────────────────────────────
export { BaseModal as Modal };

// ── ConfirmDialog ─────────────────────────────────────

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 可以带 `<span aria-hidden>✕</span>`:无名称的不可撤回删除(删帖、删评论、多选删敏感词)就这么用。 */
  confirmText?: React.ReactNode;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  /**
   * The confirm action is in flight.
   *
   * Added so the two hand-rolled confirmations in `app/recycle-bin` and
   * `app/disposition` could move onto this component without losing anything:
   * both showed a spinner on their confirm button, and a permanent hard delete
   * that gives no sign it started is a button people press twice.
   *
   * It disables BOTH buttons, not only the confirm one. Cancelling a request
   * that is already on its way does not unsend it — it only removes the dialog
   * that would otherwise report the outcome.
   */
  confirmLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  variant = "danger",
  confirmLoading = false,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  // Was three hand-rolled fills — `bg-red-500` / `bg-yellow-500` /
  // `bg-blue-500`, each with `text-white`. `bg-yellow-500` under white text is
  // about 1.9:1, which made the confirm step of a soul state transition the
  // least readable control in the app; none of the three followed the status
  // tokens, so all three stayed one colour while the theme changed around
  // them. `Button`'s own docstring already argued this exact case for the 15
  // danger buttons it replaced — this dialog was simply not among them.
  //
  // `info` is mapped rather than dropped: the prop still accepts it, and no
  // call site has ever passed it (only `danger`, the default, and one
  // `warning` in app/souls/[id]/page.tsx).
  //
  // 规范 v2 补足 A1:实底红「危险」按钮只出现在「输入名称以确认」的对话框里。这个对话框
  // 从不要求输入名称,所以 `danger`(也是默认值)画成次按钮 —— 后果写在标题和正文里,
  // 不写在按钮的颜色里。守卫:src/__tests__/dangerButtonPlacement.test.ts。
  const variantButton = {
    danger: "secondary",
    warning: "warning",
    info: "primary",
  } as const;

  /**
   * `AlertDialog`, not `Dialog`, and that is a behaviour change worth naming.
   *
   * An alert dialog does not dismiss on an outside click — the operator has to
   * answer it. Every call site here is a confirmation before something
   * consequential (delete a user, delete a soul, move a menu to the recycle
   * bin, transition a soul's state), and a stray click on the backdrop
   * silently choosing "cancel" is the friendlier half of the wrong pair: it
   * teaches that the dialog is dismissible, which is exactly the habit you do
   * not want at the moment the answer matters. Escape and the Cancel button
   * both still close it.
   *
   * `@headlessui` had no alert-dialog primitive, so this was a plain Dialog
   * with the outside-click behaviour it comes with. Base UI has one.
   */
  return (
    <AlertDialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop data-motion="fade"
          className="fixed inset-0 z-confirm bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-opacity duration-base ease-enter data-ending-style:duration-close data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:opacity-0" />
        {/* 与上面的 Modal 同一套约束,理由见那里。这个对话框的内容通常很短,
         * 但 `message` 是调用方传进来的任意文本 —— 「通常很短」不是约束。 */}
        <AlertDialog.Viewport className="fixed inset-0 z-confirm flex w-screen items-end justify-center overflow-y-auto sm:items-center sm:p-4">
          <AlertDialog.Popup data-motion="fade" className="flex max-h-[calc(100dvh-2rem)] w-full sm:max-w-[440px] flex-col rounded-panel shadow-overlay bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))] transition-[opacity,translate] duration-base ease-enter data-ending-style:duration-close data-ending-style:ease-exit data-ending-style:opacity-0 data-ending-style:translate-y-3 data-starting-style:opacity-0 data-starting-style:translate-y-3">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <AlertDialog.Title className="text-lg text-[oklch(var(--color-ink))] pb-2 mb-3 border-b border-[oklch(var(--color-block))]">
                {title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-[oklch(var(--color-ink-muted))]">
                {message}
              </AlertDialog.Description>
            </div>
            <div className="shrink-0 px-6 pb-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={confirmLoading}
              >
                {cancelText || t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant={variantButton[variant]}
                onClick={onConfirm}
                loading={confirmLoading}
              >
                {confirmText || t("common.confirm")}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
