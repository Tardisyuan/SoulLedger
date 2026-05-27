"use client";

import { useState, useEffect } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useUpdateSoul } from "@/src/hooks/useSouls";
import type { Soul } from "@/lib/api";
import { soulUpdateSchema } from "@/lib/validations/schemas";
import { useFormValidation } from "@/lib/validations/useFormValidation";

interface SoulEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  soul: Soul;
  onUpdated: () => void;
}

const STATE_OPTION_VALUES = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "LOST"] as const;

export function SoulEditModal({ isOpen, onClose, soul, onUpdated }: SoulEditModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const updateMutation = useUpdateSoul();
  const { validate, getError, clearFieldError } = useFormValidation(soulUpdateSchema);

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [currentState, setCurrentState] = useState<Soul["current_state"]>("ALIVE");

  // Populate form when soul changes or modal opens
  useEffect(() => {
    if (isOpen && soul) {
      setName(soul.name || "");
      setBirthDate(soul.birth_date ? soul.birth_date.split("T")[0] : "");
      setOriginLocation(soul.origin_location || "");
      setCurrentState(soul.current_state || "ALIVE");
    }
  }, [isOpen, soul]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const formData = {
      name: name.trim(),
      birth_date: birthDate || null,
      origin_location: originLocation || undefined,
      current_state: currentState,
    };

    const result = validate(formData);
    if (!result.success || !result.data) {
      return;
    }

    updateMutation.mutate(
      {
        id: soul.id,
        data: result.data,
      },
      {
        onSuccess: () => {
          showToast(t("souls.form.update_success"), "success");
          onUpdated();
          onClose();
        },
        onError: () => {
          showToast(t("souls.form.update_error"), "error");
        },
      }
    );
  }

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 rounded text-sm transition-colors"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        form="soul-edit-form"
        disabled={updateMutation.isPending || !name.trim()}
        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-[hsl(var(--color-surface-3))] disabled:text-[hsl(var(--color-ink-subtle))] rounded text-sm font-medium text-black transition-colors"
      >
        {updateMutation.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t("souls.form.updating")}
          </span>
        ) : t("common.save")}
      </button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("souls.form.edit_title") || "Edit Soul"}
      footer={footer}
    >
      <form id="soul-edit-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("souls.form.name_label")}</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              clearFieldError('name')
            }}
            disabled={updateMutation.isPending}
            className={`bg-[hsl(var(--color-surface-1))] border rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none disabled:opacity-50 transition-colors ${
              getError('name') ? 'border-red-500 focus:border-red-500' : 'border-[hsl(var(--color-hairline))] focus:border-[hsl(var(--color-accent))]'
            }`}
            placeholder={t("souls.form.name_placeholder")}
          />
          {getError('name') && (
            <span className="text-xs text-red-500">{getError('name')}</span>
          )}
        </div>

        {/* Birth Date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("souls.form.birth_date_label")}</label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          />
        </div>

        {/* Origin Location */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("souls.form.location_edit_label")}</label>
          <input
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.location_placeholder")}
          />
        </div>

        {/* Current State */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("souls.form.state_label")}</label>
          <select
            value={currentState}
            onChange={(e) => setCurrentState(e.target.value as Soul["current_state"])}
            disabled={updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          >
            {STATE_OPTION_VALUES.map((val) => (
              <option key={val} value={val}>
                {t(`souls.states.${val}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
    </BaseModal>
  );
}
