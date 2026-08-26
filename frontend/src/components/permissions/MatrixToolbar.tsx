"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/** Filter box, differences-only toggle, pending count and the save button. */
export function MatrixToolbar({
  filterText,
  onFilterTextChange,
  onlyDifferences,
  onOnlyDifferencesChange,
  pendingCount,
  onSave,
  saveDisabled,
  isSaving,
}: {
  filterText: string;
  onFilterTextChange: (value: string) => void;
  onlyDifferences: boolean;
  onOnlyDifferencesChange: (value: boolean) => void;
  pendingCount: number;
  onSave: () => void;
  saveDisabled: boolean;
  isSaving: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input
        type="text"
        value={filterText}
        onChange={(e) => onFilterTextChange(e.target.value)}
        placeholder={t("permissions.matrix.filter_placeholder")}
        aria-label={t("permissions.matrix.filter_placeholder")}
        className="flex-1 min-w-[200px] px-3 py-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
      />
      <label className="flex items-center gap-2 text-03 text-[hsl(var(--color-ink-muted))] cursor-pointer">
        <input
          type="checkbox"
          checked={onlyDifferences}
          onChange={(e) => onOnlyDifferencesChange(e.target.checked)}
          className="accent-[hsl(var(--color-accent))]"
        />
        {t("permissions.matrix.only_differences")}
      </label>
      <div className="flex-1" />
      <span className="text-02 text-[hsl(var(--color-ink-subtle))]">
        {pendingCount > 0
          ? t("permissions.matrix.pending_count", { count: String(pendingCount) })
          : t("permissions.matrix.no_changes")}
      </span>
      <Button type="button" variant="primary" onClick={onSave} disabled={saveDisabled}>
        {isSaving ? t("permissions.matrix.saving") : t("permissions.matrix.save_button")}
      </Button>
    </div>
  );
}
