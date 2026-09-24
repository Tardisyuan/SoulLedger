"use client";

import { Role } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/src/components/ui/Button";

/** The role table under 「角色」. */
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

  /* 账页(规范 v1 §2):卡片网格换成表格。角色没有详情路由,所以不是整行链接;
     编辑 / 删除是这一块真正的工作,留在行尾,做成紧凑的幽灵按钮。
     加载时由 DataTable 出同列宽的骨架。 */
  return (
    <DataTable<Role>
      caption={t("permissions.roles_title")}
      columns={[
        { key: "role", header: t("users.role") },
        { key: "holders", header: t("audit.user") },
        { key: "actions", header: t("users.actions"), align: "right", srOnlyHeader: true },
      ]}
      data={roles}
      isLoading={isLoading}
      keyExtractor={(role) => String(role.id)}
      renderRow={(role) => (
        <>
          <td className="px-4 py-3">
            <div className="font-medium text-[oklch(var(--color-ink))]">{role.display_name || role.name}</div>
            <div className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{role.name}</div>
          </td>
          <td className="px-4 py-3 text-[oklch(var(--color-ink-muted))]">
            {t("permissions.matrix.role_users", { count: String(role.user_count) })}
          </td>
          <td className="px-4 py-3 text-right">
            <div className="flex justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(role)}>
                {t("permissions.edit_role")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[oklch(var(--color-danger))]"
                onClick={() => onDelete(role)}
              >
                {t("permissions.delete_role")}
              </Button>
            </div>
          </td>
        </>
      )}
    />
  );
}
