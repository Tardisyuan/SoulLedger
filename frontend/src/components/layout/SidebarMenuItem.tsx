"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getIconByName } from "../../lib/icons";
import { useI18n } from "@/src/contexts/I18nContext";
import { type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { isMenuPathActive } from "@/src/lib/menuPath";

/** 稳定引用 —— 默认值写成字面量会让 `React.memo` 每次都失效。 */
const EMPTY_PATHS: readonly string[] = [];

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
  allMenuPaths = EMPTY_PATHS,
}: {
  menu: SidebarMenu;
  collapsed: boolean;
  allMenuPaths?: readonly string[];
  depth?: number;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = menu.children && menu.children.length > 0;
  const { t } = useI18n();

  const active = isMenuPathActive(pathname, menu.path, allMenuPaths);

  const indent = collapsed ? "" : depth > 0 ? "ml-4" : "";

  /**
   * The item's name, computed once and used in three places.
   *
   * WHY THIS EXISTS AT ALL. The visible label was rendered inside
   * `{!collapsed && …}` and nothing took its place — so in compact/rail mode
   * the ENTIRE primary navigation was a column of lucide `<svg>`s with no
   * accessible name. Not "hard to read": no name. Measured before this change,
   * `grep -c 'aria-label\|title=\|aria-current'` on this file was **0**.
   *
   * Collapsed mode is not a corner: `AppLayout.tsx:234` and `:248` reach it,
   * and the settings drawer has a "compact" nav mode (`AppLayout.tsx:78`) an
   * operator can leave on permanently.
   *
   * The `aria-label` is set UNCONDITIONALLY rather than only when collapsed.
   * With a visible label present it names the same thing the label says, which
   * costs nothing; gating it on `collapsed` would make the accessible name
   * depend on a layout state, which is the kind of conditional correctness
   * that survives until someone changes the condition.
   */
  const label = menu.path === "/" ? t("nav.welcome") : menu.name;

  if (hasChildren) {
    return (
      <div className={indent}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={label}
          // The button controls the child list rendered below it, and said so
          // nowhere. A collapsed/expanded disclosure that does not announce
          // its state leaves a screen reader user pressing it to find out.
          aria-expanded={expanded}
          className={`w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} h-12 transition-colors ${
            active
              ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))]"
              : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          <span className={`shrink-0 w-8 h-8 flex items-center justify-center ${active ? "bg-[hsl(var(--color-accent))]/20" : ""}`}>
            {(() => {
              const IconComponent = getIconByName(menu.icon);
              return <IconComponent className="w-5 h-5" />;
            })()}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left text-03 truncate">{label}</span>
              {hasChildren && (
                <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-settle ${expanded ? "rotate-90" : ""}`} />
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
                allMenuPaths={allMenuPaths}
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
      aria-label={label}
      // The active item was signalled by background and text colour alone.
      // `Breadcrumb.tsx:154` already sets this for the same fact — the trail
      // knew which page you were on and the navigation beside it did not.
      aria-current={active ? "page" : undefined}
      className={`flex items-center ${collapsed ? "justify-center w-full px-0" : "gap-3 px-3"} h-12 transition-colors ${indent} ${
        active
          ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))]"
          : "text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] hover:text-[hsl(var(--color-ink))]"
      }`}
    >
      <span className={`shrink-0 w-8 h-8 flex items-center justify-center ${active ? "bg-[hsl(var(--color-accent))]/20" : ""}`}>
        {(() => {
          const IconComponent = getIconByName(menu.icon);
          return <IconComponent className="w-5 h-5" />;
        })()}
      </span>
      {!collapsed && <span className="text-03 truncate">{label}</span>}
    </Link>
  );
}

export const SidebarMenuItem = React.memo(SidebarMenuItemInner);
