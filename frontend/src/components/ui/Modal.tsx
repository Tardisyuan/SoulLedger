"use client";

import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { soulsApi } from "@/lib/api";

// ── BaseModal ─────────────────────────────────────

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function BaseModal({ isOpen, onClose, title, children, footer }: BaseModalProps) {
  const { t } = useI18n();

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-[10000]">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>

        {/* Modal panel */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md bg-surface-2 border border-hairline rounded-xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
                  <Dialog.Title className="text-ink font-semibold text-base">{title}</Dialog.Title>
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
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ── SoulCreateModal ─────────────────────────────────

interface SoulCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function SoulCreateModal({ isOpen, onClose, onCreated }: SoulCreateModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [civilization, setCivilization] = useState("CHINESE");
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset on open
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
    if (!name.trim()) {
      showToast(t("souls.form.name_required") || "名称不能为空", "error");
      return;
    }
    setLoading(true);
    try {
      await soulsApi.create({
        name: name.trim(),
        civilization,
        birth_date: birthDate || null,
        origin_location: originLocation,
      });
      showToast(t("souls.form.create_success"), "success");
      onCreated();
      onClose();
    } catch {
      showToast(t("souls.form.create_error"), "error");
    } finally {
      setLoading(false);
    }
  }

  const civilizations = [
    { value: "CHINESE", label: t("souls.civilizations.CHINESE") },
    { value: "EUROPEAN", label: t("souls.civilizations.EUROPEAN") },
    { value: "EGYPTIAN", label: t("souls.civilizations.EGYPTIAN") },
  ];

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={loading}
        className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
      >
        {t("auth.cancel") || "取消"}
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
        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">{t("souls.form.name_label")}</label>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.name_placeholder")}
          />
        </div>

        {/* Civilization */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">{t("souls.form.civilization_label")}</label>
          <select
            value={civilization}
            onChange={(e) => setCivilization(e.target.value)}
            disabled={loading}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
          >
            {civilizations.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Birth Date */}
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

        {/* Origin Location */}
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
