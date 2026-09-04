"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useCreateSoul } from "@soulledger/core/hooks/useSouls";
import { Button } from "@/src/components/ui/Button";
import {
  CIVILIZATION_OPTIONS,
  type CivilizationOption,
} from "@soulledger/core/config/civilizations";
import { soulCreateSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";

// ── BaseModal ─────────────────────────────────────

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
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
export function BaseModal({ isOpen, onClose, title, children, footer }: BaseModalProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Backdrop
          className="fixed inset-0 z-dialog bg-black/60 backdrop-blur-xs transition-opacity duration-settle ease-enter data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/80"
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
        <Dialog.Viewport className="fixed inset-0 z-dialog flex w-screen items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] transition duration-settle ease-enter data-ending-style:ease-exit data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-[hsl(var(--color-hairline))]">
              <Dialog.Title className="text-[hsl(var(--color-ink))] text-06">{title}</Dialog.Title>
              <Dialog.Close
                className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-ink))] transition-colors text-06 leading-none"
                aria-label="Close"
              >
                ×
              </Dialog.Close>
            </div>

            {/* Body —— 唯一允许收缩与滚动的一段。header 与 footer 都是 `shrink-0`,
             * 因为「关闭」和「提交」在任何视口高度下都必须留在屏幕上。 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="shrink-0 px-6 pb-5 border-t border-[hsl(var(--color-hairline))] pt-4">
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

// ── SoulCreateModal ─────────────────────────────────

interface SoulCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function SoulCreateModal({ isOpen, onClose, onCreated }: SoulCreateModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { validate, getError, clearFieldError } = useFormValidation(soulCreateSchema);
  // `useCreateSoul`, not `soulsApi.create`. This called the API client
  // directly, so **nothing invalidated the souls cache on create**: the list
  // only appeared to update because `onCreated` calls `refetch()` on the
  // calling page's exact query, leaving every other cached souls list — every
  // other filter, sort and page — stale for its full 30s staleTime. The page
  // even declared `useCreateSoul()` and never used it.
  const createSoul = useCreateSoul();

  // Unique prefix so field/error ids never collide across multiple Modal
  // instances mounted at once (e.g. list + create modal on the same page).
  const formId = useId();
  const nameId = `${formId}-name`;
  const nameErrorId = `${formId}-name-error`;
  const civilizationId = `${formId}-civilization`;
  const civilizationErrorId = `${formId}-civilization-error`;
  const birthDateId = `${formId}-birth-date`;
  const locationId = `${formId}-location`;

  const [name, setName] = useState("");
  const [civilization, setCivilization] = useState<CivilizationOption>("CHINESE");
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setCivilization("CHINESE");
      setBirthDate("");
      setOriginLocation("");
    }
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const formData = {
      name: name.trim(),
      civilization,
      birth_date: birthDate || null,
      origin_location: originLocation || null,
    };

    const result = validate(formData);
    if (!result.success) {
      return;
    }

    setLoading(true);
    try {
      if (!result.data) {
        showToast(t("souls.form.create_error"), "error");
        setLoading(false);
        return
      }
      // No toast here: `useCreateSoul` owns both the success and failure
      // message. Toasting again would show two identical banners for one
      // create, which is what the edit path did until this commit.
      await createSoul.mutateAsync(result.data);
      onCreated();
      onClose();
    } catch {
      // Swallowed deliberately — the hook's onError has already told the user.
      // Rethrowing or toasting here is the double-report; leaving the modal
      // open is the recovery.
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={loading}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] disabled:opacity-50 text-03 transition-colors"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        form="soul-create-form"
        disabled={loading || !name.trim()}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:bg-[hsl(var(--color-surface-3))] disabled:text-[hsl(var(--color-ink-subtle))] text-03 font-medium text-black transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t("souls.form.submitting")}
          </span>
        ) : t("souls.form.submit")}
      </button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("souls.create")}
      footer={footer}
    >
      <form id="soul-create-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("souls.form.name_label")}</label>
          <input
            id={nameId}
            type="text"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              clearFieldError('name')
            }}
            disabled={loading}
            aria-invalid={!!getError('name')}
            aria-describedby={getError('name') ? nameErrorId : undefined}
            className={`bg-[hsl(var(--color-surface-1))] border px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden disabled:opacity-50 transition-colors ${
              getError('name') ? 'border-red-500 focus:border-red-500' : 'border-[hsl(var(--color-hairline))] focus:border-[hsl(var(--color-accent))]'
            }`}
            placeholder={t("souls.form.name_placeholder")}
          />
          {getError('name') && (
            <span id={nameErrorId} role="alert" className="text-02 text-red-500">{getError('name')}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={civilizationId} className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("souls.form.civilization_label")}</label>
          <select
            id={civilizationId}
            value={civilization}
            onChange={(e) => {
              setCivilization(e.target.value as typeof civilization)
              clearFieldError('civilization')
            }}
            disabled={loading}
            aria-invalid={!!getError('civilization')}
            aria-describedby={getError('civilization') ? civilizationErrorId : undefined}
            className={`bg-[hsl(var(--color-surface-1))] border px-3 py-2 text-03 text-[hsl(var(--color-ink))] focus:outline-hidden disabled:opacity-50 transition-colors ${
              getError('civilization') ? 'border-red-500 focus:border-red-500' : 'border-[hsl(var(--color-hairline))] focus:border-[hsl(var(--color-accent))]'
            }`}
          >
            {CIVILIZATION_OPTIONS.map((civ) => (
              <option key={civ} value={civ}>
                {t(`souls.civilizations.${civ}`)}
              </option>
            ))}
          </select>
          {getError('civilization') && (
            <span id={civilizationErrorId} role="alert" className="text-02 text-red-500">{getError('civilization')}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={birthDateId} className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("souls.form.birth_date_label")}</label>
          <input
            id={birthDateId}
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={loading}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={locationId} className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("souls.form.location_label")}</label>
          <input
            id={locationId}
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={loading}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.location_placeholder")}
          />
        </div>
      </form>
    </BaseModal>
  );
}

// ── ConfirmDialog ─────────────────────────────────────

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
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
  const variantButton = {
    danger: "danger",
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
        <AlertDialog.Backdrop className="fixed inset-0 z-dialog bg-black/60 backdrop-blur-xs transition-opacity duration-settle ease-enter data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/80" />
        {/* 与上面的 Modal 同一套约束,理由见那里。这个对话框的内容通常很短,
         * 但 `message` 是调用方传进来的任意文本 —— 「通常很短」不是约束。 */}
        <AlertDialog.Viewport className="fixed inset-0 z-dialog flex w-screen items-center justify-center overflow-y-auto p-4">
          <AlertDialog.Popup className="flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] transition duration-settle ease-enter data-ending-style:ease-exit data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <AlertDialog.Title className="text-06 text-[hsl(var(--color-ink))] mb-2">
                {title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-04 text-[hsl(var(--color-ink-muted))]">
                {message}
              </AlertDialog.Description>
            </div>
            <div className="shrink-0 px-6 pb-5 flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={confirmLoading}
                className="flex-1"
              >
                {cancelText || t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant={variantButton[variant]}
                onClick={onConfirm}
                loading={confirmLoading}
                className="flex-1"
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
