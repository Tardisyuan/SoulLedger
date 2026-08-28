"use client";

import { useEffect, useId, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { soulsApi } from "@/lib/api";
import {
  CIVILIZATION_OPTIONS,
  type CivilizationOption,
} from "@/src/config/civilizations";
import { soulCreateSchema } from "@/lib/validations/schemas";
import { useFormValidation } from "@/lib/validations/useFormValidation";

// ── BaseModal ─────────────────────────────────────

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function BaseModal({ isOpen, onClose, title, children, footer }: BaseModalProps) {
  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[9999]">
      {/* Backdrop */}
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 backdrop-blur-sm duration-200 ease-out data-closed:opacity-0 dark:bg-black/80"
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
      <div className="fixed inset-0 flex w-screen items-center justify-center overflow-y-auto p-4">
        <DialogPanel
          transition
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg duration-200 ease-out data-closed:scale-95 data-closed:opacity-0"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-[hsl(var(--color-hairline))]">
            <DialogTitle className="text-[hsl(var(--color-ink))] text-06">{title}</DialogTitle>
            <button
              onClick={onClose}
              className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-ink))] transition-colors text-06 leading-none"
              aria-label="Close"
            >
              ×
            </button>
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
        </DialogPanel>
      </div>
    </Dialog>
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
      await soulsApi.create(result.data);
      showToast(t("souls.form.create_success"), "success");
      onCreated();
      onClose();
    } catch {
      showToast(t("souls.form.create_error"), "error");
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
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] disabled:opacity-50 rounded text-03 transition-colors"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        form="soul-create-form"
        disabled={loading || !name.trim()}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] disabled:bg-[hsl(var(--color-surface-3))] disabled:text-[hsl(var(--color-ink-subtle))] rounded text-03 font-medium text-black transition-colors"
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
            className={`bg-[hsl(var(--color-surface-1))] border rounded px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none disabled:opacity-50 transition-colors ${
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
            className={`bg-[hsl(var(--color-surface-1))] border rounded px-3 py-2 text-03 text-[hsl(var(--color-ink))] focus:outline-none disabled:opacity-50 transition-colors ${
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
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-03 text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
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
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
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
}: ConfirmDialogProps) {
  const { t } = useI18n();

  const variantColors = {
    danger: "bg-red-500 hover:bg-red-600",
    warning: "bg-yellow-500 hover:bg-yellow-600",
    info: "bg-blue-500 hover:bg-blue-600",
  };

  return (
    <Dialog open={isOpen} onClose={onCancel} className="relative z-[9999]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 backdrop-blur-sm duration-200 ease-out data-closed:opacity-0 dark:bg-black/80"
      />
      {/* 与上面的 Modal 同一套约束,理由见那里。这个对话框的内容通常很短,
       * 但 `message` 是调用方传进来的任意文本 —— 「通常很短」不是约束。 */}
      <div className="fixed inset-0 flex w-screen items-center justify-center overflow-y-auto p-4">
        <DialogPanel
          transition
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg duration-200 ease-out data-closed:scale-95 data-closed:opacity-0"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <h3 className="text-06 text-[hsl(var(--color-ink))] mb-2">{title}</h3>
            <p className="text-04 text-[hsl(var(--color-ink-muted))]">{message}</p>
          </div>
          <div className="shrink-0 px-6 pb-5 flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] rounded text-03 transition-colors"
            >
              {cancelText || t("common.cancel")}
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 px-4 py-2 text-white rounded text-03 font-medium transition-colors ${variantColors[variant]}`}
            >
              {confirmText || t("common.confirm")}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
