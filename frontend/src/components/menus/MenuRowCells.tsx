"use client";

import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import type { MenuItemFull } from "./menuTypes";

type LucideIconName = keyof typeof LucideIcons;

/** One menu row's seven `<td>`s — DataTable supplies the surrounding `<tr>`. */
export function MenuRowCells({
  menu,
  onEdit,
  onDelete,
}: {
  menu: MenuItemFull;
  onEdit: (menu: MenuItemFull) => void;
  onDelete: (menu: MenuItemFull) => void;
}) {
  const { t } = useI18n();
  const MenuIcon = menu.icon
    ? (LucideIcons[menu.icon as LucideIconName] as unknown as LucideIcon)
    : null;
  // Deleted-row state (Stage 4 §4.7): ink-subtle text, strikethrough
  // on the name only, plus a "已删除" badge — never hidden data,
  // just de-emphasized. Only reachable when showDeleted is on,
  // since the backend only returns these rows with ?show_deleted=true.
  const isDeleted = Boolean(menu.is_deleted);

  return (
    <>
      <td className={`px-4 py-3 ${isDeleted ? "text-ink-subtle" : ""}`}>
        <div className="flex items-center gap-2">
          {MenuIcon ? (
            <MenuIcon className="w-4 h-4 text-[hsl(var(--color-accent-ink))]" />
          ) : null}
          <span className={`font-medium ${isDeleted ? "line-through text-ink-subtle" : "text-ink"}`}>
            {menu.name}
          </span>
          {isDeleted && (
            <Badge className="shrink-0 text-ink-subtle">
              {t("menus.deleted_badge")}
            </Badge>
          )}
        </div>
      </td>
      {/* Paths are identifiers — the 02 step, and monospaced. */}
      <td className="px-4 py-3 text-02 font-mono text-ink-muted">{menu.path}</td>
      <td className="px-4 py-3">
        <Badge>{t(`menus.menu_types.${menu.menu_type ?? "MENU"}`)}</Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {menu.roles.map((role) => (
            /* `pill`, and this is the one place on the page that
               earns it: a role IS an identity token, which is the
               documented meaning of a round badge here. */
            <Badge key={role} tone="accent" shape="pill">
              {t(`users.roles.${role}`)}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-ink-muted">{menu.order}</td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          {/* is_active and visible are gates being in force or not —
              a system state, so the tone table applies here. */}
          <Badge tone={menu.is_active ? "success" : "neutral"}>
            {menu.is_active ? t("menus.active") : t("menus.inactive")}
          </Badge>
          <Badge className={menu.visible !== false ? undefined : "text-ink-subtle"}>
            {menu.visible !== false ? t("menus.shown_label") : t("menus.hidden_label")}
          </Badge>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {/* See app/permissions/page.tsx: inline siblings concatenate
            their labels in the accessibility tree and on copy. */}
        <div className="flex justify-end gap-2">
          {!isDeleted && (
            <>
              <RequirePermission permissions="menu.update">
                <Button type="button" size="sm" onClick={() => onEdit(menu)}>
                  {t("menus.edit")}
                </Button>
              </RequirePermission>
              <RequirePermission permissions="menu.delete">
                <Button type="button" size="sm" variant="danger" onClick={() => onDelete(menu)}>
                  {t("menus.delete")}
                </Button>
              </RequirePermission>
            </>
          )}
          {isDeleted && (
            <span className="text-02 text-ink-subtle">
              {t("recycle_bin.manage_from_bin")}
            </span>
          )}
        </div>
      </td>
    </>
  );
}
