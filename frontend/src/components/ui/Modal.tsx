"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { soulsApi } from "@/lib/api";

// ── BaseModal ───────────────────────────────────────

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function BaseModal({ isOpen, onClose, title, children, footer }: BaseModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative w-full max-w-md mx-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 pb-5">{footer}</div>
        )}
      </div>
    </div>,
    document.body
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
        className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-sm text-slate-300 transition-colors"
      >
        {t("auth.cancel") || "取消"}
      </button>
      <button
        type="submit"
        form="soul-create-form"
        disabled={loading || !name.trim()}
        className="flex-1 px-4 py-2 bg-amber-700 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-500 rounded text-sm font-medium text-white transition-colors"
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
          <label className="text-xs text-slate-400">{t("souls.form.name_label")}</label>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.name_placeholder")}
          />
        </div>

        {/* Civilization */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">{t("souls.form.civilization_label")}</label>
          <select
            value={civilization}
            onChange={(e) => setCivilization(e.target.value)}
            disabled={loading}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
          >
            {civilizations.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Birth Date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">{t("souls.form.birth_date_label")}</label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={loading}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
          />
        </div>

        {/* Origin Location */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400">{t("souls.form.location_label")}</label>
          <input
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={loading}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.location_placeholder")}
          />
        </div>
      </form>
    </BaseModal>
  );
}
