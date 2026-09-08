"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useCreateSoul } from "@soulledger/core/hooks/useSouls";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
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
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col bg-[oklch(var(--color-surface-2))] border border-[oklch(var(--color-hairline))] transition duration-settle ease-enter data-ending-style:ease-exit data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-[oklch(var(--color-hairline))]">
              <Dialog.Title className="text-[oklch(var(--color-ink))] text-06">{title}</Dialog.Title>
              <Dialog.Close
                className="text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))] transition-colors text-06 leading-none"
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
              <div className="shrink-0 px-6 pb-5 border-t border-[oklch(var(--color-hairline))] pt-4">
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
  //
  // The two `-error` ids that used to sit beside these are gone, not lost:
  // `Field` derives `${controlId}-error` itself and points `aria-describedby`
  // at it, so the ids that reach the DOM are byte-for-byte the ones this file
  // used to spell out. A second copy here would be a value nothing re-derives.
  const formId = useId();
  const nameId = `${formId}-name`;
  const civilizationId = `${formId}-civilization`;
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

  /**
   * `Button`, not two more spellings of it.
   *
   * The submit button was one of ~15 sites that re-typed `Button`'s primary
   * recipe by hand, and the copies had already drifted apart: `px-4 py-2`
   * against the primitive's `px-3 py-2`, and `disabled:bg-surface-3
   * disabled:text-ink-subtle` against its `disabled:opacity-50
   * disabled:pointer-events-none`. Neither difference was ever a decision —
   * `ConfirmDialog` at the bottom of this same file had already moved.
   *
   * `loading` replaces the hand-rolled `<svg className="animate-spin">`:
   * `Button` renders an unlabelled `<Spinner size="sm">` and sets `aria-busy`,
   * which the inline SVG never did. It also disables the control, which is why
   * `disabled` no longer repeats `loading ||`.
   */
  const footer = (
    <div className="flex gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={loading}
        className="flex-1"
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        form="soul-create-form"
        variant="primary"
        loading={loading}
        disabled={!name.trim()}
        className="flex-1"
      >
        {loading ? t("souls.form.submitting") : t("souls.form.submit")}
      </Button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("souls.create")}
      footer={footer}
    >
      {/* `TextField` / `SelectField`, not four hand-wired label+control+error
          triples. `Field.tsx:22-28` names *these two controls* as the reason it
          exists: they were the only two form controls in the whole application
          that rendered a field-level error at all, and both painted it with the
          `red-500` palette literal rather than `--color-status-error` — which is
          re-measured per theme (`0 84% 62%` dark, `0 78% 44%` light, the light
          one darker specifically so error text clears AA on a light canvas).
          `red-500` follows neither, so light mode got the dark-mode reading. The
          primitive was written for this file and this file had never imported
          it. The `focus:` → `focus-visible:` switch comes with it, for the
          reason `Field.tsx:32-44` records: a mouse click into a text input still
          matches `:focus-visible`, a mouse click on a `<select>` stops matching
          — and the select is where the repainted border was noise. */}
      <form id="soul-create-form" onSubmit={handleSubmit} className="space-y-4">
        <TextField
          id={nameId}
          label={t("souls.form.name_label")}
          type="text"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            clearFieldError('name')
          }}
          disabled={loading}
          error={getError('name')}
          placeholder={t("souls.form.name_placeholder")}
        />
        <SelectField
          id={civilizationId}
          label={t("souls.form.civilization_label")}
          value={civilization}
          onChange={(e) => {
            setCivilization(e.target.value as typeof civilization)
            clearFieldError('civilization')
          }}
          disabled={loading}
          error={getError('civilization')}
          options={CIVILIZATION_OPTIONS.map((civ) => ({
            value: civ,
            label: t(`souls.civilizations.${civ}`),
          }))}
        />
        <TextField
          id={birthDateId}
          label={t("souls.form.birth_date_label")}
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          disabled={loading}
        />
        <TextField
          id={locationId}
          label={t("souls.form.location_label")}
          type="text"
          value={originLocation}
          onChange={(e) => setOriginLocation(e.target.value)}
          disabled={loading}
          placeholder={t("souls.form.location_placeholder")}
        />
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
          <AlertDialog.Popup className="flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col bg-[oklch(var(--color-surface-2))] border border-[oklch(var(--color-hairline))] transition duration-settle ease-enter data-ending-style:ease-exit data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <AlertDialog.Title className="text-06 text-[oklch(var(--color-ink))] mb-2">
                {title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-04 text-[oklch(var(--color-ink-muted))]">
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
