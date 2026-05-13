"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { menusApi, notificationsApi, type MenuItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@/lib/api";

const ROLE_ICONS: Record<string, string> = {
  ADMIN: "⚙️",
  JUDGE: "⚖️",
  GUARDIAN: "🛡️",
  VIEWER: "👁️",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
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
        className={`fixed left-0 top-0 h-full ${sidebarWidth} bg-surface-1 border-r border-hairline z-50 transition-all duration-200 flex flex-col`}
      >
        {/* Logo */}
        <nav className={`h-16 border-b border-hairline shrink-0 flex items-center ${collapsed ? "justify-center px-0" : "justify-center px-5"}`}>
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <span className="text-2xl shrink-0">💀</span>
            {!collapsed && (
              <span className="text-amber-500 font-bold tracking-wide truncate">
                SoulLedger
              </span>
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
          {/* Toggle button */}
          <div className={`flex ${collapsed ? "w-full justify-center" : "w-1/4"}`}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="w-8 h-8 flex items-center justify-center rounded-md text-ink-muted hover:text-amber-500 hover:bg-surface-2 transition-colors"
              title={collapsed ? "展开菜单" : "收起菜单"}
            >
              {collapsed ? "→" : "←"}
            </button>
          </div>
          {/* Divider */}
          {!collapsed && <div className="w-px h-5 bg-hairline" />}
          {/* Footer */}
          {collapsed ? null : (
            <div className="flex-1 text-xs text-ink-subtle text-center pr-4">
              SoulLedger v0.1
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className={`transition-all duration-200 ${collapsed ? "ml-16" : "ml-56"}`}>
        {/* Top header */}
        <header className="sticky top-0 z-40 h-16 bg-canvas/80 backdrop-blur-sm border-b border-hairline flex items-center px-6 gap-4">
          {/* Breadcrumb / Page title area */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            {user && (
              <Link
                href="/notifications"
                className="relative text-ink-subtle hover:text-amber-500 transition-colors p-1 rounded"
                title={t("notifications.title")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black text-xs font-bold rounded-full flex items-center justify-center">
                    {notifications.length > 9 ? "9+" : notifications.length}
                  </span>
                )}
              </Link>
            )}

            <div className="w-px h-5 border-hairline" />

            <LanguageSwitcher />

            <div className="w-px h-5 border-hairline" />

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="text-ink-subtle hover:text-amber-500 transition-colors p-1 rounded"
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

            {user ? (
              <>
                <span className="text-ink-muted text-sm">
                  {t("nav.greeting", { username: user.display_name || user.username })}
                </span>
                <div className="w-px h-5 border-hairline" />
                <button
                  onClick={handleLogout}
                  className="text-ink-subtle hover:text-red-400 text-sm transition-colors"
                >
                  {t("auth.logout")}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-amber-500 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-400 transition-colors"
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
              ? "bg-amber-500/20 text-amber-400"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          <span className="text-base shrink-0">
            {menu.icon || (ROLE_ICONS[menu.roles?.[0]] || "📁")}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left text-sm truncate">{menu.name}</span>
              <svg
                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
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
      className={`flex items-center ${collapsed ? "justify-center w-full px-0" : "gap-3 px-3"} h-12 rounded-lg transition-colors ${indent} ${
        active
          ? "bg-amber-500/20 text-amber-400"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <span className="text-base shrink-0">
        {menu.icon || (ROLE_ICONS[menu.roles?.[0]] || "📄")}
      </span>
      {!collapsed && (
        <span className="text-sm truncate">{menu.name}</span>
      )}
    </Link>
  );
}
