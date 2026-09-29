"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import { useI18n } from "@/src/contexts/I18nContext";
import { isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { useReducedMotionDurations } from "@/src/hooks/useReducedMotionDurations";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { isMenuPathActive } from "@/src/lib/menuPath";
import { menuGlossParts } from "@/src/lib/menuI18n";
import { pillarIsWide } from "@/src/lib/pillar";
import { MOTION_EASINGS } from "@/lib/motion";

/**
 * 立柱(规范 v2 §四「柱」、补足 C13 / C14),替换 v1 的 200px 侧栏与 56px 编号栏。
 *
 * - 一级项与顺序都来自后端菜单(`useSidebarMenus`),不写死;有子项(DIRECTORY)的一级项
 *   是按钮,点开右侧 200px 的二级栏(s1 底、1px ink 框);没有子项的一级项本身是页面。
 * - 底色 pillar 四文明共用;只有**当前项**进匾色(onMain 字)。当前项的色块是当前项的子元素,
 *   用 motion 的 layoutId 从旧项移到新项(交互与动效第 2 轮 §三 3 推荐的方案 B:项高不固定时
 *   —— egy 横排、分组展开 —— 也落得准)。减少动态效果时时长为 0,色块直接出现。
 * - 任一项超过 4 个汉字或 8 个拉丁字符 → 整根横排 88(`src/lib/pillar.ts`)。
 * - 立柱里的焦点环用 `.focus-ring-pillar`(onMain、内缩 4):ink 环在近黑的立柱上会消失。
 * - 内容超出高度时整根纵向滚动;当前项在进入页面时滚进视野。
 * - 宽度 < 768 时立柱收成底栏(`BottomBar`),规则见那里。
 *
 * 标签:译名优先,中文原名在 title 里(`menuGlossParts`,与面包屑同一份对照)。
 * 这改了 v1「导航永远保持中文原文」的约定 —— C14 画的 egy 立柱就是译名,阈值也是按译名定的。
 */

export function useMenuLabel() {
  const { t, locale } = useI18n();
  return (menu: SidebarMenu) => {
    if (menu.path === "/") return { primary: t("nav.welcome") };
    return menuGlossParts(menu, locale, t);
  };
}

/** Which top-level item holds the current page — the one lit, and the one whose 二级 opens by default. */
export function groupOfPath(menus: readonly SidebarMenu[], pathname: string, allMenuPaths: readonly string[]): number | null {
  const holds = (m: SidebarMenu): boolean =>
    isMenuPathActive(pathname, m.path, allMenuPaths) || (m.children ?? []).some(holds);
  const i = menus.findIndex(holds);
  return i < 0 ? null : menus[i].id;
}

/** 当前项的匾色块。挂在当前项里;layoutId 相同,motion 把它从上一项位移过来。 */
function CurrentBlock({ id }: { id: string }) {
  const d = useReducedMotionDurations();
  return (
    <m.span
      aria-hidden="true"
      layoutId={id}
      transition={{ duration: d.base, ease: MOTION_EASINGS.standard }}
      className="absolute inset-0 bg-[oklch(var(--color-main))]"
    />
  );
}

const PILLAR_ITEM =
  "focus-ring-pillar relative flex w-full items-center text-[oklch(var(--color-on-main))] hover:bg-[oklch(var(--color-on-main)/0.08)]";
const VERTICAL = "h-12 justify-center text-xs [writing-mode:vertical-rl] tracking-[0.2em]";
const HORIZONTAL = "min-h-10 px-2 py-1 text-left text-2xs";

export function Pillar({
  menus,
  allMenuPaths,
  currentId,
  openId,
  onToggle,
}: {
  menus: readonly SidebarMenu[];
  allMenuPaths: readonly string[];
  /** 当前页所在的一级项。 */
  currentId: number | null;
  /** 二级栏打开的一级项。 */
  openId: number | null;
  onToggle: (id: number) => void;
}) {
  const { t } = useI18n();
  const labelOf = useMenuLabel();
  const wide = pillarIsWide(menus.map((m) => labelOf(m).primary));
  const open = menus.find((m) => m.id === openId && (m.children?.length || isDirectory(m)));
  const navLabel = t("nav.mobile_menu") === "nav.mobile_menu" ? "导航菜单" : t("nav.mobile_menu");

  return (
    <div className="flex h-full">
      <nav
        aria-label={navLabel}
        data-testid="pillar"
        data-wide={wide || undefined}
        className={`flex h-full flex-col overflow-y-auto bg-[oklch(var(--color-pillar))] ${wide ? "w-22" : "w-15"}`}
      >
        {menus.length === 0 ? (
          <p className="px-1 py-4 text-2xs text-[oklch(var(--color-on-main))]">{t("menus.no_menus")}</p>
        ) : null}
        {menus.map((menu) => (
          <PillarItem
            key={menu.id}
            menu={menu}
            label={labelOf(menu)}
            wide={wide}
            current={menu.id === currentId}
            open={menu.id === openId}
            onToggle={() => onToggle(menu.id)}
          />
        ))}
      </nav>
      {open ? <SecondaryColumn menu={open} allMenuPaths={allMenuPaths} /> : null}
    </div>
  );
}

function PillarItem({
  menu,
  label,
  wide,
  current,
  open,
  onToggle,
}: {
  menu: SidebarMenu;
  label: { primary: string; gloss?: string };
  wide: boolean;
  current: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const className = `${PILLAR_ITEM} ${wide ? HORIZONTAL : VERTICAL} ${current ? "font-semibold" : ""}`;
  const title = label.gloss ? `${label.primary} ${label.gloss}` : label.primary;
  const body = (
    <>
      {current ? <CurrentBlock id="pillar-current" /> : null}
      <span title={title} className={`relative ${wide ? "line-clamp-2" : ""}`}>{label.primary}</span>
    </>
  );

  if (!menu.children?.length && !isDirectory(menu)) {
    return (
      <Link
        ref={(el) => {
          ref.current = el;
        }}
        href={menu.path}
        prefetch={true}
        aria-current={current ? "page" : undefined}
        className={className}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      ref={(el) => {
        ref.current = el;
      }}
      type="button"
      aria-expanded={open}
      aria-current={current ? "true" : undefined}
      onClick={onToggle}
      className={className}
    >
      {body}
    </button>
  );
}

/** 二级栏:s1 底、1px ink 框;当前二级项 s2 底 + 3px 匾色竖条(匾色只在一级当前项与这条竖条上)。 */
function SecondaryColumn({ menu, allMenuPaths }: { menu: SidebarMenu; allMenuPaths: readonly string[] }) {
  const pathname = usePathname();
  const labelOf = useMenuLabel();
  return (
    <div
      data-testid="pillar-secondary"
      className="flex h-full w-50 flex-col overflow-y-auto border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))]"
    >
      <p className="border-b border-[oklch(var(--color-line))] px-3 py-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        {labelOf(menu).primary}
      </p>
      {(menu.children ?? []).map((child) => (
        <SecondaryLink key={child.id} menu={child} active={isMenuPathActive(pathname, child.path, allMenuPaths)} />
      ))}
    </div>
  );
}

function SecondaryLink({ menu, active, onNavigate }: { menu: SidebarMenu; active: boolean; onNavigate?: () => void }) {
  const labelOf = useMenuLabel();
  const { primary, gloss } = labelOf(menu);
  return (
    <Link
      href={menu.path}
      prefetch={true}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-8 items-center border-b border-[oklch(var(--color-line))] px-3 text-sm ${
        active
          ? "bg-[oklch(var(--color-surface-2))] font-semibold text-[oklch(var(--color-ink))] shadow-[inset_3px_0_0_oklch(var(--color-main))]"
          : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))]"
      }`}
    >
      <span title={gloss ? `${primary} ${gloss}` : primary} className="truncate">{primary}</span>
    </Link>
  );
}

/** 底栏的前几格;第 5 格固定是「更多」。 */
const BAR_SLOTS = 4;

/**
 * 宽度 < 768 时的立柱(补足 C13「393 底栏」):固定 5 格 —— 后端顺序里的前 4 个一级项 +「更多」。
 * 一级项是分组时,点它打开底部抽屉列出这组的页面;「更多」打开同一个抽屉,按分组列出其余全部项。
 * 当前项规则不变(匾色 + onMain);当前页落在「更多」里时,「更多」这一格是当前态,抽屉里那一项加粗。
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
  const cell = `focus-ring-pillar relative flex min-h-14 items-center justify-center px-1 text-center text-xs text-[oklch(var(--color-on-main))]`;

  return (
    <>
      <button
        type="button"
        aria-label={t("common.close")}
        tabIndex={sheet === null ? -1 : 0}
        className={`fixed inset-0 z-scrim bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-[opacity,visibility] duration-base md:hidden ${
          sheet !== null ? "visible opacity-100" : "invisible opacity-0"
        }`}
        onClick={close}
      />
      {sheet !== null ? (
        <aside
          ref={drawerRef}
          {...drawerProps}
          data-testid="bar-sheet"
          className="fixed inset-x-0 bottom-14 z-sidebar max-h-[70vh] overflow-y-auto border-t border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] md:hidden"
        >
          <div className="flex items-center justify-between border-b border-[oklch(var(--color-line))] px-4 py-2">
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{sheetLabel}</span>
            <button type="button" onClick={close} className="min-h-11 px-2 text-sm text-[oklch(var(--color-ink))] underline">
              {t("common.close")}
            </button>
          </div>
          {sheetGroups.map((group) =>
            group.children?.length || isDirectory(group) ? (
              <section key={group.id}>
                <p className="px-4 pt-3 pb-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{labelOf(group).primary}</p>
                {(group.children ?? []).map((child) => (
                  <SecondaryLink
                    key={child.id}
                    menu={child}
                    active={isMenuPathActive(pathname, child.path, allMenuPaths)}
                    onNavigate={close}
                  />
                ))}
              </section>
            ) : (
              <SecondaryLink
                key={group.id}
                menu={group}
                active={isMenuPathActive(pathname, group.path, allMenuPaths)}
                onNavigate={close}
              />
            )
          )}
        </aside>
      ) : null}
      <nav
        aria-label={sheetLabel}
        data-testid="bottom-bar"
        className="fixed inset-x-0 bottom-0 z-sidebar grid grid-cols-5 bg-[oklch(var(--color-pillar))] md:hidden"
      >
        {slots.map((menu) => {
          const current = menu.id === currentId;
          const { primary } = labelOf(menu);
          const body = (
            <>
              {current ? <CurrentBlock id="bar-current" /> : null}
              <span title={primary} className={`relative line-clamp-2 break-words ${current ? "font-semibold" : ""}`}>{primary}</span>
            </>
          );
          return !menu.children?.length && !isDirectory(menu) ? (
            <Link key={menu.id} href={menu.path} aria-current={current ? "page" : undefined} className={cell}>
              {body}
            </Link>
          ) : (
            <button
              key={menu.id}
              type="button"
              aria-expanded={sheet === menu.id}
              aria-current={current ? "true" : undefined}
              onClick={() => setSheet((s) => (s === menu.id ? null : menu.id))}
              className={cell}
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
          className={cell}
        >
          {currentInRest ? <CurrentBlock id="bar-current" /> : null}
          <span className={`relative ${currentInRest ? "font-semibold" : ""}`}>
            {moreLabel} <span aria-hidden="true">▴</span>
          </span>
        </button>
      </nav>
    </>
  );
}
