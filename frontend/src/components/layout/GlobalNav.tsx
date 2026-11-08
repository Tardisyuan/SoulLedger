"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { useI18n } from "@/src/contexts/I18nContext";
import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { isMenuPathActive } from "@/src/lib/menuPath";
import { useMenuIcon } from "@/src/lib/menuIcons";
import { menuGlossParts } from "@/src/lib/menuI18n";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Seal } from "@/src/components/plaque/Seal";
import { useHallCivilization, useRealm } from "@/src/components/plaque/useHall";
import { useTenant } from "@/src/contexts/TenantContext";
import { tenantLabel } from "@/src/lib/domainNames";
import { navSections, type NavSectionId } from "@/src/lib/navSections";
import { isMac, requestSearchOpen } from "@/src/components/layout/GlobalSearchEntry";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { judgmentAppealKeys, judgmentAppealsApi, type UserRole } from "@soulledger/core/api";

/**
 * 全局导航(规范 v3 外框),取代 v2 的近黑立柱与 200px 弹出二级栏。
 *
 * - 规范 v4(第七批 S01):底是文明的侧栏色 `--color-side`,右侧 1px line。自上而下:品牌 → 殿司卡
 *   (`shell.hall_switch`,带文明印)→「搜索、跳转、下指令 ⌘K」→ 工作 / 灵魂 / 系统三组(`navSections`)
 *   → 底部用户卡。收起按钮在品牌行右端:平时透明、指针进侧栏 120ms 淡入,窄屏(< 1024)与触屏常显。
 * - 当前项:3px 左标(`--color-metal`,v4 `.side .it.on::before`;深色 solid 对 surface-1 只有约 2:1)
 *   + `.nav-current` 的底(深色 glow 20%,浅色 card 底加卡片阴影,globals.css),字 ink 600。
 *   这条 3px 是导航,不是表格行 ——「3px = 待我处理」那条说的是行。
 * - 一级项与顺序、图标都来自后端菜单(`useSidebarMenus`;`menu.icon` 是 lucide 图标名,
 *   见 IconPicker)。不认得的图标名落回一个中性方块,不按路径写死。
 * - 有子项的一级项是手风琴:原位展开,同一时刻只开一组,当前页所在组默认打开(状态在 AppLayout)。
 * - 收起(68px)时只剩图标;有子项的组点开一个浮出层列出它的页面 —— 子页面不能因为收起就够不着。
 * - 四档宽度:≥ 1200 展开 252 / 收起 68 由用户选(`localStorage["soulledger-nav-mode"]`,`[` 或 ⌘\ 切换;
 *   v4 画的是 248 / 64,这里不跟:问一问推开与否按 252 / 68 量过,E2E 钉着);
 *   769–1199 强制收起(给审判台的 600px 裁决栏留地方);≤ 768 没有侧栏,是底栏(`BottomBar`)。
 * - 焦点环用全站的 ink 环 —— 导航现在是浅底。v2 立柱的 `.focus-ring-pillar`(onMain 内缩环)
 *   随立柱、匾上的面包屑与操作一起没有了调用点,已从 globals.css 删除。
 *
 * 标签:译名优先,中文原名在 title 里(`menuGlossParts`,与面包屑同一份对照)。
 */

export function useMenuLabel() {
  const { t, locale } = useI18n();
  const civ = useHallCivilization();
  return (menu: SidebarMenu) => {
    if (menu.path === "/") return { primary: t("nav.welcome") };
    return menuGlossParts(menu, locale, t, civ);
  };
}

/** Which top-level item holds the current page — the one lit, and the one whose group opens by default. */
export function groupOfPath(menus: readonly SidebarMenu[], pathname: string, allMenuPaths: readonly string[]): number | null {
  const holds = (m: SidebarMenu): boolean =>
    isMenuPathActive(pathname, m.path, allMenuPaths) || (m.children ?? []).some(holds);
  const i = menus.findIndex(holds);
  return i < 0 ? null : menus[i].id;
}

/**
 * 菜单图标:`menu.icon` 先查静态图标表(`src/lib/menuIcons.ts`:IconPicker 白名单 + 菜单迁移 / 夹具里的名字),
 * 查不到才按需异步载整套 lucide。此前每一页都异步下整套(783 KB / 199 KB gz,perf A1)。
 */
/** 菜单图标(16px)。不认得 → 中性方块,不按路径写死。 */
export function NavIcon({ icon }: { icon: string | null | undefined }) {
  const Icon = useMenuIcon(icon);
  return (
    <span aria-hidden="true" data-icon={icon || undefined} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      {Icon ? <Icon size={16} strokeWidth={1.6} /> : <span data-testid="nav-icon-fallback" className="inline-block h-2.5 w-2.5 border border-current" />}
    </span>
  );
}

// ── 导航模式 ────────────────────────────────────────────────────────────

export const NAV_MODE_KEY = "soulledger-nav-mode";
/** 品牌字标。一直是字面量(此前的「SoulLedger / 灵魂簿」两行也是):它是标的一部分,不随界面语言换。 */
export const BRAND_WORD = "灵魂簿";

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
export function useNavMode(transient = false) {
  const [mode, setMode] = useState<NavMode>("expanded");
  const forced = useForcedCollapse();
  // 编辑器里的那一次展开(浮层)。离开或进入编辑器时归零:不记(Design v4 第十四批取舍 1)。
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayFor, setOverlayFor] = useState(transient);
  if (overlayFor !== transient) {
    setOverlayFor(transient);
    setOverlayOpen(false);
  }
  useEffect(() => {
    try {
      if (window.localStorage.getItem(NAV_MODE_KEY) === "collapsed") setMode("collapsed");
    } catch {
      /* storage blocked: stay expanded */
    }
  }, []);

  const toggle = useCallback(() => {
    if (transient) {
      setOverlayOpen((o) => !o);
      return;
    }
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
  }, [forced, transient]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey) return;
      // ⌘\ / Ctrl \(v4):修饰键组合,在输入框里也接。
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key !== "[" || e.metaKey || e.ctrlKey) return;
      if (isEditable(e.target)) return;
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const close = useCallback(() => setOverlayOpen(false), []);
  if (transient) return { mode, forced: false, collapsed: !overlayOpen, overlay: overlayOpen, close, toggle };
  return { mode, forced, collapsed: forced || mode === "collapsed", overlay: false, close, toggle };
}

/**
 * 审批流编辑器(Design v4 第十四批取舍 1):挂载期间侧栏一律收成图标栏,展开时以浮层盖在画布上、不挤画布;
 * 不记上次的展开(`useNavMode(transient)`)。全站「1200 以下才锁定收起」在这里不适用。壳外(测试)什么都不做。
 */
const EditorNavContext = createContext<(on: boolean) => void>(() => {});
export const EditorNavProvider = EditorNavContext.Provider;
export function useEditorNav(on: boolean): void {
  const set = useContext(EditorNavContext);
  useEffect(() => {
    if (!on) return;
    set(true);
    return () => set(false);
  }, [set, on]);
}

// ── 侧栏 ────────────────────────────────────────────────────────────────

/** 当前项:3px metal 标(侧栏在左、底栏在顶)+ `.nav-current` 的底(globals.css:深色 glow 20%,浅色 card + 卡片阴影)。字一律 ink。 */
const CURRENT_BG = "nav-current";
function CurrentMark() {
  return <span aria-hidden="true" data-testid="nav-current-mark" className="absolute inset-y-1.5 left-0 w-[3px] bg-[oklch(var(--color-metal))]" />;
}
/** 底栏当前项的标:同一条 3px metal,横在格子顶上。 */
function BarMark() {
  return <span aria-hidden="true" data-testid="bar-current-mark" className="absolute inset-x-2 top-0 h-[3px] bg-[oklch(var(--color-metal))]" />;
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
  mode,
}: {
  menus: readonly SidebarMenu[];
  allMenuPaths: readonly string[];
  /** 当前页所在的一级项(`navSections` 拆开之后的那一层,见 `navItems`)。 */
  currentId: number | null;
  /** 手风琴里展开的那一组。 */
  openId: number | null;
  onToggle: (id: number) => void;
  collapsed: boolean;
  user?: { display_name?: string; username: string; role: UserRole } | null;
  /** 收起按钮(`useNavMode` 的结果);不给就不画按钮(测试单独渲染侧栏时)。 */
  mode?: { forced: boolean; toggle: () => void };
}) {
  const { t } = useI18n();
  const labelOf = useMenuLabel();
  const pathname = usePathname();
  const navLabel = t("nav.mobile_menu") === "nav.mobile_menu" ? "导航菜单" : t("nav.mobile_menu");
  const name = user ? user.display_name || user.username : "";
  const sections = navSections(menus);
  const canSwitchHall = menus.some(function holdsHalls(m): boolean {
    return m.path === HALLS_PATH || (m.children ?? []).some(holdsHalls);
  });

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
      className={`group/side flex h-full flex-col overflow-hidden border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-side))] data-animate:transition-[width] data-animate:duration-base data-animate:ease-enter ${
        collapsed ? "w-17" : "w-63"
      }`}
    >
      {/* 品牌位(A9 §一):天平标 24 加「灵魂簿」,高 56(17/600 不在八档字号里,取 md 15/600)。
          收起时只留标(标自己带名字),收起按钮落到标下面一行。 */}
      <div data-nav-brand="" className={`flex h-14 shrink-0 items-center gap-2 ${collapsed ? "justify-center" : "pl-4 pr-2"}`}>
        <BrandMark size={24} label={collapsed ? BRAND_WORD : undefined} />
        {collapsed ? null : <span className="min-w-0 flex-1 font-title text-md text-[oklch(var(--color-ink))]">{BRAND_WORD}</span>}
        {mode && !collapsed ? <CollapseButton mode={mode} collapsed={collapsed} /> : null}
      </div>
      {mode && collapsed ? (
        <div className="flex shrink-0 justify-center pb-1">
          <CollapseButton mode={mode} collapsed={collapsed} />
        </div>
      ) : null}

      {user ? <HallCard collapsed={collapsed} canSwitch={canSwitchHall} /> : null}
      {user ? <SearchHint collapsed={collapsed} /> : null}

      <nav aria-label={navLabel} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {menus.length === 0 ? <p className="px-2 py-4 text-2xs text-[oklch(var(--color-ink-muted))]">{t("menus.no_menus")}</p> : null}
        {sections.map((section) => (
          <div key={section.id} role="group" aria-labelledby={`nav-section-${section.id}`} data-nav-section={section.id}>
            <SectionHeading id={section.id} collapsed={collapsed} />
            {section.items.map((menu) =>
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
          </div>
        ))}
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
      {!collapsed && menu.path === APPEALS_PATH ? <AppealPendingCount /> : null}
    </Link>
  );
}

const HALLS_PATH = "/halls";
const SIDE_IDLE = "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-canvas))] hover:text-[oklch(var(--color-ink))]";

/** 组标题(`nav.group.*`):11 字、字距 .08em、ink-muted。收起时只给读屏(组仍有名字,只是不占地方)。 */
function SectionHeading({ id, collapsed }: { id: NavSectionId; collapsed: boolean }) {
  const { t } = useI18n();
  return (
    <p
      id={`nav-section-${id}`}
      className={collapsed ? "sr-only" : "px-3 pt-3 pb-1 text-2xs tracking-label text-[oklch(var(--color-ink-muted))]"}
    >
      {t(`nav.group.${id}`)}
    </p>
  );
}

/**
 * 收起 / 展开侧栏(`nav.collapse_sidebar` / `nav.expand_sidebar`,v4 S01)。展开时在品牌行右端,
 * 无边框、平时透明,指针进侧栏或获焦时 120ms 淡入;< 1024 与触屏常显(那里没有「指针进来」)。
 * 769–1199 被宽度强制收起:按钮在、不可用,名字说出原因(`nav.collapse_locked`)。`[` 与 ⌘\ 同一个开关。
 */
function CollapseButton({ mode, collapsed }: { mode: { forced: boolean; toggle: () => void }; collapsed: boolean }) {
  const { t } = useI18n();
  const label = mode.forced ? t("nav.collapse_locked") : collapsed ? t("nav.expand_sidebar") : t("nav.collapse_sidebar");
  return (
    <button
      type="button"
      data-testid="nav-toggle"
      aria-controls="global-nav"
      aria-expanded={!collapsed}
      aria-disabled={mode.forced || undefined}
      aria-label={label}
      aria-keyshortcuts="[ Meta+\ Control+\"
      title={mode.forced ? label : `${label} ([ · ${isMac() ? "⌘\\" : "Ctrl \\"})`}
      onClick={mode.toggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control transition-opacity duration-fast ${
        collapsed ? "" : "opacity-0 group-hover/side:opacity-100 focus-visible:opacity-100 max-[1023.98px]:opacity-100 pointer-coarse:opacity-100"
      } ${
        mode.forced
          ? "cursor-not-allowed bg-[oklch(var(--color-disabled-surface))] text-[oklch(var(--color-disabled-ink))]"
          : SIDE_IDLE
      }`}
    >
      {collapsed ? <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={1.5} /> : <PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.5} />}
    </button>
  );
}

/**
 * 殿司卡(v4 S01,`shell.hall_switch`):文明印 + 此刻所在的殿(进殿查看时是所进的殿)+ 文明名。
 * 能进别的殿的人(菜单里有「各殿概况」= 全局管理员)点它去 `/halls` 挑一殿进入;别人只是一张卡,不是按钮 ——
 * 不画一扇打不开的门。底:深色 glow 14% 混进 card,浅色 card + 卡片阴影(`.nav-hall-card`)。
 */
function HallCard({ collapsed, canSwitch }: { collapsed: boolean; canSwitch: boolean }) {
  const { t } = useI18n();
  const realm = useRealm();
  const tenant = useTenant().user?.tenant;
  const civName = tenantLabel(t, tenant);
  const body = (
    <>
      <Seal size={28} />
      {collapsed ? null : (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-xs font-medium text-[oklch(var(--color-ink))]" title={realm}>{realm}</span>
          <span className="block truncate text-2xs text-[oklch(var(--color-ink-muted))]" title={civName}>{civName}</span>
        </span>
      )}
      {collapsed || !canSwitch ? null : (
        <span aria-hidden="true" className="shrink-0 text-sm text-[oklch(var(--color-ink-muted))]">⇅</span>
      )}
    </>
  );
  const box = `nav-hall-card mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-panel ${collapsed ? "justify-center p-1" : "p-2"}`;
  return canSwitch ? (
    <Link
      href={HALLS_PATH}
      data-testid="hall-switch"
      aria-label={collapsed ? t("shell.hall_switch") : undefined}
      title={t("shell.hall_switch")}
      className={`${box} hover:text-[oklch(var(--color-ink))]`}
    >
      {body}
      {collapsed ? null : <span className="sr-only">{t("shell.hall_switch")}</span>}
    </Link>
  ) : (
    <div data-testid="hall-card" className={box}>
      {body}
    </div>
  );
}

/** 「搜索、跳转、下指令 ⌘K」(`nav.search_hint`):打开同一个命令面板(`GlobalSearch`)。收起时只剩放大镜。 */
function SearchHint({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const label = t("nav.search_hint");
  return (
    <button
      type="button"
      data-testid="nav-search-hint"
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      aria-label={collapsed ? label : undefined}
      title={label}
      onClick={() => requestSearchOpen()}
      className={`relative mx-2 mb-1 flex min-h-9 shrink-0 items-center rounded-control text-xs transition-colors duration-fast ${collapsed ? "justify-center" : "gap-2 px-3"} ${SIDE_IDLE}`}
    >
      <Search aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0" />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate text-left" title={label}>{label}</span>
          <kbd className="shrink-0 rounded-control px-1 font-mono text-2xs text-[oklch(var(--color-ink-muted))] shadow-[inset_0_0_0_1px_oklch(var(--color-line-strong))]">
            {isMac() ? "⌘K" : "Ctrl K"}
          </kbd>
        </>
      )}
    </button>
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
      {menu.path === APPEALS_PATH ? <AppealPendingCount /> : null}
    </Link>
  );
}

const APPEALS_PATH = "/judgment/appeals";

/**
 * 「申诉复核」后面的待复核数(第五十二批 W-1)。只在那一项画出来时才挂上 —— 看得见这条菜单的人才有
 * `judgment.read`,别的人不发这一次请求。0 不画。
 */
function AppealPendingCount() {
  const { data } = useQuery({
    queryKey: [...judgmentAppealKeys.all, "pending-count"],
    queryFn: () => judgmentAppealsApi.list({ status: "PENDING", page_size: "1" }).then((r) => r.data.count),
    staleTime: 60_000,
  });
  return data ? (
    <span data-testid="appeal-pending-count" className="shrink-0 font-mono text-2xs tabular-nums text-[oklch(var(--color-ink-muted))]">
      {data}
    </span>
  ) : null;
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
            className="w-56 rounded-panel shadow-overlay border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-1 focus:outline-hidden"
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
 * 中性底(surface-1、上沿 1px line);当前格是 ink 字 600 + 8% main 底 + 3px main 顶标(main 不作字色,Design 第六十三批)。当前页落在「更多」里时,
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
  // 当前项与侧栏同一套:ink 字 600、8% 底,外加 3px main 顶标(Design 第六十三批:main 不作字色;
  // 顶标是非文字,对 surface-1 ≥ 3:1,见 inkOnSurfaceContract)。
  const cell = (current: boolean) =>
    `relative flex min-h-14 items-center justify-center px-1 text-center text-xs ${current ? CURRENT : "text-[oklch(var(--color-ink-muted))]"}`;

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
              {current ? <BarMark /> : null}
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
              {current ? <BarMark /> : null}
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
          {currentInRest ? <BarMark /> : null}
          <span>
            {moreLabel} <span aria-hidden="true">▴</span>
          </span>
        </button>
      </nav>
    </>
  );
}
