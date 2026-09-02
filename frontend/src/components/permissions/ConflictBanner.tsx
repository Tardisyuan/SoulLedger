"use client";

import { Role } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/** 409 optimistic-lock banner: someone else changed this role's grants first. */
export function ConflictBanner({
  conflict,
  roleMeta,
  isReloading,
  onReload,
}: {
  conflict: { role: string; expected: number; current: number };
  roleMeta: Record<string, Role>;
  /** `undefined` when the role's query has not been created yet — same
   *  falsy-but-not-false value the page's `conflictRoleQuery?.isFetching`
   *  produced inline, kept as-is so the rendered attribute is unchanged. */
  isReloading: boolean | undefined;
  onReload: () => void;
}) {
  const { t } = useI18n();

  return (
    <div role="alert" className="bg-[hsl(var(--color-status-error))]/10 border border-[hsl(var(--color-status-error))]/40 p-4 flex items-center justify-between gap-4">
      <p className="text-03 text-[hsl(var(--color-status-error))]">
        {t("permissions.matrix.conflict_message", {
          role: roleMeta[conflict.role]?.display_name || conflict.role,
          expected: String(conflict.expected),
          current: String(conflict.current),
        })}
      </p>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={onReload}
        disabled={isReloading}
        className="shrink-0"
      >
        {isReloading ? t("permissions.matrix.conflict_reloading") : t("permissions.matrix.conflict_reload_button")}
      </Button>
    </div>
  );
}
