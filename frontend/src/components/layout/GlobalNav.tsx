"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/src/contexts/I18nContext";
import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { isMenuPathActive } from "@/src/lib/menuPath";
import { menuGlossParts } from "@/src/lib/menuI18n";
import { Seal } from "@/src/components/plaque/Seal";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import type { UserRole } from "@soulledger/core/api";

/**
 * 全局导航(规范 v3 外框),取代 v2 的近黑立柱与 200px 弹出二级栏。
 *
 * - 浅色中性:surface-1 底、右侧 1px line。文明色(`--color-main`)**只**出现在当前项上:
 *   3px 左标 + 8% main 混进 surface-1 的底,字 ink 600。这条 3px 是导航,不是表格行 ——
 *   「3px = 待我处理」那条说的是行。
 * - 一级项与顺序、图标都来自后端菜单(`useSidebarMenus`;`menu.icon` 是 lucide 图标名,
 *   见 IconPicker)。不认得的图标名落回一个中性方块,不按路径写死。
 * - 有子项的一级项是手风琴:原位展开,同一时刻只开一组,当前页所在组默认打开(状态在 AppLayout)。
 * - 收起(68px)时只剩图标;有子项的组点开一个浮出层列出它的页面 —— 子页面不能因为收起就够不着。
 * - 四档宽度:≥ 1200 展开 252 / 收起 68 由用户选(`localStorage["soulledger-nav-mode"]`,`[` 切换);
 *   769–1199 强制收起(给审判台的 600px 裁决栏留地方);≤ 768 没有侧栏,是底栏(`BottomBar`)。
 * - 焦点环用全站的 ink 环 —— 导航现在是浅底。v2 立柱的 `.focus-ring-pillar`(onMain 内缩环)
 *   随立柱、匾上的面包屑与操作一起没有了调用点,已从 globals.css 删除。
 *
 * 标签:译名优先,中文原名在 title 里(`menuGlossParts`,与面包屑同一份对照)。
 */

export function useMenuLabel() {
  const { t, locale } = useI18n();
  return (menu: SidebarMenu) => {
    if (menu.path === "/") return { primary: t("nav.welcome") };
    return menuGlossParts(menu, locale, t);
  };
}

/** Which top-level item holds the current page — the one lit, and the one whose group opens by default. */
export function groupOfPath(menus: readonly SidebarMenu[], pathname: string, allMenuPaths: readonly string[]): number | null {
  const holds = (m: SidebarMenu): boolean =>
    isMenuPathActive(pathname, m.path, allMenuPaths) || (m.children ?? []).some(holds);
  const i = menus.findIndex(holds);
  return i < 0 ? null : menus[i].id;
}

type LucideModule = typeof import("lucide-react");
type IconResolver = (icon: string | null | undefined) => LucideIcon | null;

/**
 * `menu.icon` → lucide 组件。库里存的是 IconPicker 写下的导出名(`LayoutDashboard`,也有别名
 * `Building2`、`BarChart`),E2E 夹具里有直接写 kebab 的(`users`)。只认真正的图标 ——
 * `lucide-react` 还导出 `Icon`、`createLucideIcon` 这类非图标,名字撞上它们要落回中性方块,
 * 所以以 `icons` 表里的组件为准(别名与正名是同一个组件对象)。导出给测试。
 */
export function iconResolver(mod: LucideModule): IconResolver {
  const real = new Set<unknown>(Object.values(mod.icons));
  const table = mod as unknown as Record<string, unknown>;
  return (icon) => {
    if (!icon) return null;
    const pascal = icon.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
    const hit = [icon, pascal].map((n) => table[n]).find((c) => real.has(c));
    return (hit as LucideIcon | undefined) ?? null;
  };
}

/**
 * 整套 lucide 只在这里按需载入一次(异步块,不进外框的首屏包):图标名来自数据库,
 * 静态 import 做不了摇树。载入之前与不认得的名字都画中性方块。
 */
let resolverPromise: Promise<IconResolver> | null = null;
let resolved: IconResolver | null = null;
function loadResolver(): Promise<IconResolver> {
  resolverPromise ??= import("lucide-react").then((mod) => (resolved = iconResolver(mod)));
  return resolverPromise;
}
// 外框模块一求值就开始载(不等第一个 NavIcon 挂上):图标早一点到,已到时 NavIcon 首帧就画对。
if (typeof window !== "undefined") void loadResolver();

/** 菜单图标(16px)。不认得 → 中性方块,不按路径写死。 */
export function NavIcon({ icon }: { icon: string | null | undefined }) {
  const [resolve, setResolve] = useState<IconResolver | null>(() => resolved);
  useEffect(() => {
    if (resolve) return;
    let live = true;
    void loadResolver().then((r) => {
      if (live) setResolve(() => r);
    });
    return () => {
      live = false;
    };
  }, [resolve]);
  const Icon = resolve?.(icon) ?? null;
  return (
    <span aria-hidden="true" data-icon={icon || undefined} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      {Icon ? <Icon size={16} strokeWidth={1.6} /> : <span data-testid="nav-icon-fallback" className="inline-block h-2.5 w-2.5 border border-current" />}
    </span>
  );
}

// ── 导航模式 ────────────────────────────────────────────────────────────

export const NAV_MODE_KEY = "soulledger-nav-mode";
export type NavMode = "expanded" | "collapsed";
/** 769–1199 强制收起;≤ 768 根本没有侧栏,同样不让切。 */
const FORCED_QUERY = "(max-width: 1199.98px)";

function useForcedCollapse(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(FORCED_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    // No matchMedia (jsdom) reads as wide, the same fallback `useWideViewport` takes.
    () => (typeof window.matchMedia === "function" ? window.matchMedia(FORCED_QUERY).matches : false),
    () => false
  );
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * 用户选的模式(≥ 1200 才生效)+ 是否被宽度强制收起 + `[` 快捷键。
 * 每一次 localStorage 读写都包在 try 里:隐私窗口里它会抛,那时模式只活在本页。
 */
export function useNavMode() {
  const [mode, setMode] = useState<NavMode>("expanded");
  const forced = useForcedCollapse();
  useEffect(() => {
    try {
      if (window.localStorage.getItem(NAV_MODE_KEY) === "collapsed") setMode("collapsed");
    } catch {
      /* storage blocked: stay expanded */
    }
  }, []);

  const toggle = useCallback(() => {
    if (forced) return;
    setMode((m) => {
      const next: NavMode = m === "expanded" ? "collapsed" : "expanded";
      try {
        window.localStorage.setItem(NAV_MODE_KEY, next);
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
      return next;
    });
  }, [forced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing) return;
      if (isEditable(e.target)) return;
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { mode, forced, collapsed: forced || mode === "collapsed", toggle };
}

// ── 侧栏 ────────────────────────────────────────────────────────────────

/** 当前项:3px main 左标 + 8% main 混进 surface-1。全导航只有这两处读 `--color-main`。 */
const CURRENT_BG = "bg-[color-mix(in_oklab,oklch(var(--color-main))_8%,oklch(var(--color-surface-1)))]";
function CurrentMark() {
  return <span aria-hidden="true" data-testid="nav-current-mark" className="absolute inset-y-1.5 left-0 w-[3px] bg-[oklch(var(--color-main))]" />;
}

const ROW = "relative flex w-full items-center rounded-control text-xs transition-colors duration-fast";
const IDLE = "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-canvas))] hover:text-[oklch(var(--color-ink))]";
const CURRENT = `${CURRENT_BG} font-semibold text-[oklch(var(--color-ink))]`;

type Label = { primary: string; gloss?: string };
const fullTitle = (l: Label) => (l.gloss ? `${l.primary} ${l.gloss}` : l.primary);
const hasChildren = (m: SidebarMenu) => Boolean(m.children?.length) || isDirectory(m);

/** 当前项进入视野(只在它成为当前项时,不在每次渲染时)。 */
function useScrollIntoViewWhen<T extends HTMLElement>(current: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [current]);
  return ref;
}

export function GlobalNav({
  menus,
  allMenuPaths,
  currentId,
  openId,
  onToggle,
  collapsed,
  user,
}: {
  menus: readonly SidebarMenu[];
  allMenuPaths: readonly string[];
  /** 当前页所在的一级项。 */
  currentId: number | null;
  /** 手风琴里展开的那一组。 */
  openId: number | null;
  onToggle: (id: number) => void;
  collapsed: boolean;
  user?: { display_name?: string; username: string; role: UserRole } | null;
}) {
  const { t } = useI18n();
  const labelOf = useMenuLabel();
  const pathname = usePathname();
  const navLabel = t("nav.mobile_menu") === "nav.mobile_menu" ? "导航菜单" : t("nav.mobile_menu");
  const name = user ? user.display_name || user.username : "";

  // 服务端不知道存的模式与视口宽度,首帧总是展开;读到之后那一下是校正,不是用户的操作,
  // 不该播 240ms 的收起动画。所以宽度过渡等两帧之后才打开 —— 写在 DOM 上而不是 state 里:
  // React 不管它没渲染过的属性,也就不会因为这一下多渲染一次。
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => boxRef.current?.setAttribute("data-animate", ""));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  return (
    <div
      ref={boxRef}
      id="global-nav"
      data-testid="global-nav"
      data-collapsed={collapsed || undefined}
      className={`flex h-full flex-col overflow-hidden border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] data-animate:transition-[width] data-animate:duration-base data-animate:ease-enter ${
        collapsed ? "w-17" : "w-63"
      }`}
    >
      <div className={`flex h-14.5 shrink-0 items-center gap-2 border-b border-[oklch(var(--color-line))] ${collapsed ? "justify-center" : "px-4"}`}>
        <Seal size={28} />
        {collapsed ? null : (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs font-semibold text-[oklch(var(--color-ink))]">SoulLedger</p>
            <p className="truncate text-2xs text-[oklch(var(--color-ink-muted))]">灵魂簿</p>
          </div>
        )}
      </div>

      <nav aria-label={navLabel} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
        {menus.length === 0 ? <p className="px-2 py-4 text-2xs text-[oklch(var(--color-ink-muted))]">{t("menus.no_menus")}</p> : null}
        {menus.map((menu) =>
          hasChildren(menu) ? (
            collapsed ? (
              <RailGroup key={menu.id} menu={menu} label={labelOf(menu)} current={menu.id === currentId} allMenuPaths={allMenuPaths} />
            ) : (
              <Group
                key={menu.id}
                menu={menu}
                label={labelOf(menu)}
                holdsCurrent={menu.id === currentId}
                open={menu.id === openId}
                onToggle={() => onToggle(menu.id)}
                allMenuPaths={allMenuPaths}
                pathname={pathname}
              />
            )
          ) : (
            <TopLeaf key={menu.id} menu={menu} label={labelOf(menu)} current={menu.id === currentId} collapsed={collapsed} />
          )
        )}
      </nav>

      {user ? (
        <Link
          href="/profile"
          title={collapsed ? name : undefined}
          aria-label={collapsed ? name : undefined}
          className={`flex h-14.5 shrink-0 items-center gap-2 border-t border-[oklch(var(--color-line))] hover:bg-[oklch(var(--color-canvas))] ${collapsed ? "justify-center" : "px-3"}`}
        >
          {/* 头像:正圆是头像的例外(eslint.config.mjs ROUND_ALLOW)。名字的首字。 */}
          <span aria-hidden="true" className="inline-flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-[oklch(var(--color-surface-3))] text-xs text-[oklch(var(--color-ink))]">
            {Array.from(name.trim())[0] ?? "?"}
          </span>
          {collapsed ? null : (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-xs text-[oklch(var(--color-ink))]" title={name}>{name}</span>
              <span className="block text-2xs text-[oklch(var(--color-ink-muted))]">
                <DomainEnum namespace="users.roles" value={user.role} />
              </span>
            </span>
          )}
        </Link>
      ) : null}
    </div>
  );
}

/** 没有子项的一级项:本身就是页面。 */
function TopLeaf({ menu, label, current, collapsed }: { menu: SidebarMenu; label: Label; current: boolean; collapsed: boolean }) {
  const ref = useScrollIntoViewWhen<HTMLAnchorElement>(current);
  return (
    <Link
      ref={ref}
      href={menu.path}
      prefetch={true}
      aria-current={current ? "page" : undefined}
      aria-label={collapsed ? label.primary : undefined}
      title={collapsed ? fullTitle(label) : undefined}
      className={`${ROW} min-h-10.5 ${collapsed ? "justify-center" : "gap-2 px-2"} ${current ? CURRENT : IDLE}`}
    >
      {current ? <CurrentMark /> : null}
      <span className="flex w-6.75 shrink-0 justify-center"><NavIcon icon={menu.icon} /></span>
      {collapsed ? null : <span title={fullTitle(label)} className="min-w-0 flex-1 truncate">{label.primary}</span>}
    </Link>
  );
}

/** 展开时的分组:原位手风琴。 */
function Group({
  menu,
  label,
  holdsCurrent,
  open,
  onToggle,
  allMenuPaths,
  pathname,
}: {
  menu: SidebarMenu;
  label: Label;
  holdsCurrent: boolean;
  open: boolean;
  onToggle: () => void;
  allMenuPaths: readonly string[];
  pathname: string;
}) {
  const childrenId = `nav-group-${menu.id}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? childrenId : undefined}
        aria-current={holdsCurrent ? "true" : undefined}
        onClick={onToggle}
        className={`${ROW} min-h-10.5 gap-2 px-2 text-left ${
          open || holdsCurrent ? "text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-canvas))]" : IDLE
        } ${holdsCurrent ? "font-semibold" : ""}`}
      >
        <span className="flex w-6.75 shrink-0 justify-center"><NavIcon icon={menu.icon} /></span>
        <span title={fullTitle(label)} className="min-w-0 flex-1 truncate">{label.primary}</span>
        <span
          aria-hidden="true"
          className={`flex w-4 shrink-0 justify-center text-sm leading-none transition-transform duration-fast ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {open ? (
        <div id={childrenId} className="pt-0.5 pb-1 pl-8">
          {(menu.children ?? []).map((child) => (
            <ChildLink key={child.id} menu={child} current={isMenuPathActive(pathname, child.path, allMenuPaths)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChildLink({ menu, current, onNavigate }: { menu: SidebarMenu; current: boolean; onNavigate?: () => void }) {
  const labelOf = useMenuLabel();
  const label = labelOf(menu);
  const ref = useScrollIntoViewWhen<HTMLAnchorElement>(current);
  return (
    <Link
      ref={ref}
      href={menu.path}
      prefetch={true}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={`${ROW} min-h-9.5 gap-2 px-2 ${current ? CURRENT : IDLE}`}
    >
      {current ? <CurrentMark /> : null}
      <span aria-hidden="true" className="w-[3px] shrink-0" />
      <span title={fullTitle(label)} className="min-w-0 flex-1 truncate">{label.primary}</span>
    </Link>
  );
}

/**
 * 收起时的分组:只剩图标(读屏名与 title 都是标签),点开一个浮出层列出这组的页面。
 * 子页面藏起来了,所以当前页落在组里时,当前态画在这个图标上。
 */
function RailGroup({ menu, label, current, allMenuPaths }: { menu: SidebarMenu; label: Label; current: boolean; allMenuPaths: readonly string[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useScrollIntoViewWhen<HTMLButtonElement>(current);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={ref}
        aria-label={label.primary}
        title={fullTitle(label)}
        aria-current={current ? "true" : undefined}
        className={`${ROW} min-h-10.5 justify-center ${current ? CURRENT : IDLE}`}
      >
        {current ? <CurrentMark /> : null}
        <NavIcon icon={menu.icon} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="right" align="start" sideOffset={8} className="z-drawer">
          <Popover.Popup
            data-testid="nav-flyout"
            className="w-56 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-1 focus:outline-hidden"
          >
            <p className="truncate px-2 py-2 text-2xs text-[oklch(var(--color-ink-muted))]" title={fullTitle(label)}>
              {label.primary}
            </p>
            {(menu.children ?? []).map((child) => (
              <ChildLink
                key={child.id}
                menu={child}
                current={isMenuPathActive(pathname, child.path, allMenuPaths)}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── 底栏(≤ 768) ───────────────────────────────────────────────────────

/** 底栏的前几格;第 5 格固定是「更多」。 */
const BAR_SLOTS = 4;

/**
 * 宽度 ≤ 768 时的导航:固定 5 格 —— 后端顺序里的前 4 个一级项 +「更多」。
 * 一级项是分组时,点它打开底部抽屉列出这组的页面;「更多」打开同一个抽屉,按分组列出其余全部项。
 * 中性底(surface-1、上沿 1px line);当前格是 main 色字 + 600。当前页落在「更多」里时,
 * 「更多」这一格是当前态,抽屉里那一项是当前项。
 * 抽屉是模态对话框(`useDrawerA11y`:焦点进去、Tab 圈在里面、Esc 关、焦点还给打开它的那一格)。
 */
export function BottomBar({
  menus,
  allMenuPaths,
  currentId,
}: {
  menus: readonly SidebarMenu[];
  allMenuPaths: readonly string[];
  currentId: number | null;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const labelOf = useMenuLabel();
  const [sheet, setSheet] = useState<number | "more" | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setSheet(null);
  }

  const slots = menus.slice(0, BAR_SLOTS);
  const rest = menus.slice(BAR_SLOTS);
  const currentInRest = rest.some((m) => m.id === currentId);
  const sheetLabel = t("nav.mobile_menu") === "nav.mobile_menu" ? "导航菜单" : t("nav.mobile_menu");
  const moreLabel = t("nav.more") === "nav.more" ? "更多" : t("nav.more");
  const close = () => setSheet(null);
  const { drawerRef, drawerProps } = useDrawerA11y<HTMLElement>({ open: sheet !== null, onClose: close, label: sheetLabel });

  const sheetGroups = sheet === "more" ? rest : slots.filter((m) => m.id === sheet);
  const cell = (current: boolean) =>
    `relative flex min-h-14 items-center justify-center px-1 text-center text-xs ${
      current ? "font-semibold text-[oklch(var(--color-main))]" : "text-[oklch(var(--color-ink-muted))]"
    }`;

  return (
    <>
      <button
        type="button"
        aria-label={t("common.close")}
        tabIndex={sheet === null ? -1 : 0}
        className={`fixed inset-0 z-scrim bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-[opacity,visibility] duration-base min-[769px]:hidden ${
          sheet !== null ? "visible opacity-100" : "invisible opacity-0"
        }`}
        onClick={close}
      />
      {sheet !== null ? (
        <aside
          ref={drawerRef}
          {...drawerProps}
          data-testid="bar-sheet"
          className="fixed inset-x-0 bottom-14 z-sidebar max-h-[70vh] overflow-y-auto border-t border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] min-[769px]:hidden"
        >
          <div className="flex items-center justify-between border-b border-[oklch(var(--color-line))] px-4 py-2">
            <span className="text-2xs text-[oklch(var(--color-ink-muted))]">{sheetLabel}</span>
            <button type="button" onClick={close} className="min-h-11 px-2 text-sm text-[oklch(var(--color-ink))] underline">
              {t("common.close")}
            </button>
          </div>
          <div className="p-2">
            {sheetGroups.map((group) =>
              hasChildren(group) ? (
                <section key={group.id}>
                  <p className="px-2 pt-3 pb-1 text-2xs text-[oklch(var(--color-ink-muted))]">{labelOf(group).primary}</p>
                  {(group.children ?? []).map((child) => (
                    <ChildLink
                      key={child.id}
                      menu={child}
                      current={isMenuPathActive(pathname, child.path, allMenuPaths)}
                      onNavigate={close}
                    />
                  ))}
                </section>
              ) : (
                <ChildLink
                  key={group.id}
                  menu={group}
                  current={isMenuPathActive(pathname, group.path, allMenuPaths)}
                  onNavigate={close}
                />
              )
            )}
          </div>
        </aside>
      ) : null}
      <nav
        aria-label={sheetLabel}
        data-testid="bottom-bar"
        className="fixed inset-x-0 bottom-0 z-sidebar grid grid-cols-5 border-t border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] min-[769px]:hidden"
      >
        {slots.map((menu) => {
          const current = menu.id === currentId;
          const { primary } = labelOf(menu);
          const body = <span title={primary} className="line-clamp-2 break-words">{primary}</span>;
          return !hasChildren(menu) ? (
            <Link key={menu.id} href={menu.path} aria-current={current ? "page" : undefined} className={cell(current)}>
              {body}
            </Link>
          ) : (
            <button
              key={menu.id}
              type="button"
              aria-expanded={sheet === menu.id}
              aria-current={current ? "true" : undefined}
              onClick={() => setSheet((s) => (s === menu.id ? null : menu.id))}
              className={cell(current)}
            >
              {body}
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, BAR_SLOTS - slots.length) }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden="true" />
        ))}
        <button
          type="button"
          aria-expanded={sheet === "more"}
          aria-current={currentInRest ? "true" : undefined}
          onClick={() => setSheet((s) => (s === "more" ? null : "more"))}
          className={cell(currentInRest)}
        >
          <span>
            {moreLabel} <span aria-hidden="true">▴</span>
          </span>
        </button>
      </nav>
    </>
  );
}
