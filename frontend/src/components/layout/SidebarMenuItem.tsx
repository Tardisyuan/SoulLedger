"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { isMenuPathActive } from "@/src/lib/menuPath";

/**
 * The sidebar, 规范 v1「侧栏与导航」:
 *
 * - 一级 = 等宽编号 + 组名(`01 概览`)。有子项的一级不可点,只切换展开;没有
 *   子项的一级(概览)本身是页面。
 * - **一次只展开一组**(手风琴),当前页所在组默认展开 —— 展开态由调用方
 *   (AppLayout)持有,这里只报告点击。
 * - 二级 = 页面,可点。当前项 `surface-2 底 + 左 3 px 墨线 + 500`,不再用强调色
 *   整块填充。每行下一条行线(rule)。
 * - 收成编号栏(56 px)时只剩编号;悬停一组浮出它的页面(393 px 下整个侧栏是抽屉,
 *   不走这条)。
 *
 * 无权限的页面由后端菜单树直接不给,这里不做灰化。
 */

/** 稳定引用 —— 默认值写成字面量会让 `React.memo` 每次都失效。 */
const EMPTY_PATHS: readonly string[] = [];

const ROW = "flex items-center min-h-8 border-b border-[oklch(var(--color-rule))] transition-colors duration-150 ease-out";
const CURRENT = "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-ink))] text-[oklch(var(--color-ink))] font-medium";
const IDLE = "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]";

const labelOf = (menu: SidebarMenu, t: (k: string) => string) => (menu.path === "/" ? t("nav.welcome") : menu.name);

/** One page row (二级, or a childless 一级). */
function PageLink({
  menu,
  number,
  allMenuPaths,
  nested,
}: {
  menu: SidebarMenu;
  number?: string;
  allMenuPaths: readonly string[];
  nested: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const active = isMenuPathActive(pathname, menu.path, allMenuPaths);
  const label = labelOf(menu, t);
  return (
    <Link
      href={menu.path}
      prefetch={true}
      aria-current={active ? "page" : undefined}
      className={`${ROW} ${nested ? "pl-8 pr-3 text-02" : "px-3 gap-2"} ${active ? CURRENT : IDLE}`}
    >
      {number ? <span aria-hidden="true" className="font-mono text-01 text-[oklch(var(--color-ink-subtle))]">{number}</span> : null}
      <span className={`truncate ${nested ? "" : "font-mono text-01 uppercase tracking-label text-[oklch(var(--color-ink))]"}`}>
        {label}
      </span>
    </Link>
  );
}

function SidebarGroupInner({
  menu,
  index,
  collapsed,
  open,
  onToggle,
  allMenuPaths = EMPTY_PATHS,
}: {
  menu: SidebarMenu;
  /** 0-based position among the top-level groups; shown as 01, 02, … */
  index: number;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  allMenuPaths?: readonly string[];
}) {
  const { t } = useI18n();
  const number = String(index + 1).padStart(2, "0");
  const label = labelOf(menu, t);
  const children = menu.children ?? [];

  if (collapsed) {
    // 编号栏:只剩编号。一组的页面在悬停 / 聚焦时浮出,不改变侧栏宽度。
    const only = !children.length && !isDirectory(menu);
    return (
      <div className="group relative">
        {only ? (
          <Link
            href={menu.path}
            aria-label={label}
            className={`${ROW} justify-center font-mono text-01 text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]`}
          >
            {number}
          </Link>
        ) : (
          <button
            type="button"
            aria-label={label}
            className={`${ROW} w-full justify-center font-mono text-01 text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]`}
          >
            {number}
          </button>
        )}
        {children.length ? (
          <div className="invisible absolute left-full top-0 z-drawer w-50 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] opacity-0 shadow-overlay group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
            <p className="px-3 py-1 font-mono text-01 text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-block))]">
              {number} {label}
            </p>
            {children.map((child) => (
              <PageLink key={child.id} menu={child} allMenuPaths={allMenuPaths} nested />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!children.length && !isDirectory(menu)) {
    return <PageLink menu={menu} number={number} allMenuPaths={allMenuPaths} nested={false} />;
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${ROW} w-full justify-between gap-2 px-3 text-left hover:bg-[oklch(var(--color-surface-2))]`}
      >
        <span className="flex min-w-0 items-center gap-2 font-mono text-01 uppercase tracking-label">
          <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">{number}</span>
          <span className="truncate text-[oklch(var(--color-ink))]">{label}</span>
        </span>
        <span aria-hidden="true" className="font-mono text-01 text-[oklch(var(--color-ink-subtle))]">
          {open ? "−" : "+"}
        </span>
      </button>
      {open
        ? children.map((child) => <PageLink key={child.id} menu={child} allMenuPaths={allMenuPaths} nested />)
        : null}
    </div>
  );
}

export const SidebarGroup = React.memo(SidebarGroupInner);

/** Which top-level group holds the current page — the one open by default. */
export function groupOfPath(menus: readonly SidebarMenu[], pathname: string, allMenuPaths: readonly string[]): number | null {
  const holds = (m: SidebarMenu): boolean =>
    isMenuPathActive(pathname, m.path, allMenuPaths) || (m.children ?? []).some(holds);
  const i = menus.findIndex(holds);
  return i < 0 ? null : menus[i].id;
}
