"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { soulsApi } from "@/lib/api";
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
        className="fixed inset-0 bg-black/80 backdrop-blur-sm duration-200 ease-out data-closed:opacity-0"
      />

      {/* Centered panel */}
      <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
        <DialogPanel
          transition
          className="w-full max-w-md bg-surface-2 border border-hairline rounded-lg duration-200 ease-out data-closed:scale-95 data-closed:opacity-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
            <DialogTitle className="text-ink font-semibold text-base">{title}</DialogTitle>
            <button
              onClick={onClose}
              className="text-ink-subtle hover:text-ink transition-colors text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5">{children}</div>

          {/* Footer */}
          {footer && (
            <div className="px-6 pb-5 border-t border-hairline pt-4">
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

  const [name, setName] = useState("");
  const [civilization, setCivilization] = useState<"CHINESE" | "EUROPEAN" | "EGYPTIAN">("CHINESE");
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
        className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-3 disabled:opacity-50 rounded text-sm transition-colors"
      >
        {t("auth.cancel")}
      </button>
      <button
        type="submit"
        form="soul-create-form"
        disabled={loading || !name.trim()}
        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-surface-3 disabled:text-ink-subtle rounded text-sm font-medium text-black transition-colors"
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
          <label className="text-xs text-ink-subtle">{t("souls.form.name_label")}</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              clearFieldError('name')
            }}
            disabled={loading}
            className={`bg-surface-1 border rounded px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none disabled:opacity-50 transition-colors ${
              getError('name') ? 'border-red-500 focus:border-red-500' : 'border-hairline focus:border-amber-500'
            }`}
            placeholder={t("souls.form.name_placeholder")}
          />
          {getError('name') && (
            <span className="text-xs text-red-500">{getError('name')}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">{t("souls.form.civilization_label")}</label>
          <select
            value={civilization}
            onChange={(e) => {
              setCivilization(e.target.value as typeof civilization)
              clearFieldError('civilization')
            }}
            disabled={loading}
            className={`bg-surface-1 border rounded px-3 py-2 text-sm text-ink focus:outline-none disabled:opacity-50 transition-colors ${
              getError('civilization') ? 'border-red-500 focus:border-red-500' : 'border-hairline focus:border-amber-500'
            }`}
          >
            <option value="CHINESE">{t("souls.civilizations.CHINESE")}</option>
            <option value="EUROPEAN">{t("souls.civilizations.EUROPEAN")}</option>
            <option value="EGYPTIAN">{t("souls.civilizations.EGYPTIAN")}</option>
          </select>
          {getError('civilization') && (
            <span className="text-xs text-red-500">{getError('civilization')}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">{t("souls.form.birth_date_label")}</label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={loading}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">{t("souls.form.location_label")}</label>
          <input
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={loading}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.location_placeholder")}
          />
        </div>
      </form>
    </BaseModal>
  );
}
