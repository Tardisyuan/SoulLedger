"use client";

import React, { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { LazyMotion, domMax } from "motion/react";
import { notificationsApi, type Notification } from "@soulledger/core/api";
import { notificationKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@soulledger/core/api";
import { SettingsDrawer } from "@/src/components/settings/SettingsDrawer";
import { ConnectionBanner, useConnectionBannerShown } from "@/src/components/connection-status";
import { useSidebarMenus, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { Breadcrumb, useBreadcrumbs } from "@/src/components/layout/Breadcrumb";
import { BottomBar, GlobalNav, groupOfPath, useNavMode } from "@/src/components/layout/GlobalNav";
import { LogoutConfirmDialog } from "@/src/components/layout/LogoutConfirmDialog";
import { GlobalSearch } from "@/src/components/layout/GlobalSearch";
import { Plaque, PlaqueProvider, shortBandFor, type PlaqueText } from "@/src/components/plaque/Plaque";
import { useTheme } from "@/src/contexts/ThemeContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Bell, PanelLeftClose, PanelLeftOpen } from "lucide-react";
// 「问一问」的推开只在 ≥ 1024 px(canvas 1a),且主内容区让出 420 后仍有 720(Design E 组);否则它是覆盖层。
import { useWideViewport } from "@/src/hooks/useWideViewport";
import { useRoomBeside } from "@/src/hooks/useRoomBeside";
import { OfficerAssistEntry, OfficerAssistPanel } from "@/src/components/assist/OfficerAssist";
import { useOfficerAssist } from "@/src/components/assist/useOfficerAssist";

/**
 * The shell, 规范 v3:左侧中性导航(`GlobalNav`,252 / 68)+ 内容栏。内容栏自上而下:
 * 52px 中性工具条(`global-topbar`:导航开合、面包屑;右边问一问、通知、用户菜单)、
 * 身份带(`Plaque`,v3 IdentityBand —— 品牌、印、殿名、题字、文明纹样;不放面包屑与操作)、页面。
 *
 * - 四档宽度:≥ 1200 导航展开 / 收起由用户选;769–1199 强制收起;≤ 768 没有侧栏,
 *   是底栏(`BottomBar`:前 4 个一级项 +「更多」底部抽屉)。规则在 `GlobalNav.tsx`。
 * - 工具条吸顶;身份带吸在它下沿,页面滚过 60px 收成 48px(PageShell 的筛选栏吸在两者
 *   下沿,`--below-band` = 52 + 身份带此刻的高度)。
 * - 连接状态只在断开时出现,是视口最顶上横跨整个视口(含导航与问一问面板)的一条警示条
 *   (`ConnectionBanner`,Design E 组:它是全局状态),浮在内容上,不推动内容。
 * - 语言 / 主题 / 设置 / 退出在用户菜单里(brief §4.4)。
 */
/** 问一问 pushed panel (canvas 1a) and the room the page keeps beside it (Design E 组). */
export const ASSIST_PANEL_WIDTH = 420;
export const ASSIST_MIN_MAIN_WIDTH = 720;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t, formatDateTime } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  // The main column (everything right of the nav) must keep 720 px beside the pushed
  // 420 px panel — Design E 组. Measured, not a media query: the nav is 252 or 68 wide by
  // the user's choice, so no single viewport width says how much room there is. (At 1440
  // expanded the column is 1188 → pushed; at 1260 expanded it is 1008 → overlay, and
  // collapsing the nav gives the push back.)
  const mainBoxRef = useRef<HTMLElement>(null);
  const roomy = useRoomBeside(mainBoxRef, ASSIST_PANEL_WIDTH + ASSIST_MIN_MAIN_WIDTH);
  const wide = useWideViewport() && roomy;
  const assist = useOfficerAssist(wide);
  const bannerShown = useConnectionBannerShown();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (err) { console.error("Logout failed:", err); }
    queryClient.invalidateQueries({ queryKey: ["menus-sidebar"] });
    logout();
    router.push("/");
  };

  const { data: menus = [] } = useSidebarMenus();

  // Every non-empty menu path, flattened: `isMenuPathActive` lights an ancestor
  // only when no more specific menu item also matches (/social vs /social/follows).
  const allMenuPaths = useMemo(() => {
    const out: string[] = [];
    const walk = (items: readonly SidebarMenu[]) => {
      for (const item of items) {
        if (item.path) out.push(item.path);
        if (item.children?.length) walk(item.children);
      }
    };
    walk(menus);
    return out;
  }, [menus]);

  // 手风琴:当前页所在的一级项默认打开;导航落进另一组时跟过去。点当前打开的那一项收起。
  const currentGroup = useMemo(() => groupOfPath(menus, pathname, allMenuPaths), [menus, pathname, allMenuPaths]);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const nav = useNavMode();
  const [openFor, setOpenFor] = useState<number | null>(null);
  if (currentGroup !== openFor) {
    setOpenFor(currentGroup);
    setOpenGroup(currentGroup);
  }
  const crumbs = useBreadcrumbs(menus);
  // 页面经 `usePlaque` 报的题字 / 殿名 / 右栏优先;没报的退回面包屑末段与租户名。
  const [plaque, setPlaque] = useState<PlaqueText | null>(null);
  const title = plaque?.title ?? (crumbs.length ? crumbs[crumbs.length - 1].label : t("nav.title"));

  // `count`, not `results.length`: results is one page, the badge is the whole unread inbox. (FL-15)
  const { data: unread } = useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: async () => {
      const res = await notificationsApi.list({ is_read: "false" });
      return { count: res.data.count, results: res.data.results };
    },
    staleTime: 30000,
    enabled: !!user,
  });
  const unreadCount = unread?.count ?? 0;
  const notifications = unread?.results ?? [];

  const onBar =
    "flex min-h-11 items-center justify-center text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-canvas))] hover:text-[oklch(var(--color-ink))] aria-expanded:bg-[oklch(var(--color-canvas))] aria-expanded:text-[oklch(var(--color-ink))]";
  const navToggleLabel = nav.forced
    ? t("nav.collapse_locked")
    : nav.collapsed
      ? t("nav.expand_menu")
      : t("nav.collapse_menu");

  return (
    <LazyMotion features={domMax}>
    <div className="min-h-screen bg-[oklch(var(--color-canvas))] min-[769px]:grid min-[769px]:grid-cols-[auto_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen min-[769px]:block">
        <GlobalNav
          menus={menus}
          allMenuPaths={allMenuPaths}
          currentId={currentGroup}
          openId={openGroup}
          onToggle={(id) => setOpenGroup((g) => (g === id ? null : id))}
          collapsed={nav.collapsed}
          user={user}
        />
      </aside>

      <main ref={mainBoxRef} className="min-w-0 max-[768px]:pb-14">
        {/* 问一问推开时(≥ 1024)面板是右侧通顶的一栏;工具条与匾都让出它的 420px。 */}
        <header
          data-testid="global-topbar"
          className={`sticky top-0 z-masthead flex h-13 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] pl-4 ${
            assist.pushed ? "pr-[436px]" : "pr-4"
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* 769–1199 强制收起:按钮仍在、不可用,可访问名说明原因(给审判台的裁决栏留宽度)。 */}
            <button
              type="button"
              data-testid="nav-toggle"
              aria-controls="global-nav"
              aria-expanded={!nav.collapsed}
              aria-disabled={nav.forced || undefined}
              aria-label={navToggleLabel}
              aria-keyshortcuts="["
              title={nav.forced ? navToggleLabel : `${navToggleLabel} ([)`}
              onClick={nav.toggle}
              className={`hidden h-11 w-11 shrink-0 items-center justify-center min-[769px]:flex ${
                nav.forced
                  ? "cursor-not-allowed bg-[oklch(var(--color-disabled-surface))] text-[oklch(var(--color-disabled-ink))]"
                  : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-canvas))] hover:text-[oklch(var(--color-ink))]"
              }`}
            >
              {nav.collapsed ? (
                <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={1.6} />
              ) : (
                <PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.6} />
              )}
            </button>
            <Breadcrumb menus={menus} />
          </div>
          <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            {/* 问一问 (canvas 1b): the connection state left the masthead, so it leads the group. */}
            <OfficerAssistEntry assist={assist} />
            {/* 全局搜索(v3 A8):顺序 搜索 / 通知 / 头像;1440 是 240 宽的搜索框样按钮,≤768 是 44 的图标。 */}
            {user ? <GlobalSearch menus={menus} /> : null}
            {user ? (
              <Popover.Root>
                <Popover.Trigger
                  className={`min-w-11 gap-1 px-2 ${onBar}`}
                  aria-label={unreadCount > 0 ? `${t("notifications.title")} (${unreadCount})` : t("notifications.title")}
                  title={t("notifications.title")}
                >
                  <Bell aria-hidden="true" size={18} strokeWidth={1.6} />
                  {unreadCount > 0 ? (
                    <span aria-hidden="true" className="font-mono text-2xs text-[oklch(var(--color-ink))]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-80 border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] focus:outline-hidden">
                      <div className="flex items-center justify-between border-b border-[oklch(var(--color-block))] px-4 py-2">
                        <h3 className="text-sm font-medium text-[oklch(var(--color-ink))]">{t("notifications.title")}</h3>
                        <Link href="/notifications" className="text-xs text-[oklch(var(--color-accent))] hover:underline">
                          {t("notifications.view_all")}
                        </Link>
                      </div>
                      {notifications.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-[oklch(var(--color-ink-subtle))]">{t("notifications.empty")}</p>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          {notifications.slice(0, 5).map((n: Notification) => (
                            <div key={n.id} className="border-b border-[oklch(var(--color-rule))] px-4 py-2">
                              <p className="text-sm text-[oklch(var(--color-ink))]">{n.message || n.title}</p>
                              <p className="mt-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{formatDateTime(n.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : null}

            {user ? (
              // Controlled so 设置 can close it: the settings drawer is a modal
              // dialog, and a popover left open under it is a second dialog on
              // screen (the off-screen-motion E2E found exactly that).
              <Popover.Root open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                <Popover.Trigger
                  data-testid="user-menu"
                  className={`gap-1 px-2 ${onBar}`}
                  title={user.display_name || user.username}
                >
                  <span className="max-w-40 truncate max-sm:max-w-20" title={user.display_name || user.username}>{user.display_name || user.username}</span>
                  <span aria-hidden="true">▾</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-60 border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] focus:outline-hidden">
                      <Link
                        href="/profile"
                        className="block border-b border-[oklch(var(--color-block))] px-3 py-2 hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        <span className="block truncate text-sm text-[oklch(var(--color-ink))]" title={user.display_name || user.username}>
                          {user.display_name || user.username}
                        </span>
                        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                          <DomainEnum namespace="users.roles" value={user.role} />
                        </span>
                      </Link>
                      <div className="flex items-center justify-between gap-3 border-b border-[oklch(var(--color-rule))] px-3 py-1">
                        <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("nav.language")}</span>
                        <LanguageSwitcher />
                      </div>
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="flex min-h-(--control-h-sm) w-full items-center justify-between border-b border-[oklch(var(--color-rule))] px-3 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        <span>{t("settings.theme")}</span>
                        <span className="text-[oklch(var(--color-ink))]">{theme === "dark" ? t("settings.dark") : t("settings.light")} ›</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setSettingsOpen(true);
                        }}
                        className="flex min-h-(--control-h-sm) w-full items-center border-b border-[oklch(var(--color-rule))] px-3 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("nav.settings")}
                      </button>
                      <Link
                        href="/about"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex min-h-(--control-h-sm) w-full items-center border-b border-[oklch(var(--color-rule))] px-3 text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("about.title")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setLogoutConfirmOpen(true);
                        }}
                        className="flex min-h-(--control-h-sm) w-full items-center px-3 text-xs text-[oklch(var(--color-danger))] hover:bg-[oklch(var(--color-surface-2))]"
                      >
                        {t("auth.logout")}
                      </button>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : (
              <Link href="/login" className={`px-3 font-medium ${onBar}`}>
                {t("auth.login")}
              </Link>
            )}
          </div>
        </header>

        {/* 身份带(规范 v3):吸在工具条下沿;页面滚动后自己收成 48px,只留印与殿名。
            z 与筛选栏同一层:两者不重叠 —— 筛选栏吸在 52 + 身份带此刻的高度(`--below-band`)。 */}
        <div className={`sticky top-13 z-filters ${assist.pushed ? "pr-[420px]" : ""}`}>
          <Plaque title={title} meta={plaque?.meta} caseNumber={plaque?.caseNumber} hall={plaque?.hall} collapsible short={shortBandFor(pathname)} />
        </div>

        {/* 问一问 pushed (≥ 1024): the page gives up the panel's 420 px, and 1024–1279 its
            side padding drops to 24 (canvas 1a 一). The padding rule reaches into
            PageShell's `md:px-8` (v2: 32 px; v1 was `md:px-10`) by attribute, so no page
            has to know about the panel. */}
        <div
          ref={assist.mainRef}
          tabIndex={-1}
          data-testid="app-content"
          data-assist-pushed={assist.pushed ? "" : undefined}
          className={`min-h-(--content-min-h) outline-none ${
            assist.pushed ? "pr-[420px] max-xl:[&_[class~='md:px-8']]:px-6" : ""
          }`}
        >
          <PlaqueProvider value={setPlaque}>{children}</PlaqueProvider>
        </div>
      </main>

      <BottomBar menus={menus} allMenuPaths={allMenuPaths} currentId={currentGroup} />

      <OfficerAssistPanel assist={assist} belowBanner={bannerShown} />

      {/* 视口最顶、横跨立柱与面板;fixed,浮在内容上 —— 它在加载后一会儿才出现,在文档流里
          那 28px 的位移曾把按钮从指针下挪走(E2E 头像测试 16 次里 1 次点空)。 */}
      <ConnectionBanner />

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
      />
    </div>
    </LazyMotion>
  );
}

// `Breadcrumb` 的实现搬到了 ./Breadcrumb.tsx（本文件当时是 751 行，超过仓库
// 500 行的上限）。这一行是**转发**，不是搬家没搬干净：
// src/__tests__/AppLayout.test.tsx 用
// `require("@/src/components/layout/AppLayout")` 取 Breadcrumb，而测试文件不在
// 这次拆分的改动范围里。入口留在原处、实现搬走，测试一行都不用改。
// 要删掉这一行，先去改那条 require。
export { Breadcrumb } from "./Breadcrumb";
