"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { menuButtonsApi, menusApi, type MenuItem } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { MENU_BUTTON_CONFIG_KEY } from "@/src/hooks/useMenuButtonConfig";
import { findMenuByPath } from "@/src/lib/menuI18n";
import { WIRED_BUTTONS, buttonKey, type WiredButton } from "@/src/lib/menuButtons";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { PageShell } from "@/src/components/ui/PageShell";
import { QueryError } from "@/src/components/ui/PageError";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * 菜单按钮配置(第四十批 W-b)。只列真正接上的关键按钮(`WIRED_BUTTONS`),按菜单分组,一行一个:
 * 显示开关 · 按钮 · 出现在 · 也需要的权限码。按钮要这里开着、并且用户持有权限码,才会显示。
 *
 * 开关读写 `MenuButton` 行(菜单 path + code 为键)。没有那一行 = 开着;第一次关掉时才建行,
 * 之后只改 `is_active`。被关掉的按钮在页面上不留任何痕迹 —— 查原因就来这一页。
 * 只有持 `menu.manage` 的人能拨开关(后端同一个码);其余人只看。
 */
export default function MenuButtonsPage() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("menu.manage");
  const queryClient = useQueryClient();

  const { data: menus = [] } = useQuery<MenuItem[]>({
    queryKey: ["menus-all"],
    queryFn: async () => (await menusApi.all()).data,
  });
  const config = useQuery({
    queryKey: MENU_BUTTON_CONFIG_KEY,
    queryFn: async () => (await menuButtonsApi.config()).data,
  });
  const rows = useMemo(
    () => new Map((config.data ?? []).map((row) => [buttonKey(row.menu_path, row.code), row])),
    [config.data]
  );

  const toggle = useMutation({
    mutationFn: async (button: WiredButton) => {
      const row = rows.get(buttonKey(button.menu, button.code));
      if (row) return menuButtonsApi.update(row.id, { is_active: !row.is_active });
      // 没有行 = 开着;关掉时建一行。
      const menu = findMenuByPath(menus as SidebarMenu[], button.menu);
      if (!menu) throw new Error(`no menu at ${button.menu}`);
      return menuButtonsApi.create({
        menu: menu.id,
        name: t(button.label),
        code: button.code,
        permission: button.permission,
        is_active: false,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu-buttons"] }),
    onError: () => showToast(t("menu_buttons.update_error"), "error"),
  });

  const groups = useMemo(() => {
    const byMenu = new Map<string, WiredButton[]>();
    for (const b of WIRED_BUTTONS) byMenu.set(b.menu, [...(byMenu.get(b.menu) ?? []), b]);
    return [...byMenu.entries()];
  }, []);

  return (
    <PageShell variant="page" title={t("menu_buttons.title")} subtitle={t("menu_buttons.rule")}>
      {config.isLoading ? (
        <ListSkeleton count={3} />
      ) : config.isError ? (
        <QueryError onRetry={() => config.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState title={t("menu_buttons.no_buttons")} />
      ) : (
        <div className="space-y-3">
          {groups.map(([path, buttons]) => {
            const menuName = findMenuByPath(menus as SidebarMenu[], path)?.name ?? path;
            return (
              <details key={path} open className="border-t border-[oklch(var(--color-block))]" data-testid={`menu-buttons-${path}`}>
                <summary className="cursor-pointer py-2 text-sm font-medium text-[oklch(var(--color-ink))]">
                  {t("menu_buttons.count", { menu: menuName, n: String(buttons.length) })}
                </summary>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs text-[oklch(var(--color-ink-subtle))]">
                      <th scope="col" className="w-16 px-3 py-1 font-normal">{t("menu_buttons.col_show")}</th>
                      <th scope="col" className="px-3 py-1 font-normal">{t("menu_buttons.name")}</th>
                      <th scope="col" className="px-3 py-1 font-normal">{t("menu_buttons.col_where")}</th>
                      <th scope="col" className="px-3 py-1 font-normal">{t("menu_buttons.col_perm")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buttons.map((b) => {
                      const on = rows.get(buttonKey(b.menu, b.code))?.is_active ?? true;
                      return (
                        <tr key={b.id} className="border-t border-[oklch(var(--color-rule))]">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!canManage || toggle.isPending}
                              onChange={() => toggle.mutate(b)}
                              aria-label={`${t(b.label)} · ${t("menu_buttons.col_show")}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-[oklch(var(--color-ink))]">{t(b.label)}</td>
                          <td className="px-3 py-2 text-[oklch(var(--color-ink-muted))]">{t(b.where)}</td>
                          {/* 码名是标识符,等宽。 */}
                          <td className="px-3 py-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">{b.permission}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
