"use client";

import { useState, useEffect, useId } from "react";
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
  // Unique prefix so field/error ids never collide across multiple
  // RoleFormModal instances mounted at once.
  const formId = useId();
  const nameId = `${formId}-name`;
  const displayNameId = `${formId}-display-name`;
  const errorId = `${formId}-error`;
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
            className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-[hsl(var(--color-ink-muted))] hover:bg-surface-2 disabled:opacity-50 text-03 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || !displayName.trim()}
            className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 text-black text-03 font-medium transition-colors"
          >
            {isPending ? t("permissions.submitting") : t("permissions.submit")}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p id={errorId} role="alert" className="text-red-400 text-03">{error}</p>}
        <div>
          <label htmlFor={nameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.role_name_label")}</label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("permissions.role_name_placeholder")}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label htmlFor={displayNameId} className="block text-02 text-[hsl(var(--color-ink-muted))] mb-1">{t("permissions.display_name_label")}</label>
          <input
            id={displayNameId}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("permissions.display_name_placeholder")}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className="w-full px-3 py-2 bg-surface-2 border border-hairline text-[hsl(var(--color-ink))] text-03 focus:outline-hidden focus:border-[hsl(var(--color-accent))]"
          />
        </div>
      </form>
    </BaseModal>
  );
}
