"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { LazyMotion, domMax } from "motion/react";
import { notificationsApi, type Notification } from "@soulledger/core/api";
import { notificationKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@soulledger/core/api";
import { SettingsDrawer } from "@/src/components/settings/SettingsDrawer";
import { ConnectionBanner } from "@/src/components/connection-status";
import { useSidebarMenus, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { Breadcrumb, useBreadcrumbs } from "@/src/components/layout/Breadcrumb";
import { BottomBar, Pillar, groupOfPath } from "@/src/components/layout/Pillar";
import { LogoutConfirmDialog } from "@/src/components/layout/LogoutConfirmDialog";
import { Plaque } from "@/src/components/plaque/Plaque";
import { useTheme } from "@/src/contexts/ThemeContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
// 「问一问」的推开只在 ≥ 1024 px(canvas 1a);窄屏它是覆盖层。
import { useWideViewport } from "@/src/hooks/useWideViewport";
import { OfficerAssistEntry, OfficerAssistPanel } from "@/src/components/assist/OfficerAssist";
import { useOfficerAssist } from "@/src/components/assist/useOfficerAssist";

/**
 * The shell, 规范 v2「朱印」:左侧立柱(`Pillar`,60 / 88,四文明共用的近黑底)+ 页头匾
 * (`Plaque`:匾色底、题字、印、纹样带,面包屑在匾的元数据位)+ 内容。
 *
 * - < 768 px 立柱收成底栏(`BottomBar`:前 4 个一级项 +「更多」底部抽屉)。v1 的 ☰ 抽屉
 *   与 56px 编号栏(以及设置里的「经典 / 紧凑」)一并撤掉 —— 立柱只有一种宽度规则。
 * - 连接状态只在断开时出现,是匾下方的一条警示条(`ConnectionBanner`),浮在内容上,
 *   不推动内容。
 * - 语言 / 主题 / 设置 / 退出在用户菜单里(brief §4.4)。
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t, formatDateTime } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const wide = useWideViewport();
  const assist = useOfficerAssist(wide);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (err) { console.error("Logout failed:", err); }
    queryClient.invalidateQueries({ queryKey: ["menus-sidebar"] });
    logout();
    router.push("/");
  };

  const { data: menus = [] } = useSidebarMenus();

  // Every non-empty menu path, flattened: `isMenuPathActive` lights an ancestor
  // only when no more specific menu item also matches (/social vs /social/follows).
  const allMenuPaths = useMemo(() => {
    const out: string[] = [];
    const walk = (items: readonly SidebarMenu[]) => {
      for (const item of items) {
        if (item.path) out.push(item.path);
        if (item.children?.length) walk(item.children);
      }
    };
    walk(menus);
    return out;
  }, [menus]);

  // 二级栏:当前页所在的一级项默认打开;导航落进另一组时跟过去。点当前打开的那一项收起。
  const currentGroup = useMemo(() => groupOfPath(menus, pathname, allMenuPaths), [menus, pathname, allMenuPaths]);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [openFor, setOpenFor] = useState<number | null>(null);
  if (currentGroup !== openFor) {
    setOpenFor(currentGroup);
    setOpenGroup(currentGroup);
  }
  const crumbs = useBreadcrumbs(menus);
  const title = crumbs.length ? crumbs[crumbs.length - 1].label : t("nav.title");

  // `count`, not `results.length`: results is one page, the badge is the whole unread inbox. (FL-15)
  const { data: unread } = useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: async () => {
      const res = await notificationsApi.list({ is_read: "false" });
      return { count: res.data.count, results: res.data.results };
    },
    staleTime: 30000,
    enabled: !!user,
  });
  const unreadCount = unread?.count ?? 0;
  const notifications = unread?.results ?? [];

  const onPlaque = "focus-ring-pillar text-xs text-[oklch(var(--color-on-main))] hover:underline";

  return (
    <LazyMotion features={domMax}>
    <div className="min-h-screen bg-[oklch(var(--color-canvas))] md:grid md:grid-cols-[auto_1fr]">
      <aside className="sticky top-0 hidden h-screen md:block">
        <Pillar
          menus={menus}
          allMenuPaths={allMenuPaths}
          currentId={currentGroup}
          openId={openGroup}
          onToggle={(id) => setOpenGroup((g) => (g === id ? null : id))}
        />
      </aside>

      <main className="min-w-0 max-md:pb-14">
        {/* 匾吸顶;连接警示条挂在匾的下沿、浮在内容上,不推动内容 —— 它在加载后一会儿
            才出现,在文档流里那 28px 的位移曾把按钮从指针下挪走(E2E 头像测试 16 次里
            1 次点空)。挂在匾里而不是另设一个吸顶锚点,匾的高度随题字档位变,锚点不用跟着算。 */}
        {/* 问一问推开时(≥ 1024)面板是右侧通顶的一栏,和左边的立柱一样;匾让出它的 420px,
            不压在匾上,也不用去量匾的高度(它随题字档位变)。 */}
        <header className={`sticky top-0 z-masthead ${assist.pushed ? "pr-[420px]" : ""}`}>
          {/* 只有一段时面包屑就是题字本身,不重复画。 */}
          <Plaque title={title} meta={crumbs.length > 1 ? <Breadcrumb menus={menus} /> : undefined}>
          <div className="flex shrink-0 items-center gap-4 whitespace-nowrap">
            {/* 问一问 (canvas 1b): the connection state left the masthead, so it leads the group. */}
            <OfficerAssistEntry assist={assist} />
            {user ? (
              <Popover.Root>
                <Popover.Trigger
                  className={`flex items-center gap-1 ${onPlaque}`}
                  aria-label={unreadCount > 0 ? `${t("notifications.title")} (${unreadCount})` : t("notifications.title")}
                >
                  <span className="hidden sm:inline">{t("notifications.title")}</span>
                  <span aria-hidden="true" className="sm:hidden">◔</span>
                  {unreadCount > 0 ? (
                    <span className="font-mono text-2xs">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  ) : null}
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-80 border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] focus:outline-hidden">
                      <div className="flex items-center justify-between border-b border-[oklch(var(--color-block))] px-4 py-2">
                        <h3 className="text-sm font-medium text-[oklch(var(--color-ink))]">{t("notifications.title")}</h3>
                        <Link href="/notifications" className="text-xs text-[oklch(var(--color-accent))] hover:underline">
                          {t("notifications.view_all")}
                        </Link>
                      </div>
                      {notifications.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-[oklch(var(--color-ink-subtle))]">{t("notifications.empty")}</p>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          {notifications.slice(0, 5).map((n: Notification) => (
                            <div key={n.id} className="border-b border-[oklch(var(--color-rule))] px-4 py-2">
                              <p className="text-sm text-[oklch(var(--color-ink))]">{n.message || n.title}</p>
                              <p className="mt-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{formatDateTime(n.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : null}

            {user ? (
              // Controlled so 设置 can close it: the settings drawer is a modal
              // dialog, and a popover left open under it is a second dialog on
              // screen (the off-screen-motion E2E found exactly that).
              <Popover.Root open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                <Popover.Trigger
                  data-testid="user-menu"
                  className={`max-w-40 truncate ${onPlaque}`}
                  title={user.display_name || user.username}
                >
                  {user.display_name || user.username} ▾
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-60 border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] focus:outline-hidden">
                      <Link
                        href="/profile"
                        className="block border-b border-[oklch(var(--color-block))] px-3 py-2 hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        <span className="block truncate text-sm text-[oklch(var(--color-ink))]" title={user.display_name || user.username}>
                          {user.display_name || user.username}
                        </span>
                        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                          <DomainEnum namespace="users.roles" value={user.role} />
                        </span>
                      </Link>
                      <div className="flex items-center justify-between gap-3 border-b border-[oklch(var(--color-rule))] px-3 py-1">
                        <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("nav.language")}</span>
                        <LanguageSwitcher />
                      </div>
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="flex min-h-8 w-full items-center justify-between border-b border-[oklch(var(--color-rule))] px-3 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        <span>{t("settings.theme")}</span>
                        <span className="text-[oklch(var(--color-ink))]">{theme === "dark" ? t("settings.dark") : t("settings.light")} ›</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setSettingsOpen(true);
                        }}
                        className="flex min-h-8 w-full items-center border-b border-[oklch(var(--color-rule))] px-3 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("nav.settings")}
                      </button>
                      <Link
                        href="/about"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex min-h-8 w-full items-center border-b border-[oklch(var(--color-rule))] px-3 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("about.title")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setLogoutConfirmOpen(true);
                        }}
                        className="flex min-h-8 w-full items-center px-3 text-xs text-[oklch(var(--color-danger))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("auth.logout")}
                      </button>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : (
              <Link href="/login" className={`border border-[oklch(var(--color-on-main))] px-3 py-1 font-medium ${onPlaque}`}>
                {t("auth.login")}
              </Link>
            )}
          </div>
          </Plaque>
          <div className="absolute inset-x-0 top-full z-filters">
            <ConnectionBanner />
          </div>
        </header>

        {/* 问一问 pushed (≥ 1024): the page gives up the panel's 420 px, and 1024–1279 its
            side padding drops to 24 (canvas 1a 一). The padding rule reaches into
            PageShell's `md:px-8` (v2: 32 px; v1 was `md:px-10`) by attribute, so no page
            has to know about the panel. */}
        <div
          ref={assist.mainRef}
          tabIndex={-1}
          data-testid="app-content"
          data-assist-pushed={assist.pushed ? "" : undefined}
          className={`min-h-[calc(100vh-2.5rem)] outline-none ${
            assist.pushed ? "pr-[420px] max-xl:[&_[class~='md:px-8']]:px-6" : ""
          }`}
        >
          {children}
        </div>
      </main>

      <BottomBar menus={menus} allMenuPaths={allMenuPaths} currentId={currentGroup} />

      <OfficerAssistPanel assist={assist} />

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
      />
    </div>
    </LazyMotion>
  );
}

// `Breadcrumb` 的实现搬到了 ./Breadcrumb.tsx（本文件当时是 751 行，超过仓库
// 500 行的上限）。这一行是**转发**，不是搬家没搬干净：
// src/__tests__/AppLayout.test.tsx 用
// `require("@/src/components/layout/AppLayout")` 取 Breadcrumb，而测试文件不在
// 这次拆分的改动范围里。入口留在原处、实现搬走，测试一行都不用改。
// 要删掉这一行，先去改那条 require。
export { Breadcrumb } from "./Breadcrumb";
