"use client";

import React, { useState, useEffect, Fragment } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, Transition, Dialog } from "@headlessui/react";
import {
  Globe, Users, ArrowRightLeft, Scale, Gem, UserCog, User, Settings,
  Folder, FileText, Home, Shield, ShieldCheck, ShieldAlert, ShieldQuestion,
  Scroll, BookOpen, Bell, ChevronRight, ChevronDown, Sun, Moon, LogOut,
  type LucideIcon
} from "lucide-react";
import { getIconByName, DEFAULT_ICON } from "../../lib/icons";
import { notificationsApi, type Notification, type PaginatedResponse } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@/lib/api";
import { SettingsDrawer, useAccentColor } from "@/src/components/settings/SettingsDrawer";
import { ConnectionStatus } from "@/src/components/connection-status";
import { useSidebarMenus, isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { menuGlossParts } from "@/src/lib/menuI18n";
import { isMenuPathActive } from "@/src/lib/menuPath";

const NAV_MODE_KEY = "soulledger_nav_mode";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t, formatDateTime } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [navMode, setNavMode] = useState<"classic" | "compact">("classic");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Track navigation state by pathname changes
  useEffect(() => {
    if (pathname !== prevPathname) {
      setIsNavigating(true);
      setPrevPathname(pathname);
      // Auto-close mobile menu on navigation
      setMobileMenuOpen(false);
      // Small delay to ensure content loads before hiding indicator
      const timer = setTimeout(() => setIsNavigating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [pathname, prevPathname]);

  // Apply accent color on mount
  useAccentColor();

  // Hydrate nav mode from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAV_MODE_KEY);
      if (saved === "compact" || saved === "classic") {
        setNavMode(saved);
        setCollapsed(saved === "compact");
      }
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
    setCollapsed(mode === "compact");
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (err) { console.error("Logout failed:", err); }
    queryClient.invalidateQueries({ queryKey: ["menus-sidebar"] });
    logout();
    router.push("/");
  };

  const { data: menus = [] } = useSidebarMenus();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => {
      const res = await notificationsApi.list({ is_read: "false" });
      return res.data.results;
    },
    staleTime: 30000, // 30 seconds
    enabled: !!user,
  });

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const sidebarWidth = collapsed ? "w-16" : "w-56";

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))]">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full ${sidebarWidth} bg-[hsl(var(--color-surface-1))] border-r border-[hsl(var(--color-hairline))] z-50 transition-all duration-200 flex flex-col
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        {/* Logo */}
        <nav className={`h-16 border-b border-[hsl(var(--color-hairline))] shrink-0 flex items-center ${collapsed ? "justify-center px-0" : "justify-center px-5"}`}>
          <Link href="/" prefetch={true} className="flex items-center gap-2.5 overflow-hidden">
            {collapsed ? (
              /* Collapsed: Scale icon */
              <svg className="w-7 h-7 shrink-0 text-[hsl(var(--color-accent))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" stroke="currentColor"/>
                <path d="M5 8l7-5 7 5" stroke="currentColor"/>
                <circle cx="5" cy="8" r="2" fill="currentColor" stroke="none"/>
                <circle cx="19" cy="8" r="2" fill="currentColor" stroke="none"/>
                <path d="M5 16l7 5 7-5" stroke="currentColor"/>
                <circle cx="5" cy="16" r="2" fill="currentColor" stroke="none"/>
                <circle cx="19" cy="16" r="2" fill="currentColor" stroke="none"/>
              </svg>
            ) : (
              /* Expanded: Scale + text */
              <>
                <svg className="w-7 h-7 shrink-0 text-[hsl(var(--color-accent))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18"/>
                  <path d="M5 8l7-5 7 5"/>
                  <circle cx="5" cy="8" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="19" cy="8" r="2" fill="currentColor" stroke="none"/>
                  <path d="M5 16l7 5 7-5"/>
                  <circle cx="5" cy="16" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="19" cy="16" r="2" fill="currentColor" stroke="none"/>
                </svg>
                <span className="text-[hsl(var(--color-accent-ink))] font-bold tracking-wide truncate">
                  SoulLedger
                </span>
              </>
            )}
          </Link>
        </nav>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {menus.length === 0 && !collapsed && (
            <p className="text-xs text-[hsl(var(--color-ink-subtle))] px-2 py-4 text-center">
              {t("menus.no_menus")}
            </p>
          )}
          {menus.map((menu) => (
            <SidebarMenuItem
              key={menu.id}
              menu={menu}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Bottom: toggle + footer */}
        <div className="border-t border-[hsl(var(--color-hairline))] flex items-center">
          {collapsed ? (
            /* Collapsed: centered toggle */
            <div className="w-full flex justify-center">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-8 h-8 flex items-center justify-center rounded-md text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent-ink))] hover:bg-[hsl(var(--color-surface-2))] transition-colors"
                title={t("nav.expand_menu")}
                aria-label={t("nav.expand_menu")}
                aria-expanded={false}
              >
                →
              </button>
            </div>
          ) : (
            /* Expanded: button in left 1/4 (centered), footer in right 3/4 (centered) */
            <>
              <div className="w-1/4 flex justify-center">
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent-ink))] hover:bg-[hsl(var(--color-surface-2))] transition-colors"
                  title={t("nav.collapse_menu")}
                  aria-label={t("nav.collapse_menu")}
                  aria-expanded={true}
                >
                  ←
                </button>
              </div>
              <div className="w-3/4 flex justify-center pr-4">
                <div className="text-xs text-[hsl(var(--color-ink-subtle))]">
                  {t("footer.version")}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className={`transition-all duration-200 ${collapsed ? "ml-0 md:ml-16" : "ml-0 md:ml-56"}`}>
        {/* Navigation loading bar */}
        {isNavigating && (
          <div className="fixed top-0 left-0 right-0 z-[99999] h-1 bg-[hsl(var(--color-accent))] animate-pulse" />
        )}

        {/* Top header */}
        <header className="sticky top-0 z-40 h-16 bg-[hsl(var(--color-canvas))]/80 backdrop-blur-sm border-b border-[hsl(var(--color-hairline))] flex items-center px-4 md:px-6 gap-3 md:gap-4">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-md text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))]"
            aria-label={mobileMenuOpen ? t("nav.collapse_menu") : t("nav.expand_menu")}
            aria-expanded={mobileMenuOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Breadcrumb / Page title area */}
          <Breadcrumb menus={menus} />

          {/* Right controls */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* WebSocket Connection Status */}
            <ConnectionStatus />

            <div className="w-px h-5 border-[hsl(var(--color-hairline))] hidden sm:block" />

            {/* Notification Bell with Popover */}
            {user && (
              <Popover className="relative">
                <Popover.Button
                  className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors p-1 rounded"
                  aria-label={
                    notifications.length > 0
                      ? `${t("notifications.title")} (${notifications.length})`
                      : t("notifications.title")
                  }
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-[hsl(var(--color-accent))] text-black text-xs font-bold rounded-full flex items-center justify-center">
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  )}
                </Popover.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Popover.Panel className="absolute right-0 mt-2 w-80 origin-top-right rounded-lg bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] shadow-xl focus:outline-none z-[99998]">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-[hsl(var(--color-ink))]">{t("notifications.title")}</h3>
                        <Link href="/notifications" className="text-xs text-[hsl(var(--color-accent-ink))] hover:underline">
                          {t("notifications.view_all")}
                        </Link>
                      </div>
                      {notifications.length === 0 ? (
                        <p className="text-sm text-[hsl(var(--color-ink-subtle))] text-center py-4">
                          {t("notifications.empty")}
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {notifications.slice(0, 5).map((n: Notification) => (
                            <div key={n.id} className="p-2 rounded hover:bg-[hsl(var(--color-surface-2))] cursor-pointer">
                              <p className="text-sm text-[hsl(var(--color-ink))]">{n.message || n.title}</p>
                              <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                                {formatDateTime(n.created_at)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Popover.Panel>
                </Transition>
              </Popover>
            )}

            <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />

            <LanguageSwitcher />

            <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? t("nav.theme_light") : t("nav.theme_dark")}
              aria-label={theme === "dark" ? t("nav.theme_light") : t("nav.theme_dark")}
              className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors p-1 rounded"
            >
              {theme === "dark" ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />

            {/* Settings gear */}
            <button
              onClick={() => setSettingsOpen(true)}
              title={t("nav.settings")}
              aria-label={t("nav.settings")}
              className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors p-1 rounded"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />

            {user ? (
              <>
                <Link
                  href="/profile"
                  className="text-[hsl(var(--color-ink-muted))] text-sm hover:text-[hsl(var(--color-accent-ink))] transition-colors"
                >
                  {t("nav.greeting", { username: user.display_name || user.username })}
                </Link>
                <div className="w-px h-5 border-[hsl(var(--color-hairline))]" />
                <button
                  onClick={() => setLogoutConfirmOpen(true)}
                  className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-status-error))] text-sm transition-colors"
                >
                  {t("auth.logout")}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-[hsl(var(--color-accent))] text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-[hsl(var(--color-accent))] transition-colors"
              >
                {t("auth.login")}
              </Link>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="min-h-[calc(100vh-4rem)]">
          {children}
        </div>
      </main>

      {/* Settings Drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        navMode={navMode}
        onNavModeChange={handleNavModeChange}
      />

      {/* Logout Confirmation Dialog */}
      <Transition appear show={logoutConfirmOpen} as={Fragment}>
        <Dialog as="div" className="relative z-[99998]" onClose={() => setLogoutConfirmOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md rounded-xl bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-6 shadow-2xl">
                  <Dialog.Title className="text-lg font-semibold text-[hsl(var(--color-ink))]">
                    {t("auth.confirm_logout")}
                  </Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-[hsl(var(--color-ink-muted))]">
                    {t("auth.confirm_logout_desc")}
                  </Dialog.Description>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => setLogoutConfirmOpen(false)}
                      className="px-4 py-2 rounded-md bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] text-sm hover:bg-[hsl(var(--color-surface-3))] transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 rounded-md bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] text-sm hover:bg-[hsl(var(--color-status-error)/0.3)] transition-colors"
                    >
                      {t("auth.confirm_logout_btn")}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}

/** 形如 42 或 uuid 的路径段，面包屑里显示为「详情」而不是原始 id。 */
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-)/i;

/**
 * 在菜单树里找出与当前路径最匹配的一条链路（从分组到叶子）。
 * 取 path 最长的匹配项，这样 /social/follows 命中「关注」而不是「动态」。
 */
function matchTrail(items: SidebarMenu[], pathname: string): SidebarMenu[] {
  let best: SidebarMenu[] = [];
  let bestLen = -1;

  const walk = (nodes: SidebarMenu[], trail: SidebarMenu[]) => {
    for (const node of nodes) {
      const next = [...trail, node];
      const p = node.path;
      if (p && (pathname === p || pathname.startsWith(p + "/"))) {
        if (p.length > bestLen) {
          best = next;
          bestLen = p.length;
        }
      }
      const kids = node.children as SidebarMenu[] | undefined;
      if (kids?.length) walk(kids, next);
    }
  };

  walk(items, []);
  return best;
}

// 面包屑段落的中文原名旁边配的译名（见 src/lib/menuI18n.ts 里的解释：菜单名
// 是数据库自由文本，没有 i18n 字段，导航本身永远保持中文原文；面包屑和页面
// H1 是仅有的两处例外，补一个"译名 中文原名"的对照）。
type Crumb = { label: string; gloss?: string; href?: string };

export function Breadcrumb({ menus }: { menus: SidebarMenu[] }) {
  const pathname = usePathname();
  const { t, locale } = useI18n();

  // t() 找不到 key 时会原样返回 key，这里补一个真正的兜底。
  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const segmentLabel = (segment: string) =>
    ID_SEGMENT.test(segment)
      ? label("breadcrumb.detail", "详情")
      : label(`breadcrumb.${segment}`, segment);

  const trail = matchTrail(menus, pathname);
  const crumbs: Crumb[] = [];

  if (trail.length > 0) {
    for (const node of trail) {
      const { primary, gloss } = menuGlossParts(node, locale, t);
      crumbs.push({
        // 分组目录没有页面，不给链接
        label: primary,
        gloss,
        href: isDirectory(node) ? undefined : node.path,
      });
    }
    // 菜单里没有登记的更深层路由（/menus/buttons、/dispatch/propose、
    // /souls/<id> …）按剩余的路径段补上，避免"进去了看不出自己在哪"。
    const matched = trail[trail.length - 1];
    if (matched.path && pathname !== matched.path) {
      const rest = pathname.slice(matched.path.length).split("/").filter(Boolean);
      rest.forEach((segment, i) => {
        crumbs.push({
          label: segmentLabel(segment),
          href:
            i < rest.length - 1
              ? `${matched.path}/${rest.slice(0, i + 1).join("/")}`
              : undefined,
        });
      });
    }
  } else {
    // 菜单树里完全没有的路径（例如已移出侧边栏的 /profile、/notifications）
    pathname
      .split("/")
      .filter(Boolean)
      .forEach((segment, i, all) => {
        crumbs.push({
          label: segmentLabel(segment),
          href: i < all.length - 1 ? `/${all.slice(0, i + 1).join("/")}` : undefined,
        });
      });
  }

  if (crumbs.length === 0) return <div className="flex-1" />;

  return (
    <nav
      aria-label={label("breadcrumb.aria_label", "面包屑导航")}
      className="flex-1 min-w-0"
    >
      <ol className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
        <li className="shrink-0">
          <Link
            href="/dashboard"
            prefetch={true}
            className="flex items-center text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors"
            title={label("breadcrumb.home", "仪表盘")}
          >
            <Home className="w-4 h-4" />
          </Link>
        </li>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--color-ink-subtle))]" />
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  prefetch={true}
                  className="truncate text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent-ink))] transition-colors"
                >
                  {crumb.label}
                  {crumb.gloss && (
                    <span className="ml-1 text-[hsl(var(--color-ink-subtle))]">{crumb.gloss}</span>
                  )}
                </Link>
              ) : (
                <span
                  className={`truncate ${
                    isLast
                      ? "text-[hsl(var(--color-ink))] font-medium"
                      : "text-[hsl(var(--color-ink-subtle))]"
                  }`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                  {crumb.gloss && (
                    <span className="ml-1 font-normal text-[hsl(var(--color-ink-subtle))]">{crumb.gloss}</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SidebarMenuItemInner({
  menu,
  collapsed,
  depth = 0,
}: {
  menu: SidebarMenu;
  collapsed: boolean;
  depth?: number;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = menu.children && menu.children.length > 0;
  const { t } = useI18n();

  const active = isMenuPathActive(pathname, menu.path);

  const indent = collapsed ? "" : depth > 0 ? "ml-4" : "";

  if (hasChildren) {
    return (
      <div className={indent}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} h-12 rounded-lg transition-colors ${
            active
              ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))]"
              : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${active ? "bg-[hsl(var(--color-accent))]/20" : ""}`}>
            {(() => {
              const IconComponent = getIconByName(menu.icon);
              return <IconComponent className="w-5 h-5" />;
            })()}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left text-sm truncate">
                {menu.path === "/" ? t("nav.welcome") : menu.name}
              </span>
              {hasChildren && (
                <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
              )}
            </>
          )}
        </button>
        {expanded && !collapsed && (
          <div className="mt-1">
            {menu.children!.map((child) => (
              <SidebarMenuItem
                key={child.id}
                menu={child}
                collapsed={collapsed}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={menu.path}
      prefetch={true}
      className={`flex items-center ${collapsed ? "justify-center w-full px-0" : "gap-3 px-3"} h-12 rounded-lg transition-colors ${indent} ${
        active
          ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))]"
          : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
      }`}
    >
      <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${active ? "bg-[hsl(var(--color-accent))]/20" : ""}`}>
        {(() => {
          const IconComponent = getIconByName(menu.icon);
          return <IconComponent className="w-5 h-5" />;
        })()}
      </span>
      {!collapsed && (
        <span className="text-sm truncate">{menu.name}</span>
      )}
    </Link>
  );
}

const SidebarMenuItem = React.memo(SidebarMenuItemInner);
