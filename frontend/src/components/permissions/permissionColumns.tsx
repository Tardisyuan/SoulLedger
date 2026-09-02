import { Permission } from "@soulledger/core/api";
import type { DataGridColumn } from "@/components/ui/data-grid";

/**
 * Codename/name/category are identifier/text/enum per §1's taxonomy; the
 * actions column collapses to the overflow spec (design doc open item #3)
 * instead of the two bare "编辑/删除" links that used to run together with
 * no separator.
 */
export function buildPermissionColumns({
  t,
  canManagePermissions,
  onEdit,
  onDelete,
}: {
  t: (key: string, params?: Record<string, string>) => string;
  canManagePermissions: boolean;
  onEdit: (perm: Permission) => void;
  onDelete: (perm: Permission) => void;
}): DataGridColumn<Permission>[] {
  return [
    { type: "identifier", key: "codename", header: t("permissions.codename"), width: "220px", value: (perm) => perm.codename },
    { type: "text", key: "name", header: t("permissions.name"), value: (perm) => perm.name },
    {
      type: "enum",
      key: "category",
      header: t("permissions.category"),
      width: "160px",
      value: (perm) => ({ tone: "neutral", label: perm.category }),
    },
    {
      type: "actions",
      key: "actions",
      header: t("souls.action"),
      width: "112px",
      menuLabel: t("common.row_actions"),
      // Edit inline as the one primary verb; delete stays behind the
      // overflow trigger, separated from the safe action — §3's resolution
      // to "两个动作链接连在一起，其中一个是破坏性的".
      primary: (perm) =>
        canManagePermissions ? { label: t("permissions.edit"), onSelect: () => onEdit(perm) } : null,
      items: (perm) =>
        canManagePermissions
          ? [
              {
                key: "delete",
                label: t("permissions.delete"),
                tone: "danger",
                onSelect: () => onDelete(perm),
              },
            ]
          : [],
    },
  ];
}
