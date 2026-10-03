"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant, type AuthUser } from "@/src/contexts/TenantContext";
import { auditApi, ledgerApi, type AuditLogEntry, type LedgerStatsOverview } from "@soulledger/core/api";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { RoleName } from "@/src/components/users/RoleName";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { WelcomeSetup, readOnboarded } from "@/src/components/welcome/WelcomeSetup";
import { useSidebarMenus, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { auditActionGlyph } from "@/src/lib/auditActionGlyph";
import { APP_VERSION } from "@/src/lib/appVersion";
import { cn } from "@/lib/utils";

/**
 * 欢迎页(A9 §三,Design 2026-10-03)。问候并入身份带(题字「晚上好，崔判官」,右栏日期);
 * 下面是:一块四格的「本殿灵魂」、按角色的「接着做」、我的「最近活动」,页脚一行版本。
 * 原来的问候区、「欢迎页」字样、四个图标卡、四个大方块与三张信息卡都去掉了。
 *
 * 首次进入(这个浏览器里还没有 `onboarded`)单独占一屏 —— `WelcomeSetup`;做完或跳过回到这里,
 * 之后从「接着做」底部的「重看首次设置」再进去。
 *
 * 统计与活动**各自**加载、各自报错、各自重试;「接着做」不等接口。
 *
 * No auth guard here on purpose. proxy.ts lists /welcome as a public path, and
 * `user` is null during the first render (it hydrates from localStorage in an
 * effect), so a guard on `!user` bounced signed-in visitors to /login. Every
 * read of `user` below is optional.
 */
const PANEL = "rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]";
const MUTED = "text-[oklch(var(--color-ink-muted))]";
const ACTIVITY_MAX = 6;

type Load<T> = { state: "loading" } | { state: "error" } | { state: "ready"; data: T };

/** 一个面板的「! 加载失败」行:danger 只在这几个字上,说明 muted,右边「重试」。 */
function PanelError({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {t("dashboard.todo.load_error")}
        </p>
        <p className={cn("mt-1 text-xs", MUTED)}>{reason}</p>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

/** 骨架色块(同 `Skeleton` 的 surface-3 / surface-2),按实际形状画。 */
const Block = ({ className }: { className: string }) => (
  <span aria-hidden="true" className={cn("block rounded-control bg-[oklch(var(--color-surface-3))]", className)} />
);

function StatsPanel({ load, asOf, onRetry }: { load: Load<LedgerStatsOverview>; asOf: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  const data = load.state === "ready" ? load.data : null;
  const count = (state: string) => data?.state_distribution?.find((s) => s.state === state)?.count ?? 0;
  // 空的时候数字照样写 0,不隐藏格子(和 DomainNumber 一致)。
  const cells = [
    { key: "total", glyph: "", label: t("dashboard.total_souls"), value: data?.total_souls ?? 0, href: "/souls", go: t("welcome.stats_roster") },
    { key: "JUDGING", glyph: "◇", label: t("dashboard.under_judgment"), value: count("JUDGING"), href: "/judgment/queue", go: t("welcome.stats_go_judging") },
    { key: "ALIVE", glyph: "○", label: t("dashboard.alive"), value: count("ALIVE"), href: "/souls?state=ALIVE", go: t("welcome.stats_filter") },
    { key: "DISPOSED", glyph: "▣", label: t("dashboard.disposed"), value: count("DISPOSED"), href: "/souls?state=DISPOSED", go: t("welcome.stats_filter") },
  ];
  return (
    <section aria-labelledby="welcome-stats-title" aria-busy={load.state === "loading" || undefined} className={PANEL}>
      <header className="flex h-11 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] px-4">
        <h2 id="welcome-stats-title" className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
          {t("welcome.stats_eyebrow")}
        </h2>
        {asOf ? <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{t("welcome.stats_as_of", { time: asOf })}</span> : null}
      </header>
      {load.state === "error" ? (
        <PanelError reason={t("welcome.error_stats")} onRetry={onRetry} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4">
          {cells.map((c, i) => (
            <div
              key={c.key}
              className={cn(
                "border-[oklch(var(--color-line))]",
                i % 2 === 1 && "border-l",
                i >= 2 && "border-t md:border-t-0",
                i === 2 && "md:border-l"
              )}
            >
              {load.state === "loading" ? (
                <div className="flex flex-col gap-2 p-4">
                  <Block className="h-5 w-20" />
                  <Block className="h-7 w-12 md:h-9" />
                  <Block className="h-4 w-24 bg-[oklch(var(--color-surface-2))]" />
                </div>
              ) : (
                <Link href={c.href} data-stat={c.key} className="flex flex-col gap-1 p-4 hover:bg-[oklch(var(--color-surface-2))]">
                  <span className="text-sm text-[oklch(var(--color-ink))]">
                    {c.glyph ? <span aria-hidden="true">{c.glyph} </span> : null}
                    {c.label}
                  </span>
                  <span data-kpi="" className="font-title text-lg font-semibold tabular-nums text-[oklch(var(--color-ink))] md:text-xl">
                    {c.value}
                  </span>
                  <span className={cn("text-xs", MUTED)}>{c.go}</span>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function flattenPaths(menus: readonly SidebarMenu[]): Set<string> {
  const out = new Set<string>();
  const walk = (items: readonly SidebarMenu[]) => {
    for (const m of items) {
      if (m.path) out.add(m.path);
      if (m.children?.length) walk(m.children);
    }
  };
  walk(menus);
  return out;
}

/** 接着做:**一个**主按钮(全页唯一),三行入口(当前用户的菜单里没有就不出现)。 */
function NextPanel({
  user,
  judging,
  onRedo,
  onShortcuts,
}: {
  user: AuthUser | null;
  judging: number | null;
  onRedo: () => void;
  onShortcuts: () => void;
}) {
  const { t } = useI18n();
  const { data: menus = [] } = useSidebarMenus();
  const paths = useMemo(() => flattenPaths(menus), [menus]);
  const admin = user?.role === "ADMIN";
  const primary = admin
    ? { href: "/dashboard", label: t("welcome.next_dashboard") }
    : {
        href: "/judgment/queue",
        label:
          judging === null
            ? t("dashboard.todo.judgment_queue")
            : judging === 0
              ? t("welcome.next_judgment_empty")
              : t("welcome.next_judgment", { n: String(judging) }),
      };
  const rows = (
    admin
      ? [
          { href: "/users", name: t("users.title"), hint: "" },
          { href: "/permissions", name: t("permissions.title"), hint: "" },
          { href: "/audit", name: t("audit.title"), hint: "" },
        ]
      : [
          { href: "/souls", name: t("souls.create"), hint: t("welcome.next_create_soul_hint") },
          { href: "/workflow", name: t("workflow.title"), hint: t("welcome.next_workflow_hint") },
          { href: "/ledger", name: t("ledger.title"), hint: t("welcome.next_merit_hint") },
        ]
  ).filter((r) => paths.has(r.href));

  // 「按『{role}』角色」:角色名走 RoleName(自定义角色读角色表),所以把它插进译文的占位处。
  const MARK = "\u0001";
  const [rolePre, rolePost = ""] = t("welcome.next_by_role", { role: MARK }).split(MARK);

  return (
    <section aria-labelledby="welcome-next-title" className={cn(PANEL, "flex flex-col")}>
      <header className="flex items-baseline justify-between gap-3 px-4 pt-4">
        <h2 id="welcome-next-title" className="text-lg text-[oklch(var(--color-ink))]">
          {t("welcome.next_title")}
        </h2>
        {user ? (
          <span className={cn("text-xs", MUTED)}>
            {rolePre}
            <RoleName value={user.role} />
            {rolePost}
          </span>
        ) : null}
      </header>
      <div className="p-4">
        <Link href={primary.href} data-testid="welcome-primary" className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}>
          {primary.label}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      {rows.length > 0 ? (
        <ul className="m-0 list-none border-t border-[oklch(var(--color-line))] p-0">
          {rows.map((r) => (
            <li key={r.href} className="border-b border-[oklch(var(--color-line))]">
              <Link href={r.href} className="flex min-h-14 items-center gap-3 px-4 hover:bg-[oklch(var(--color-surface-2))]">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[oklch(var(--color-ink))]">{r.name}</span>
                  {r.hint ? <span className={cn("block text-xs", MUTED)}>{r.hint}</span> : null}
                </span>
                <span aria-hidden="true" className={MUTED}>→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {user ? (
        <div className="mt-auto flex items-center justify-between gap-3 px-2">
          <Button type="button" variant="ghost" size="sm" onClick={onShortcuts}>
            <span aria-hidden="true" className="font-mono">? </span>
            {t("welcome.next_all_shortcuts")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRedo}>
            {t("welcome.next_redo_onboarding")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ActivityPanel({
  load,
  onRetry,
  formatTimestamp,
}: {
  load: Load<AuditLogEntry[]>;
  onRetry: () => void;
  formatTimestamp: (ts: string) => string;
}) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="welcome-activity-title" aria-busy={load.state === "loading" || undefined} className={cn(PANEL, "min-w-0")}>
      <header className="flex items-center justify-between gap-3 px-4 pt-2">
        <div className="min-w-0">
          <h2 id="welcome-activity-title" className="text-lg text-[oklch(var(--color-ink))]">
            {t("welcome.recent_activity")}
          </h2>
          <p className={cn("text-xs", MUTED)}>{t("welcome.activity_source", { n: String(ACTIVITY_MAX) })}</p>
        </div>
        <Link href="/audit" className="flex min-h-11 shrink-0 items-center text-sm text-[oklch(var(--color-ink))] underline underline-offset-2">
          {t("welcome.view_all_activity")}
          <span aria-hidden="true">&nbsp;→</span>
        </Link>
      </header>
      {load.state === "error" ? (
        <PanelError reason={t("welcome.error_activity")} onRetry={onRetry} />
      ) : load.state === "loading" ? (
        <ul className="m-0 mt-2 list-none p-0">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex min-h-14 items-center gap-4 border-t border-[oklch(var(--color-line))] px-4">
              <Block className="h-4 w-12" />
              <Block className="h-4 w-20" />
              <Block className="h-4 w-24 bg-[oklch(var(--color-surface-2))]" />
            </li>
          ))}
        </ul>
      ) : load.data.length === 0 ? (
        <div className="px-4">
          <EmptyState title={t("dashboard.no_activity")} reason={t("welcome.activity_empty_reason")} />
        </div>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {load.data.map((entry) => (
            <li
              key={entry.id}
              data-activity=""
              className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-t border-[oklch(var(--color-line))] px-4 py-2 md:grid-cols-[64px_minmax(0,10rem)_minmax(0,12rem)_minmax(0,1fr)]"
            >
              <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{formatTimestamp(entry.timestamp)}</span>
              <span className="text-sm font-medium text-[oklch(var(--color-ink))]">
                <span aria-hidden="true">{auditActionGlyph(entry.action)} </span>
                <DomainEnum namespace="audit.actions" value={entry.action} />
              </span>
              <span title={`${entry.resource}${entry.resource_id ? ` · ${entry.resource_id}` : ""}`} className="truncate font-mono text-xs text-[oklch(var(--color-ink))]">
                {entry.resource}
                {entry.resource_id ? ` · ${entry.resource_id}` : ""}
              </span>
              <span title={entry.description} className={cn("truncate text-xs", MUTED)}>{entry.description}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function WelcomePage() {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const name = user?.display_name || user?.username || "";

  // 问候只分三档(A9):12 点前早上好,18 点前下午好,其余晚上好。
  const hour = new Date().getHours();
  const greetingKey = hour < 12 && hour >= 5 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
  const greeting = name ? t(`welcome.greeting_${greetingKey}`, { name }) : t(`nav.greeting_${greetingKey}`);
  usePlaque({
    title: greeting,
    meta: formatDate(new Date(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
  });

  // ── 首次设置:这个用户在这个浏览器里还没做完 → 单独一屏。null = 常规页。
  const [setupAt, setSetupAt] = useState<number | null>(null);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId !== null && !readOnboarded(userId)) setSetupAt(0);
  }, [userId]);

  // ── 本殿灵魂。
  const [stats, setStats] = useState<Load<LedgerStatsOverview>>({ state: "loading" });
  const [asOfAt, setAsOfAt] = useState<Date | null>(null);
  const loadStats = useCallback(() => {
    setStats({ state: "loading" });
    ledgerApi
      .statsOverview()
      .then((res) => {
        setStats({ state: "ready", data: res.data });
        setAsOfAt(new Date());
      })
      .catch(() => setStats({ state: "error" }));
  }, []);
  const asOf = asOfAt ? formatDate(asOfAt, { hour: "2-digit", minute: "2-digit" }) : null;
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  /**
   * 最近活动:审计日志里**我的**最近六条(`?user=<id>`,AuditLogViewSet 的 filterset 字段)。
   * It used to be three hard-coded rows of invented events, shown to anonymous
   * visitors as if they were the ledger's. The audit log needs a session, so an
   * anonymous visitor gets the empty state and no request at all.
   * No `page_size` param: the backend has no `page_size_query_param`; slice the first page.
   */
  const [activity, setActivity] = useState<Load<AuditLogEntry[]>>({ state: "loading" });
  const loadActivity = useCallback(() => {
    if (userId === null) {
      setActivity({ state: "ready", data: [] });
      return;
    }
    setActivity({ state: "loading" });
    auditApi
      .list({ user: String(userId) })
      .then((res) => setActivity({ state: "ready", data: res.data.results.slice(0, ACTIVITY_MAX) }))
      .catch(() => setActivity({ state: "error" }));
  }, [userId]);
  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return t("welcome.just_now");
    if (minutes < 60) return t("welcome.minutes_ago", { n: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("welcome.hours_ago", { n: String(hours) });
    return formatDate(date);
  };

  const judging =
    stats.state === "ready" ? (stats.data.state_distribution?.find((s) => s.state === "JUDGING")?.count ?? 0) : null;

  return (
    <div className="bg-[oklch(var(--color-canvas))] px-4 py-6 md:p-6">
      {/* 这一页的 <h1>:看得见的问候在身份带上(壳里的题字是 div),这里给读屏一个标题。 */}
      <h1 className="sr-only font-title text-lg">{greeting}</h1>
      {setupAt !== null && user ? (
        <WelcomeSetup user={user} startAt={setupAt} onDone={() => setSetupAt(null)} />
      ) : (
        <div className="flex flex-col gap-6">
          <StatsPanel load={stats} asOf={asOf} onRetry={loadStats} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
            <NextPanel user={user} judging={judging} onRedo={() => setSetupAt(0)} onShortcuts={() => setSetupAt(3)} />
            <ActivityPanel load={activity} onRetry={loadActivity} formatTimestamp={formatTimestamp} />
          </div>
          <footer className={cn("text-xs", MUTED)}>
            {t("welcome.system_version")} · <span className="font-mono">{APP_VERSION}</span>
          </footer>
        </div>
      )}
    </div>
  );
}
