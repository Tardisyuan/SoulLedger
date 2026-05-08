"use client";

import React, { useState, useEffect, useCallback } from "react";
import { soulsApi } from "@/lib/api";
import { useToast } from "@/src/contexts/ToastContext";
import { useI18n } from "@/src/contexts/I18nContext";

interface SoulCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function SoulCreateModal({
  isOpen,
  onClose,
  onCreated,
}: SoulCreateModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [civilization, setCivilization] = useState("CHINESE");
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [loading, setLoading] = useState(false);

  // ── ESC key close ───────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    },
    [onClose, loading],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // ── Prevent body scroll when open ───────────────
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [isOpen]);

  // ── Reset form on open ──────────────────────────
  useEffect(() => {
    if (isOpen) {
      setName("");
      setCivilization("CHINESE");
      setBirthDate("");
      setOriginLocation("");
    }
  }, [isOpen]);

  // ── Submit ──────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      showToast(t("souls.form.name_placeholder") + " *", "error");
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

  if (!isOpen) return null;

  const civilizations = [
    { value: "CHINESE", label: t("souls.civilizations.CHINESE") },
    { value: "EUROPEAN", label: t("souls.civilizations.EUROPEAN") },
    { value: "EGYPTIAN", label: t("souls.civilizations.EGYPTIAN") },
  ];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">{t("souls.create")}</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-white text-xl leading-none disabled:opacity-50 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">
              {t("souls.form.name_label")}
            </label>
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

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-sm text-slate-300 transition-colors"
            >
              {t("auth.cancel") || "Cancel"}
            </button>
            <button
              type="submit"
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
        </form>
      </div>
    </div>
  );
}
