"use client";

import { Role } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/src/components/ui/Button";

/** The role cards under 「角色」, plus their loading placeholder. */
export function RolesGrid({
  roles,
  isLoading,
  onEdit,
  onDelete,
}: {
  roles: Role[];
  isLoading: boolean;
  onEdit: (role: Role) => void;
  onDelete: (role: Role) => void;
}) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
            <Skeleton className="h-4 w-2/3 mb-2" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {roles.map((role) => (
        <div key={role.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-3 hover:border-[hsl(var(--color-accent))]/30 transition-colors">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-[hsl(var(--color-ink))] truncate text-03">{role.display_name || role.name}</h3>
            <p className="text-02 text-[hsl(var(--color-ink-muted))] font-mono truncate">{role.name}</p>
            <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">{t("permissions.matrix.role_users", { count: String(role.user_count) })}</p>
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onEdit(role)}
              className="flex-1"
            >
              {t("permissions.edit_role")}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => onDelete(role)}
              className="flex-1"
            >
              {t("permissions.delete_role")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
