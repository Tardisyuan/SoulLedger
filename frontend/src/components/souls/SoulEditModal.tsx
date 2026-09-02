"use client";

import { useState, useEffect, useId } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useUpdateSoul } from "@/src/hooks/useSouls";
import type { Soul } from "@/lib/api";
import { soulUpdateSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";
import { type HistoricalDate } from "@/lib/utils";

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

  // Unique prefix so field/error ids never collide across multiple
  // SoulEditModal instances mounted at once.
  const formId = useId();
  const nameId = `${formId}-name`;
  const nameErrorId = `${formId}-name-error`;
  const birthDateId = `${formId}-birth-date`;
  const locationId = `${formId}-location`;
  const stateId = `${formId}-state`;

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [currentState, setCurrentState] = useState<Soul["current_state"]>("ALIVE");

  // SETTLED is terminal — nothing transitions out of it, not even LOST — so
  // an operator must not be able to pick it manually. The control is
  // disabled rather than removed: `currentState` still holds "SETTLED" and
  // round-trips on submit instead of silently reverting to the default.
  const isSettled = soul.current_state === "SETTLED";

  // Convert HistoricalDate to HTML date input format (YYYY-MM-DD)
  const historicalDateToInputValue = (date: HistoricalDate | null | undefined): string => {
    if (!date || !date.month || !date.day) return "";
    const year = Math.abs(date.year).toString().padStart(4, "0");
    const month = date.month.toString().padStart(2, "0");
    const day = date.day.toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Populate form when soul changes or modal opens
  useEffect(() => {
    if (isOpen && soul) {
      setName(soul.name || "");
      setBirthDate(historicalDateToInputValue(soul.birth_date));
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
        // No toasts here. `useUpdateSoul` already toasts on both outcomes, so
        // every soul edit raised TWO banners — `souls.form.update_success`
        // from this callback and the hook's own, which are the same sentence.
        // The callbacks stay: closing the modal is this component's job, not
        // the hook's.
        onSuccess: () => {
          onUpdated();
          onClose();
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
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 text-04 transition-colors"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        form="soul-edit-form"
        disabled={updateMutation.isPending || !name.trim()}
        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-[hsl(var(--color-surface-3))] disabled:text-[hsl(var(--color-ink-subtle))] text-04 font-medium text-black transition-colors"
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
          <label htmlFor={nameId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("souls.form.name_label")}</label>
          <input
            id={nameId}
            type="text"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              clearFieldError('name')
            }}
            disabled={updateMutation.isPending}
            aria-invalid={!!getError('name')}
            aria-describedby={getError('name') ? nameErrorId : undefined}
            className={`bg-[hsl(var(--color-surface-1))] border px-3 py-2 text-04 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden disabled:opacity-50 transition-colors ${
              getError('name') ? 'border-red-500 focus:border-red-500' : 'border-[hsl(var(--color-hairline))] focus:border-[hsl(var(--color-accent))]'
            }`}
            placeholder={t("souls.form.name_placeholder")}
          />
          {getError('name') && (
            <span id={nameErrorId} role="alert" className="text-02 text-red-500">{getError('name')}</span>
          )}
        </div>

        {/* Birth Date */}
        <div className="flex flex-col gap-1">
          <label htmlFor={birthDateId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("souls.form.birth_date_label")}</label>
          <input
            id={birthDateId}
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-04 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          />
        </div>

        {/* Origin Location */}
        <div className="flex flex-col gap-1">
          <label htmlFor={locationId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("souls.form.location_edit_label")}</label>
          <input
            id={locationId}
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-04 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder={t("souls.form.location_placeholder")}
          />
        </div>

        {/* Current State */}
        <div className="flex flex-col gap-1">
          <label htmlFor={stateId} className="text-02 text-[hsl(var(--color-ink-subtle))]">{t("souls.form.state_label")}</label>
          <select
            id={stateId}
            value={currentState}
            onChange={(e) => setCurrentState(e.target.value as Soul["current_state"])}
            disabled={updateMutation.isPending || isSettled}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-04 text-[hsl(var(--color-ink))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
          >
            {isSettled ? (
              <option value="SETTLED">{t("souls.states.SETTLED")}</option>
            ) : (
              STATE_OPTION_VALUES.map((val) => (
                <option key={val} value={val}>
                  {t(`souls.states.${val}`)}
                </option>
              ))
            )}
          </select>
        </div>
      </form>
    </BaseModal>
  );
}
