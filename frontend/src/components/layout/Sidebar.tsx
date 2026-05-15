"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { menusApi, type MenuItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { getIconByName, DEFAULT_ICON } from "../../lib/icons";

export function Sidebar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const { data: menus = [] } = useQuery<MenuItem[]>({
    queryKey: ["menus-sidebar"],
    queryFn: async () => {
      const res = await menusApi.all();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-[hsl(var(--color-surface-1))] border-r border-[hsl(var(--color-hairline))] z-50 transition-all duration-200 flex flex-col ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-[hsl(var(--color-hairline))] shrink-0">
        <Link href="/" className="flex items-center gap-2 overflow-hidden">
          <span className="text-xl shrink-0">💀</span>
          {!collapsed && (
            <span className="text-[hsl(var(--color-accent))] font-bold text-sm tracking-wide truncate">
              SoulLedger
            </span>
          )}
        </Link>
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-16 w-6 h-6 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-full flex items-center justify-center text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] transition-colors z-10"
      >
        {collapsed ? "→" : "←"}
      </button>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto py-2">
        {menus.map((menu) => (
          <MenuItem
            key={menu.id}
            menu={menu}
            collapsed={collapsed}
            isActive={isActive}
          />
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="p-3 border-t border-[hsl(var(--color-hairline))] text-xs text-[hsl(var(--color-ink-subtle))] text-center">
          SoulLedger v0.1
        </div>
      )}
    </aside>
  );
}

function MenuItem({
  menu,
  collapsed,
  isActive,
  depth = 0,
}: {
  menu: MenuItem;
  collapsed: boolean;
  isActive: (path: string) => boolean;
  depth?: number;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = menu.children && menu.children.length > 0;
  const active = isActive(menu.path);

  if (collapsed) {
    return (
      <Link
        href={hasChildren ? "#" : menu.path}
        onClick={hasChildren ? (e) => { e.preventDefault(); } : undefined}
        className={`flex items-center justify-center h-10 mx-2 my-0.5 rounded-md transition-colors ${
          active
            ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
            : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
        }`}
        title={menu.name}
      >
        {(() => {
          const Icon = getIconByName(menu.icon);
          return <Icon className="w-5 h-5" />;
        })()}
      </Link>
    );
  }

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center gap-2 h-10 px-3 my-0.5 rounded-md transition-colors ${
            active
              ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
              : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          {(() => {
            const Icon = getIconByName(menu.icon);
            return <Icon className="w-5 h-5 shrink-0" />;
          })()}
          <span className="flex-1 text-left text-sm truncate">{menu.name}</span>
          <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>
            ▸
          </span>
        </button>
        {expanded && (
          <div className="ml-4">
            {menu.children!.map((child) => (
              <MenuItem
                key={child.id}
                menu={child}
                collapsed={collapsed}
                isActive={isActive}
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
      className={`flex items-center gap-2 h-10 px-3 my-0.5 rounded-md transition-colors ${
        active
          ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
          : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
      }`}
    >
      {(() => {
        const Icon = getIconByName(menu.icon);
        return <Icon className="w-5 h-5 shrink-0" />;
      })()}
      <span className="text-sm truncate">{menu.name}</span>
    </Link>
  );
}
