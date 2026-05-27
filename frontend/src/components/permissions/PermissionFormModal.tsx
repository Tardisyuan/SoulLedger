"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import type { Permission } from "@/lib/api";

const CATEGORIES = ["soul", "judgment", "karma", "reincarnation", "system"];

export function PermissionFormModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
  title,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { codename: string; name: string; category: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Permission;
}) {
  const { t } = useI18n();
  const [codename, setCodename] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("soul");

  useEffect(() => {
    if (isOpen) {
      setCodename(initialData?.codename ?? "");
      setName(initialData?.name ?? "");
      setCategory(initialData?.category ?? "soul");
    }
  }, [isOpen, initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codename.trim()) return;
    if (!name.trim()) return;
    onSubmit({ codename: codename.trim(), name: name.trim(), category });
  }

  function handleClose() {
    setCodename("");
    setName("");
    setCategory("soul");
    onClose();
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !codename.trim() || !name.trim()}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 text-black rounded text-sm font-medium transition-colors"
          >
            {isPending ? t("permissions.submitting") : t("permissions.submit")}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.codename_label")}</label>
          <input
            type="text"
            value={codename}
            onChange={(e) => setCodename(e.target.value)}
            placeholder={t("permissions.codename_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.name_label")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.name_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.category_label")}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </form>
    </BaseModal>
  );
}
