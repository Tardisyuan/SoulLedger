"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import type { Role } from "@/lib/api";

export function RoleFormModal({
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
  onSubmit: (data: { name: string; display_name: string }) => void;
  isPending: boolean;
  error: string | null;
  title: string;
  initialData?: Role;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(initialData?.name ?? "");
      setDisplayName(initialData?.display_name ?? "");
    }
  }, [isOpen, initialData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!displayName.trim()) return;
    onSubmit({ name: name.trim().toUpperCase(), display_name: displayName.trim() });
  }

  function handleClose() {
    setName("");
    setDisplayName("");
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
            disabled={isPending || !name.trim() || !displayName.trim()}
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
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.role_name_label")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.role_name_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.display_name_label")}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("permissions.display_name_placeholder")}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded text-[hsl(var(--color-ink))] text-sm focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
      </form>
    </BaseModal>
  );
}
