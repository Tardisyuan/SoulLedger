"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getIconByName } from "../../lib/icons";
import { useI18n } from "@/src/contexts/I18nContext";
import { type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { isMenuPathActive } from "@/src/lib/menuPath";

/**
 * 侧边栏的一行菜单项（有子项时是可展开的分组）。原先长在 AppLayout.tsx 里，
 * 随文件一起越过 500 行的上限之后搬到这里；代码逐字未改。
 *
 * 仍然是 `React.memo` 包一层：整棵菜单树在每次 AppLayout 重渲染时都会重跑，
 * 而 `menu` 引用来自 useSidebarMenus 的缓存，是稳定的。
 */
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

export const SidebarMenuItem = React.memo(SidebarMenuItemInner);
