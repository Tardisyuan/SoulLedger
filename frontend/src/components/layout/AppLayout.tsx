"use client";

import React, { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { notificationsApi, type Notification, type PaginatedResponse } from "@soulledger/core/api";
import { notificationKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@soulledger/core/api";
import { SettingsDrawer, useAccentColor } from "@/src/components/settings/SettingsDrawer";
import { ConnectionBanner } from "@/src/components/connection-status";
import { useSidebarMenus, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { Breadcrumb } from "@/src/components/layout/Breadcrumb";
import { SidebarGroup, groupOfPath } from "@/src/components/layout/SidebarMenuItem";
import { LogoutConfirmDialog } from "@/src/components/layout/LogoutConfirmDialog";
import { useTheme } from "@/src/contexts/ThemeContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";

const NAV_MODE_KEY = "soulledger_nav_mode";

/** ≥ 1024 px shows the 200 px sidebar; below it (and in compact mode) the 56 px number rail. */
function useWideViewport(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    // No matchMedia (jsdom): treat as wide — the rail is the narrow-screen fallback.
    () => (typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)").matches : true),
    () => true
  );
}

/**
 * The shell, 规范 v1 §3「同一个壳」: 200 px sidebar + 40 px masthead
 * (breadcrumb · notifications · user menu) + content with 40 px side margins.
 *
 * - ≤ 1024 px the sidebar is the 56 px number rail (01–06); hovering a group
 *   floats its pages. The settings drawer's "compact" mode keeps the rail on
 *   wide screens too.
 * - < 768 px the sidebar is a drawer opened from ☰ in a 48 px masthead.
 * - The connection state left the masthead: it appears only when the link is
 *   down, as a warning bar under it (`ConnectionBanner`).
 * - Language / theme / settings / sign-out moved into the user menu (brief §4.4:
 *   eight masthead controls became three; nothing was removed).
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t, formatDateTime } = useI18n();
  const [navMode, setNavMode] = useState<"classic" | "compact">("classic");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const wide = useWideViewport();
  const rail = navMode === "compact" || !wide;

  // Close the mobile drawer on navigation (RouteProgress owns the progress bar).
  useEffect(() => {
    if (pathname !== prevPathname) {
      setPrevPathname(pathname);
      setMobileMenuOpen(false);
    }
  }, [pathname, prevPathname]);

  // The accent picker's stored choice (default ink blue), applied on mount.
  useAccentColor();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAV_MODE_KEY);
      if (saved === "compact" || saved === "classic") setNavMode(saved);
    } catch {
      // localStorage unavailable (SSR or private browsing)
    }
  }, []);

  const handleNavModeChange = (mode: "classic" | "compact") => {
    setNavMode(mode);
    try {
      localStorage.setItem(NAV_MODE_KEY, mode);
    } catch {
      // localStorage unavailable
    }
  };

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

  // Accordion: one group open at a time; the current page's group by default,
  // and again whenever navigation lands in another group.
  const currentGroup = useMemo(() => groupOfPath(menus, pathname, allMenuPaths), [menus, pathname, allMenuPaths]);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [openFor, setOpenFor] = useState<number | null>(null);
  if (currentGroup !== openFor) {
    setOpenFor(currentGroup);
    setOpenGroup(currentGroup);
  }

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

  // `nav.mobile_menu` may be missing from a bundle; `t()` then echoes the key.
  const mobileMenuName = t("nav.mobile_menu");
  const drawerLabel = mobileMenuName === "nav.mobile_menu" ? "导航菜单" : mobileMenuName;
  const { drawerRef, drawerProps } = useDrawerA11y<HTMLElement>({
    open: mobileMenuOpen,
    onClose: () => setMobileMenuOpen(false),
    label: drawerLabel,
  });

  const sidebar = (collapsed: boolean) => (
    <>
      <Link
        href="/"
        prefetch={true}
        className={`flex h-10 shrink-0 items-center border-b border-[oklch(var(--color-block))] font-mono text-01 tracking-label text-[oklch(var(--color-ink))] ${collapsed ? "justify-center" : "px-3"}`}
      >
        {collapsed ? "SL" : "SOULLEDGER"}
      </Link>
      <nav aria-label={drawerLabel} className="flex-1 overflow-y-auto">
        {menus.length === 0 && !collapsed ? (
          <p className="px-3 py-4 text-02 text-[oklch(var(--color-ink-subtle))]">{t("menus.no_menus")}</p>
        ) : null}
        {menus.map((menu, index) => (
          <SidebarGroup
            key={menu.id}
            menu={menu}
            index={index}
            collapsed={collapsed}
            open={openGroup === menu.id}
            onToggle={() => setOpenGroup((g) => (g === menu.id ? null : menu.id))}
            allMenuPaths={allMenuPaths}
          />
        ))}
      </nav>
      {/* 底部原来的暗条删除;版本号放在最底一行。 */}
      <p className={`shrink-0 border-t border-[oklch(var(--color-line))] py-2 font-mono text-01 text-[oklch(var(--color-ink-subtle))] ${collapsed ? "text-center" : "px-3"}`}>
        {collapsed ? "v0.1" : t("footer.version")}
      </p>
    </>
  );

  return (
    <div className={`min-h-screen bg-[oklch(var(--color-canvas))] md:grid ${rail ? "md:grid-cols-[56px_1fr]" : "md:grid-cols-[200px_1fr]"}`}>
      {/* Mobile scrim: a real button (it is a click target), hidden by `visibility` so it can fade. */}
      <button
        type="button"
        aria-label={t("common.close")}
        className={`fixed inset-0 z-scrim bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] md:hidden transition-[opacity,visibility] duration-200 ${
          mobileMenuOpen ? "visible opacity-100" : "invisible opacity-0"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Desktop / tablet: in the grid, sticky. */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] md:flex">
        {sidebar(rail)}
      </aside>

      {/* Phone: a drawer from ☰. */}
      <aside
        ref={drawerRef}
        {...drawerProps}
        className={`fixed left-0 top-0 z-sidebar flex h-full w-50 flex-col border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] transition-transform duration-200 md:hidden ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar(false)}
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-masthead flex h-12 items-center gap-3 border-b border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-4 md:h-10 md:px-10">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-10 w-10 items-center justify-center text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] md:hidden"
            aria-label={mobileMenuOpen ? t("nav.collapse_menu") : t("nav.expand_menu")}
            aria-expanded={mobileMenuOpen}
          >
            ☰
          </button>

          <Breadcrumb menus={menus} />

          <div className="flex shrink-0 items-center gap-4 whitespace-nowrap">
            {user ? (
              <Popover.Root>
                <Popover.Trigger
                  className="flex items-center gap-1 text-02 text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
                  aria-label={unreadCount > 0 ? `${t("notifications.title")} (${unreadCount})` : t("notifications.title")}
                >
                  <span className="hidden sm:inline">{t("notifications.title")}</span>
                  <span aria-hidden="true" className="sm:hidden">◔</span>
                  {unreadCount > 0 ? (
                    <span className="font-mono text-01 text-[oklch(var(--color-accent))]">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  ) : null}
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-80 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] shadow-overlay focus:outline-hidden">
                      <div className="flex items-center justify-between border-b border-[oklch(var(--color-block))] px-4 py-2">
                        <h3 className="text-03 font-medium text-[oklch(var(--color-ink))]">{t("notifications.title")}</h3>
                        <Link href="/notifications" className="text-02 text-[oklch(var(--color-accent))] hover:underline">
                          {t("notifications.view_all")}
                        </Link>
                      </div>
                      {notifications.length === 0 ? (
                        <p className="px-4 py-4 text-03 text-[oklch(var(--color-ink-subtle))]">{t("notifications.empty")}</p>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          {notifications.slice(0, 5).map((n: Notification) => (
                            <div key={n.id} className="border-b border-[oklch(var(--color-rule))] px-4 py-2">
                              <p className="text-03 text-[oklch(var(--color-ink))]">{n.message || n.title}</p>
                              <p className="mt-1 font-mono text-01 text-[oklch(var(--color-ink-subtle))]">{formatDateTime(n.created_at)}</p>
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
              <Popover.Root>
                <Popover.Trigger
                  data-testid="user-menu"
                  className="max-w-40 truncate text-02 text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
                  title={user.display_name || user.username}
                >
                  {user.display_name || user.username} ▾
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-60 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] shadow-overlay focus:outline-hidden">
                      <Link
                        href="/profile"
                        className="block border-b border-[oklch(var(--color-block))] px-3 py-2 hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        <span className="block truncate text-03 text-[oklch(var(--color-ink))]" title={user.display_name || user.username}>
                          {user.display_name || user.username}
                        </span>
                        <span className="font-mono text-01 text-[oklch(var(--color-ink-subtle))]">
                          <DomainEnum namespace="users.roles" value={user.role} />
                        </span>
                      </Link>
                      <div className="flex items-center justify-between gap-3 border-b border-[oklch(var(--color-rule))] px-3 py-1">
                        <span className="text-02 text-[oklch(var(--color-ink-muted))]">{t("nav.language")}</span>
                        <LanguageSwitcher />
                      </div>
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="flex min-h-8 w-full items-center justify-between border-b border-[oklch(var(--color-rule))] px-3 text-02 text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        <span>{t("settings.theme")}</span>
                        <span className="text-[oklch(var(--color-ink))]">{theme === "dark" ? t("settings.dark") : t("settings.light")} ›</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                        className="flex min-h-8 w-full items-center border-b border-[oklch(var(--color-rule))] px-3 text-02 text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("nav.settings")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLogoutConfirmOpen(true)}
                        className="flex min-h-8 w-full items-center px-3 text-02 text-[oklch(var(--color-danger))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("auth.logout")}
                      </button>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : (
              <Link href="/login" className="border border-[oklch(var(--color-ink))] px-3 py-1 text-02 font-medium text-[oklch(var(--color-ink))]">
                {t("auth.login")}
              </Link>
            )}
          </div>
        </header>

        <ConnectionBanner />

        <div className="min-h-[calc(100vh-2.5rem)]">{children}</div>
      </main>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        navMode={navMode}
        onNavModeChange={handleNavModeChange}
      />
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
}

// `Breadcrumb` 的实现搬到了 ./Breadcrumb.tsx（本文件当时是 751 行，超过仓库
// 500 行的上限）。这一行是**转发**，不是搬家没搬干净：
// src/__tests__/AppLayout.test.tsx 用
// `require("@/src/components/layout/AppLayout")` 取 Breadcrumb，而测试文件不在
// 这次拆分的改动范围里。入口留在原处、实现搬走，测试一行都不用改。
// 要删掉这一行，先去改那条 require。
export { Breadcrumb } from "./Breadcrumb";
