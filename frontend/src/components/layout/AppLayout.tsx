"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { menusApi, type MenuItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";

const ROLE_ICONS: Record<string, string> = {
  ADMIN: "⚙️",
  JUDGE: "⚖️",
  GUARDIAN: "🛡️",
  VIEWER: "👁️",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  const { data: menus = [] } = useQuery<MenuItem[]>({
    queryKey: ["menus-sidebar"],
    queryFn: async () => {
      const res = await menusApi.all();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const sidebarWidth = collapsed ? "w-16" : "w-56";

  return (
    <div className="min-h-screen bg-canvas">
      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full ${sidebarWidth} bg-surface-1 border-r border-hairline z-50 transition-all duration-200 flex flex-col`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-hairline shrink-0">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <span className="text-2xl shrink-0">💀</span>
            {!collapsed && (
              <span className="text-amber-500 font-bold tracking-wide truncate">
                SoulLedger
              </span>
            )}
          </Link>
        </div>

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

        {/* Footer */}
        {!collapsed && (
          <div className="p-3 border-t border-hairline text-xs text-ink-subtle text-center">
            SoulLedger v0.1
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className={`transition-all duration-200 ${collapsed ? "ml-16" : "ml-56"}`}>
        {/* Top header - taller, with collapse toggle */}
        <header className="sticky top-0 z-40 h-16 bg-canvas/80 backdrop-blur-sm border-b border-hairline flex items-center px-6 gap-4">
          {/* Collapse toggle - styled like Snowy */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-8 h-8 flex items-center justify-center rounded-md text-ink-muted hover:text-amber-500 hover:bg-surface-2 transition-colors"
            title={collapsed ? "展开菜单" : "收起菜单"}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Breadcrumb / Page title area */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-ink-muted hover:text-ink text-sm"
            >
              {t("nav.home")}
            </Link>
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
          className={`w-full flex items-center gap-2.5 h-11 px-2.5 rounded-lg transition-colors ${
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
      className={`flex items-center gap-2.5 h-11 px-2.5 rounded-lg transition-colors ${indent} ${
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
