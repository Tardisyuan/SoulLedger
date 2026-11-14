"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { LazyMotion } from "motion/react";
import { notificationsApi, type Notification } from "@soulledger/core/api";
import { notificationKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { authApi } from "@soulledger/core/api";
import { ConnectionBanner } from "@/src/components/connection-status";
import { MfaRequiredBanner } from "@/src/components/layout/MfaRequiredBanner";
import { PasswordChangeRedirect } from "@/src/components/layout/PasswordChangeRedirect";
import { useSidebarMenus } from "@/src/hooks/useSidebarMenus";
import { Breadcrumb } from "@/src/components/layout/Breadcrumb";
import { DoorPagePicker, DoorRail, DoorTabs, useDoorPages } from "@/src/components/layout/DoorRail";
import { GlobalSearchPlaceholder } from "@/src/components/layout/GlobalSearchEntry";
import { PlaqueProvider, type PlaqueText } from "@/src/components/plaque/Plaque";
import { HeadingProvider, PlaqueValueProvider } from "@/src/components/plaque/pageHeadContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Bell } from "lucide-react";
import { DensityToggle, HoursChip } from "@/src/components/layout/ShellChrome";
// 「问一问」的推开只在 ≥ 1024 px(canvas 1a),且主内容区让出 420 后仍有 720(Design E 组);否则它是覆盖层。
import { useWideViewport } from "@/src/hooks/useWideViewport";
import { useRoomBeside } from "@/src/hooks/useRoomBeside";
import { OfficerAssistEntry } from "@/src/components/assist/OfficerAssistEntry";
import { useOfficerAssist } from "@/src/components/assist/useOfficerAssist";
import { ShortcutHelp } from "@/src/components/layout/ShortcutHelp";
import { useSyncEmailLocale } from "@/src/components/layout/EmailLocaleSync";
import { ImpersonationBanner, IMPERSONATION_BANNER_HEIGHT } from "@/src/components/impersonation/ImpersonationBanner";
import { HallViewExpired } from "@/src/components/impersonation/HallViewExpired";
import { useHallViewExpired } from "@/src/components/impersonation/hallViewExpiry";
import { useImpersonation } from "@/src/components/impersonation/useImpersonation";
import { civSkinOf } from "@/src/lib/civSkin";
import { leaveGoodbye } from "@/src/lib/goodbye";

/**
 * 全站唯一的壳(Design 第三十批 第 4 步「五门」):左侧门栏(`DoorRail`,64)+ 内容栏。内容栏自上而下:
 * 52px 中性工具条(`global-topbar`:面包屑;右边问一问、通知、用户菜单)、门内二级导航(`DoorTabs`)、页面。
 * 门栏取代了旧的侧栏与底栏;哪几门按角色,门内哪几页仍按后端菜单(`src/lib/doors.ts`)。
 * `bare`(案卷台与总簿,`AppLayoutWrapper` 的 `DESK_PATHS`):页面铺满,没有工具条 —— 它们有自己的页头;
 * 门栏、门内导航、代看条与过期、两步验证提示、改密码跳转、跳到正文照旧(第 2 步案卷台自己的壳的几样,并进这里)。
 * 第三十批「卷宗」第 1 步撤掉了工具条下面那条标题行(`Plaque`,v4 `.ph`)与它的第二个标题:页头只有一个,
 * 是页面自己的 PageShell 页头(顶线 + 卷宗头,标题即 `<h1>`)。页面经 `usePlaque` 报的殿名 / 案号 / 概览
 * 由这里收下,经 `PlaqueValueProvider` 交给那个页头;面包屑在末段与 `<h1>` 相同时省掉末段。
 *
 * - ≤ 768 壳只有两层(fe-mobile 3.1):48 的顶栏 + 门栏到底部(门 +「我」;殿司只读收进「我」),内容让出 64 + 安全区
 *   (`--bottom-bar`)。顶栏左边是面包屑的返回键(有上一层时;门里不止一页时面包屑的各段不画)、中间是「当前页名 ▾」(`DoorPagePicker`,
 *   门内换页的抽屉;门内页签条在窄屏不画)、右边搜索与通知;不画用户菜单 ——「我」在底栏,用户菜单的几样也收在那里。
 *   `bare` 的页(案卷台)在窄屏同样有这条顶栏:没有页签条,门内换页只能靠它。
 * - 工具条吸顶;PageShell 的筛选栏吸在它下沿(`--below-band` = 52 + 代看条)。页头不吸顶。
 * - 连接状态只在断开时出现(`ConnectionBanner`,v4 第八批第 4 条):桌面是工具条里面包屑后面的一个
 *   胶囊,加工具条下沿一条 2px 状态色线;≤ 768 浮在工具条下沿正中。工具条高度不变,内容不动、不被盖住。
 * - 语言 / 主题 / 设置 / 退出在用户菜单里(brief §4.4)。
 */
/** domMax arrives after first paint (`motionFeatures.ts`); an `m` element renders unanimated until then. */
const loadMotionFeatures = () => import("./motionFeatures").then((mod) => mod.default);

/*
 * The overlays that are closed on arrival come by `next/dynamic` (B3, 2026-10-30), out of the bundle every page pays
 * for. Their entry points stay static — the 问一问 button and its ⌘J (`useOfficerAssist`), the user menu's 设置 /
 * 退出, the `?` listener (`ShortcutHelp`) — and so does each one's open state, so a press before a chunk lands is
 * kept: the overlay appears when its code does. 全局搜索 keeps its open state inside, so its placeholder draws the
 * same buttons and hands an early press over (`GlobalSearchEntry.tsx`).
 */
const OfficerAssistPanel = dynamic(() => import("@/src/components/assist/OfficerAssist").then((m) => m.OfficerAssistPanel), {
  ssr: false,
});
const GlobalSearch = dynamic(() => import("@/src/components/layout/GlobalSearch").then((m) => m.GlobalSearch), {
  ssr: false,
  loading: () => <GlobalSearchPlaceholder />,
});
const SettingsDrawer = dynamic(() => import("@/src/components/settings/SettingsDrawer").then((m) => m.SettingsDrawer), {
  ssr: false,
});
const LogoutConfirmDialog = dynamic(
  () => import("@/src/components/layout/LogoutConfirmDialog").then((m) => m.LogoutConfirmDialog),
  { ssr: false },
);

/** 问一问 pushed panel (canvas 1a) and the room the page keeps beside it (Design E 组). */
export const ASSIST_PANEL_WIDTH = 420;
export const ASSIST_MIN_MAIN_WIDTH = 720;

export function AppLayout({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const hallViewExpired = useHallViewExpired();
  const { t, formatDateTime } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The main column (everything right of the door rail) must keep 720 px beside the pushed
  // 420 px panel — Design E 组. Measured, not a media query, so the rule does not have to
  // know the rail's width.
  const mainBoxRef = useRef<HTMLDivElement>(null);
  const roomy = useRoomBeside(mainBoxRef, ASSIST_PANEL_WIDTH + ASSIST_MIN_MAIN_WIDTH);
  const wide = useWideViewport() && roomy;
  const assist = useOfficerAssist(wide);
  useSyncEmailLocale();
  // 代看固定条在工具条之上:把它的高度写进 `--imp-h`(globals.css),吸顶的条都往下让。
  const viewing = useImpersonation() !== null;
  useEffect(() => {
    if (!viewing) return;
    document.documentElement.style.setProperty("--imp-h", IMPERSONATION_BANNER_HEIGHT);
    return () => {
      document.documentElement.style.removeProperty("--imp-h");
    };
  }, [viewing]);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (err) { console.error("Logout failed:", err); }
    queryClient.invalidateQueries({ queryKey: ["menus-sidebar"] });
    // 先给「再会」页留下名字与文明(退出之后就读不到了),再退出、去 /goodbye(2026-11-10)。
    leaveGoodbye({ name: user?.display_name || user?.username, civ: civSkinOf(user?.tenant?.code ?? null) });
    logout();
    router.push("/goodbye");
  };

  const { data: menus = [] } = useSidebarMenus();
  // 窄屏顶栏:门里不止一页就画「页名 ▾」,面包屑只留它的返回键(有上一层时才有)。
  const doorPages = useDoorPages();
  // 页面经 `usePlaque` 报的殿名 / 案号 / 概览,交给 PageShell 的页头;PageShell 报它的 `<h1>` 文字给面包屑。
  const [plaque, setPlaque] = useState<PlaqueText | null>(null);
  const [heading, setHeading] = useState<string | null>(null);

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
    "flex min-h-11 items-center justify-center text-xs text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] hover:text-[oklch(var(--color-ink))] aria-expanded:bg-[oklch(var(--color-surface-2))] aria-expanded:text-[oklch(var(--color-ink))]";

  return (
    <LazyMotion features={loadMotionFeatures}>
    {/* 跳到正文(WCAG 2.4.1):第一个可聚焦的东西,只在聚焦时出现,把焦点交给 `<main id="main">`,
        越过导航、工具条与身份带。点击时自己挪焦点:只靠 `#main` 的锚点,有的浏览器只滚动不移焦。 */}
    <a
      href="#main"
      data-testid="skip-to-main"
      onClick={(e) => {
        const target = document.getElementById("main");
        if (!target) return;
        e.preventDefault();
        target.focus(); // focus() scrolls the target into view too
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-toast focus:bg-[oklch(var(--color-surface-1))] focus:px-3 focus:py-2 focus:text-sm focus:text-[oklch(var(--color-ink))]"
    >
      {t("nav.skip_to_main")}
    </a>
    <ImpersonationBanner />
    <div className="min-h-screen bg-[oklch(var(--color-canvas))] min-[769px]:grid min-[769px]:grid-cols-[auto_minmax(0,1fr)]">
      <DoorRail
        onSettings={user ? () => setSettingsOpen(true) : undefined}
        onLogout={user ? () => setLogoutConfirmOpen(true) : undefined}
      />

      <div ref={mainBoxRef} className="min-w-0 max-[768px]:pb-(--bottom-bar)">
        {/* 问一问推开时(≥ 1024)面板是右侧通顶的一栏;工具条与匾都让出它的 420px。
            v4:工具条用 `.shell-glow`(globals.css)。
            右侧顺序照 v4:时辰 · 舒适 / 紧凑 · 问一问 · 搜索 · 通知 · 用户。 */}
        {/* `bare` 的页在宽屏没有工具条(有自己的页头);窄屏照样画,因为那里门内换页只在这条顶栏上。 */}
        <header
          data-testid="global-topbar"
          className={`shell-glow sticky top-(--imp-h) z-masthead flex h-13 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] pl-4 max-[768px]:h-12 max-[768px]:gap-1 max-[768px]:pl-2 ${
            assist.pushed ? "pr-[436px]" : "pr-4 max-[768px]:pr-2"
          } ${bare ? "min-[769px]:hidden" : ""}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 max-[768px]:gap-1">
            <div
              data-testid="topbar-crumbs"
              className={`flex min-w-0 flex-1 items-center ${doorPages.show ? "max-[768px]:flex-none max-[768px]:[&_ol]:hidden" : ""}`}
            >
              <Breadcrumb menus={menus} heading={heading} />
            </div>
            <DoorPagePicker />
            <ConnectionBanner />
            {user ? <HoursChip /> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            {user ? <DensityToggle /> : null}
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
                    <Popover.Popup className="w-80 rounded-panel shadow-overlay overflow-hidden border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] focus:outline-hidden">
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
                  className={`gap-1 px-2 max-[768px]:hidden ${onBar}`}
                  title={user.display_name || user.username}
                >
                  <span className="max-w-40 truncate max-sm:max-w-20" title={user.display_name || user.username}>{user.display_name || user.username}</span>
                  <span aria-hidden="true">▾</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner sideOffset={8} align="end" className="z-drawer">
                    <Popover.Popup className="w-60 rounded-panel shadow-overlay overflow-hidden border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] focus:outline-hidden">
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
        {/* 门内二级导航;问一问推开时同样让出面板的 420。 */}
        <div className={assist.pushed ? "pr-[420px]" : undefined}>
          <DoorTabs />
        </div>

        {/* 被要求开启两步验证而未开启:常驻提示(A12),在文档流里,不盖工具条。 */}
        <MfaRequiredBanner />
        <PasswordChangeRedirect />

        {/* 问一问 pushed (≥ 1024): the page gives up the panel's 420 px, and 1024–1279 its
            side padding drops to 24 (canvas 1a 一). The padding rule reaches into
            PageShell's `md:px-8` (v2: 32 px; v1 was `md:px-10`) by attribute, so no page
            has to know about the panel. */}
        {/* The page itself is the landmark (and the skip link's target) — not the toolbar above it,
            which the `<main>` used to wrap. */}
        <main
          id="main"
          ref={assist.mainRef}
          tabIndex={-1}
          data-testid="app-content"
          data-assist-pushed={assist.pushed ? "" : undefined}
          className={`${bare ? "" : "min-h-(--content-min-h)"} outline-none ${
            assist.pushed ? "pr-[420px] max-xl:[&_[class~='md:px-8']]:px-6" : ""
          }`}
        >
          <PlaqueProvider value={setPlaque}>
            <PlaqueValueProvider value={plaque}>
              <HeadingProvider value={setHeading}>
                {hallViewExpired ? <HallViewExpired /> : children}
              </HeadingProvider>
            </PlaqueValueProvider>
          </PlaqueProvider>
        </main>
      </div>

      {bare ? null : <OfficerAssistPanel assist={assist} />}
      <ShortcutHelp />


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
