"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useSidebarMenus, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { useHallCivilization } from "@/src/components/plaque/useHall";
import { useDrawerA11y } from "@/src/components/layout/useDrawerA11y";
import { useOverflowEnd } from "@/src/hooks/useOverflowEnd";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { menuGlossParts } from "@/src/lib/menuI18n";
import { DOOR_ICON, type DoorNavKey } from "@soulledger/core/domain/doors";
import { DOORS, doorFor, doorHref, doorsFor, doorTabs, pageOf, type DoorId, type DoorPage, type Viewer } from "@/src/lib/doors";
import s from "./doors.module.css";

/** 品牌字标。一直是字面量:它是标的一部分,不随界面语言换。 */
export const BRAND_WORD = "灵魂簿";

/** 「我」的几页:不属于任何门,门栏底部的头像(窄屏最后一格)点亮。 */
const ME_PATHS = ["/profile", "/notifications", "/welcome", "/about"];

/**
 * 门格上的图形(第三十八批):中文是门上的字(18 的宋体单字,`caseDesk.rail.<key>_glyph`);英文与 egy 是 24 的线条图标
 * (`DOOR_ICON`,第三十批第 4 步那一套),下面一行都是门名(`nav.doors.<key>.label`)。一个字母、几个字母的缩写都要学,
 * 图标配一个完整的词不用学,所以 en / egy 的门字不再画。
 */
export function DoorIcon({ door, className }: { door: DoorNavKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? s.doorIcon} aria-hidden="true" data-testid="door-icon" data-icon={door}>
      {DOOR_ICON[door].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** 门格的上半:中文写字,别的语言画图标。 */
function DoorMark({ door, glyphKey, zh }: { door: DoorNavKey; glyphKey: string; zh: boolean }) {
  const { t } = useI18n();
  if (!zh) return <DoorIcon door={door} />;
  return (
    <span className={s.doorGlyph} aria-hidden="true" data-testid="desk-door-glyph">
      {t(glyphKey)}
    </span>
  );
}

/** 这个人(门、门内的页由它决定):角色、读码、菜单里的页。 */
export function useDoorViewer(): { viewer: Viewer; doors: DoorId[]; menus: SidebarMenu[] } {
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const { data: menus = [] } = useSidebarMenus();
  const menuPaths = useMemo(() => {
    const out = new Set<string>();
    const walk = (items: readonly SidebarMenu[]) => {
      for (const m of items) {
        if (m.path) out.add(m.path);
        if (m.children?.length) walk(m.children);
      }
    };
    walk(menus);
    return out;
  }, [menus]);
  const viewer: Viewer = { role: user?.role, extraRoles: user?.extra_roles, isAdmin, hasPermission, menuPaths };
  return { viewer, doors: doorsFor(viewer), menus };
}

function findMenu(menus: readonly SidebarMenu[], path: string): SidebarMenu | null {
  for (const m of menus) {
    if (m.path === path) return m;
    const hit = m.children?.length ? findMenu(m.children, path) : null;
    if (hit) return hit;
  }
  return null;
}

/** 一页的标签:借住在别的门里、有借住名的用借住名;菜单项用菜单自己的名字(译名;与面包屑同一份对照),别的用表里的键。 */
function usePageLabel(menus: readonly SidebarMenu[], door?: DoorId | null) {
  const { t, locale } = useI18n();
  const civ = useHallCivilization();
  return (page: DoorPage): string => {
    if (door && door !== page.door && page.altLabelKey) return t(page.altLabelKey);
    const menu = findMenu(menus, page.path);
    if (menu) return menuGlossParts(menu, locale, t, civ).primary;
    return page.labelKey ? t(page.labelKey) : page.path;
  };
}

/** 当前网址在这个人的门里落在哪一门;「我」的几页与表外的页是 null。 */
function currentDoor(pathname: string, doors: readonly DoorId[]): DoorId | null {
  const page = pageOf(pathname);
  return page ? doorFor(page, doors) : null;
}

/**
 * 门栏(全站唯一的导航,取代旧的侧栏与底栏):桌面 64 宽立在左边,自上而下 品牌标 · 这个人的门 · 底部头像「我」;
 * ≤ 768 到底部,是门 +「我」—— 殿司在窄屏不放门,只读收进「我」的抽屉。
 * 窄屏顶栏不画用户菜单(fe-mobile 3.1:「我」只留一处),所以用户菜单的几样 —— 语言、设置、关于、退出 —— 也在「我」的抽屉里;
 * 设置与退出的状态在 AppLayout,经 `onSettings` / `onLogout` 交进来(没登录时不给,抽屉里也就没有这几行)。
 */
export function DoorRail({ onSettings, onLogout }: { onSettings?: () => void; onLogout?: () => void } = {}) {
  const { t, locale } = useI18n();
  const zh = locale === "zh-Hans";
  const pathname = usePathname();
  const { user } = useTenant();
  const { viewer, doors, menus } = useDoorViewer();
  const label = usePageLabel(menus);
  const here = currentDoor(pathname, doors);
  const onMe = ME_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const name = user?.display_name || user?.username || "";

  const [sheet, setSheet] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setSheet(false);
  }
  const close = () => setSheet(false);
  const { drawerRef, drawerProps } = useDrawerA11y<HTMLElement>({ open: sheet, onClose: close, label: t("nav.doors.me.label") });
  const officeTabs = doors.includes("office") ? doorTabs("office", viewer, doors) : [];

  const doorLink = (d: DoorId) => {
    const nav = DOORS[d].nav;
    const name = t(`nav.doors.${nav}.label`);
    return (
      <Link
        key={d}
        href={doorHref(d, viewer, doors)}
        className={`${s.door} ${d === "office" ? s.doorWide : ""}`}
        aria-current={here === d ? "page" : undefined}
        aria-label={name}
        data-door={d}
      >
        <DoorMark door={nav} glyphKey={`caseDesk.rail.${DOORS[d].key}_glyph`} zh={zh} />
        <span className={`${s.doorLabel} ${zh ? "" : s.doorLabelWord}`} aria-hidden="true" data-testid="door-label">
          {name}
        </span>
        {/* 悬停提示(`.title`,如 Hall office):只在宽屏的门栏,400ms 后出现。读屏器读 aria-label,这一块不读。 */}
        <span className={s.tip} aria-hidden="true" data-testid="door-tip">
          {t(`nav.doors.${nav}.title`)}
        </span>
      </Link>
    );
  };

  return (
    <>
      {sheet ? (
        <>
          <button type="button" aria-label={t("common.close")} className={s.scrim} onClick={close} />
          <aside ref={drawerRef} {...drawerProps} className={s.sheet} data-testid="me-sheet">
            <Link href="/profile" className={s.sheetLink} aria-current={pathname === "/profile" ? "page" : undefined}>
              {t("profile.title")}
            </Link>
            <Link href="/notifications" className={s.sheetLink} aria-current={pathname === "/notifications" ? "page" : undefined}>
              {t("notifications.title")}
            </Link>
            {onSettings && onLogout ? (
              <>
                <div className={s.sheetRow}>
                  <span>{t("nav.language")}</span>
                  <LanguageSwitcher />
                </div>
                <button type="button" className={s.sheetLink} onClick={() => { close(); onSettings(); }}>
                  {t("nav.settings")}
                </button>
                <Link href="/about" className={s.sheetLink} aria-current={pathname === "/about" ? "page" : undefined}>
                  {t("about.title")}
                </Link>
              </>
            ) : null}
            {officeTabs.length ? (
              <section aria-labelledby="me-sheet-office">
                <p id="me-sheet-office" className={s.sheetHead}>
                  {t("doors.office_read_only")}
                </p>
                {officeTabs.map((p) => (
                  <Link key={p.path} href={p.path} className={s.sheetLink} aria-current={pageOf(pathname)?.path === p.path ? "page" : undefined}>
                    {label(p)}
                  </Link>
                ))}
              </section>
            ) : null}
            {onLogout ? (
              <button type="button" className={`${s.sheetLink} ${s.sheetDanger}`} onClick={() => { close(); onLogout(); }} data-testid="me-sheet-logout">
                {t("auth.logout")}
              </button>
            ) : null}
          </aside>
        </>
      ) : null}
      <nav className={s.rail} aria-label={t("caseDesk.rail.label")} data-testid="door-rail">
        <span className={s.railMark}>
          <BrandMark size={28} tone="gold" label={BRAND_WORD} />
        </span>
        {doors.map(doorLink)}
        {/* 窄屏最后一格:「我」(本人与设置;管理员的殿司只读也在这里)。宽屏是底部的头像。 */}
        <button
          type="button"
          className={`${s.door} ${s.doorNarrow}`}
          aria-label={t("nav.doors.me.label")}
          aria-expanded={sheet}
          aria-current={onMe || (here === "office" && !sheet) ? "true" : undefined}
          onClick={() => setSheet((o) => !o)}
          data-testid="door-me"
        >
          <DoorMark door="me" glyphKey="caseDesk.rail.me_glyph" zh={zh} />
          <span className={`${s.doorLabel} ${zh ? "" : s.doorLabelWord}`} aria-hidden="true" data-testid="door-label">
            {t("nav.doors.me.label")}
          </span>
        </button>
        <div className={s.railFoot}>
          {/* 头像:中文写姓名首字;en / egy 画「我」的图标(18,描边 1.7)—— 姓名可能是汉字,首字在英文界面里读不出。 */}
          <Link href="/profile" className={s.me} title={name} aria-label={t("nav.doors.me.label")} aria-current={onMe ? "page" : undefined}>
            {zh ? <span aria-hidden="true">{[...name][0] ?? "·"}</span> : <DoorIcon door="me" className={s.meIcon} />}
          </Link>
        </div>
      </nav>
    </>
  );
}

/** 当前门里、这个人看得见的页,按节分好;门栏下的页签条与窄屏顶栏的「页名 ▾」读同一份。 */
export function useDoorPages() {
  const pathname = usePathname();
  const { viewer, doors, menus } = useDoorViewer();
  const door = currentDoor(pathname, doors);
  const label = usePageLabel(menus, door);
  const tabs = door ? doorTabs(door, viewer, doors) : [];
  const sections = tabs.reduce<DoorPage[][]>((out, p) => {
    const last = out[out.length - 1];
    if (last && last[0].section === p.section) last.push(p);
    else out.push([p]);
    return out;
  }, []);
  /** 只有一页的门不画(没得选)。 */
  const show = !!door && tabs.length > 1;
  return { door, show, sections, label, active: pageOf(pathname)?.path };
}

/**
 * 门内的二级导航:当前门里、这个人看得见的页,一行,放不下横滑;门里不止一节时节前写节名。
 * 只有一页的门不画(没得选)。画出来时把自己的高写进 `--door-tabs-on`;globals.css 由它算 `--door-tabs-h`
 * (≤ 768 归 0:那里不画这一条,门内换页是顶栏的「页名 ▾」抽屉,`DoorPagePicker`)。内容槽位与案卷台照它让出高度。
 */
export function DoorTabs() {
  const { t } = useI18n();
  const { door, show, sections, label, active } = useDoorPages();
  const tabsRef = useOverflowEnd<HTMLElement>();

  useEffect(() => {
    if (!show) return;
    document.documentElement.style.setProperty("--door-tabs-on", "45px");
    return () => {
      document.documentElement.style.removeProperty("--door-tabs-on");
    };
  }, [show]);

  if (!show || !door) return null;
  return (
    <nav ref={tabsRef} className={s.tabs} aria-label={t(`nav.doors.${DOORS[door].nav}.label`)} data-testid="door-tabs" data-door={door}>
      {sections.map((group) => {
        const name = t(`doors.section.${group[0].section}`);
        return (
        <div key={group[0].section} className={s.section}>
          {/* 节名与它的第一页同名(「案卷台 · 案卷台」)时不写:读起来是重复,分节靠节间的竖线已经看得出。 */}
          {sections.length > 1 && name !== label(group[0]) ? <span className={s.sectionName}>{name}</span> : null}
          {group.map((p) => (
            <Link key={p.path} href={p.path} className={s.tab} aria-current={active === p.path ? "page" : undefined}>
              {label(p)}
            </Link>
          ))}
        </div>
        );
      })}
    </nav>
  );
}

/**
 * 窄屏(≤ 768)顶栏中间的「当前页名 ▾」(fe-mobile 3.1):点开从底部升起一张抽屉,按节分组列出门里的页,
 * 每行 48 高、15 px,当前页左侧 2 px 文明色线 —— 与「我」的抽屉同一个样子、同一个 `useDrawerA11y`。
 * 「审」门 10 页一屏列完,不用横滑。只有一页的门、不在门里的页不画(AppLayout 那时照旧画面包屑)。
 */
export function DoorPagePicker() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { door, show, sections, label, active } = useDoorPages();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  const close = () => setOpen(false);
  const doorName = door ? t(`nav.doors.${DOORS[door].nav}.label`) : "";
  const { drawerRef, drawerProps } = useDrawerA11y<HTMLElement>({ open, onClose: close, label: doorName });
  if (!show || !door) return null;
  const current = sections.flat().find((p) => p.path === active);
  return (
    <>
      <button
        type="button"
        className={s.picker}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        data-testid="door-page-picker"
      >
        <span className={s.pickerName}>{current ? label(current) : doorName}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <>
          <button type="button" aria-label={t("common.close")} className={s.scrim} onClick={close} />
          <aside ref={drawerRef} {...drawerProps} className={s.sheet} data-testid="door-page-sheet" data-door={door}>
            {sections.map((group) => (
              <section key={group[0].section} aria-labelledby={`door-sheet-${group[0].section}`}>
                <p id={`door-sheet-${group[0].section}`} className={s.sheetHead}>
                  {t(`doors.section.${group[0].section}`)}
                </p>
                {group.map((p) => (
                  <Link key={p.path} href={p.path} className={s.sheetLink} aria-current={active === p.path ? "page" : undefined}>
                    {label(p)}
                  </Link>
                ))}
              </section>
            ))}
          </aside>
        </>
      ) : null}
    </>
  );
}
