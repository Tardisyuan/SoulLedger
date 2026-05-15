"use client";

import { useState, useEffect, Fragment } from "react";
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
import { menusApi, notificationsApi, type MenuItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@/lib/api";
import { SettingsDrawer, useAccentColor } from "@/src/components/settings/SettingsDrawer";

const NAV_MODE_KEY = "soulledger_nav_mode";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
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
      // Small delay to ensure content loads before hiding indicator
      const timer = setTimeout(() => setIsNavigating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [pathname, prevPathname]);

  // Apply accent color on mount
  useAccentColor();

  // Hydrate nav mode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(NAV_MODE_KEY);
    if (saved === "compact" || saved === "classic") {
      setNavMode(saved);
      setCollapsed(saved === "compact");
    }
  }, []);

  const handleNavModeChange = (mode: "classic" | "compact") => {
    setNavMode(mode);
    localStorage.setItem(NAV_MODE_KEY, mode);
    setCollapsed(mode === "compact");
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (err) { console.error("Logout failed:", err); }
    queryClient.invalidateQueries({ queryKey: ["menus-sidebar"] });
    logout();
    router.push("/");
  };

  const { data: menus = [] } = useQuery<MenuItem[]>({
    queryKey: ["menus-sidebar", user?.role, !!user],
    queryFn: async () => {
      // Use all() for admin (returns unfiltered), list() for others (role-filtered)
      const res = user?.role === "ADMIN" ? await menusApi.all() : await menusApi.list();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!user, // Only fetch when user is logged in
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => {
      const res = await notificationsApi.list({ is_read: "false" });
      return res.data;
    },
    staleTime: 30000, // 30 seconds
    enabled: !!user,
  });

  const sidebarWidth = collapsed ? "w-16" : "w-56";

  return (
    <div className="min-h-screen bg-canvas">
      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full ${sidebarWidth} bg-[hsl(var(--color-surface-1))] border-r border-[hsl(var(--color-hairline))] z-50 transition-all duration-200 flex flex-col`}
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
                <span className="text-[hsl(var(--color-accent))] font-bold tracking-wide truncate">
                  SoulLedger
                </span>
              </>
            )}
          </Link>
        </nav>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {menus.length === 0 && !collapsed && (
            <p className="text-xs text-ink-subtle px-2 py-4 text-center">
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
        <div className="border-t border-hairline flex items-center">
          {collapsed ? (
            /* Collapsed: centered toggle */
            <div className="w-full flex justify-center">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-8 h-8 flex items-center justify-center rounded-md text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-surface-2))] transition-colors"
                title="展开菜单"
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
                  className="w-8 h-8 flex items-center justify-center rounded-md text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-surface-2))] transition-colors"
                  title="收起菜单"
                >
                  ←
                </button>
              </div>
              <div className="w-3/4 flex justify-center pr-4">
                <div className="text-xs text-[hsl(var(--color-ink-subtle))]">
                  SoulLedger v0.1
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className={`transition-all duration-200 ${collapsed ? "ml-16" : "ml-56"}`}>
        {/* Navigation loading bar */}
        {isNavigating && (
          <div className="fixed top-0 left-0 right-0 z-[99999] h-1 bg-amber-500 animate-pulse" />
        )}

        {/* Top header */}
        <header className="sticky top-0 z-40 h-16 bg-canvas/80 backdrop-blur-sm border-b border-hairline flex items-center px-6 gap-4">
          {/* Breadcrumb / Page title area */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-3">
            {/* Notification Bell with Popover */}
            {user && (
              <Popover className="relative">
                <Popover.Button className="relative text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors p-1 rounded outline-none">
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
                        <Link href="/notifications" className="text-xs text-[hsl(var(--color-accent))] hover:underline">
                          查看全部
                        </Link>
                      </div>
                      {notifications.length === 0 ? (
                        <p className="text-sm text-[hsl(var(--color-ink-subtle))] text-center py-4">
                          {t("notifications.empty")}
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {notifications.slice(0, 5).map((n: any) => (
                            <div key={n.id} className="p-2 rounded hover:bg-[hsl(var(--color-surface-2))] cursor-pointer">
                              <p className="text-sm text-[hsl(var(--color-ink))]">{n.message || n.title}</p>
                              <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                                {new Date(n.created_at).toLocaleString()}
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

            <div className="w-px h-5 border-hairline" />

            <LanguageSwitcher />

            <div className="w-px h-5 border-hairline" />

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="text-ink-subtle hover:text-accent transition-colors p-1 rounded"
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

            <div className="w-px h-5 border-hairline" />

            {/* Settings gear */}
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              className="text-ink-subtle hover:text-accent transition-colors p-1 rounded"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <div className="w-px h-5 border-hairline" />

            {user ? (
              <>
                <Link
                  href="/profile"
                  className="text-[hsl(var(--color-ink-muted))] text-sm hover:text-[hsl(var(--color-accent))] transition-colors"
                >
                  {t("nav.greeting", { username: user.display_name || user.username })}
                </Link>
                <div className="w-px h-5 border-hairline" />
                <button
                  onClick={() => setLogoutConfirmOpen(true)}
                  className="text-ink-subtle hover:text-red-400 text-sm transition-colors"
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
                    确认退出登录
                  </Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-[hsl(var(--color-ink-muted))]">
                    确定要退出当前账号吗？
                  </Dialog.Description>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => setLogoutConfirmOpen(false)}
                      className="px-4 py-2 rounded-md bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] text-sm hover:bg-[hsl(var(--color-surface-3))] transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleLogout}
                      className="px-4 py-2 rounded-md bg-red-500/20 text-red-400 text-sm hover:bg-red-500/30 transition-colors"
                    >
                      确认退出
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

function SidebarMenuItem({
  menu,
  collapsed,
  depth = 0,
}: {
  menu: MenuItem;
  collapsed: boolean;
  depth?: number;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = menu.children && menu.children.length > 0;

  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(path + "/");
  const active = isActive(menu.path);

  const indent = collapsed ? "" : depth > 0 ? "ml-4" : "";

  if (hasChildren) {
    return (
      <div className={indent}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} h-12 rounded-lg transition-colors ${
            active
              ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
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
              <span className="flex-1 text-left text-sm truncate">{menu.name}</span>
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
          ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
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
