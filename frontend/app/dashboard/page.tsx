"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { ledgerApi, LedgerStatsOverview } from "@soulledger/core/api";
import Link from "next/link";
import { LazyBarChart } from "@/src/components/charts/LazyDashboardCharts";
import { dispatchApi, judgmentApi } from "@soulledger/core/api";
import { usePermissions } from "@/src/hooks/usePermissions";
import { LegendLedger, sharePercent } from "@/src/components/dashboard/LegendLedger";
import { BalanceHistogram } from "@/src/components/dashboard/BalanceHistogram";
import { soulStateGlyph } from "@/src/lib/soulStateBadge";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { CIVILIZATION_OPTIONS, getCivilizationFromTenantCode } from "@soulledger/core/config/civilizations";
import { RequireAdmin, RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { useChartColors } from "@/src/hooks/useChartColors";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { StatCard } from "@/src/components/dashboard/StatCard";
import { groupDigits } from "@/src/components/dashboard/numberFormat";

type DashboardTab = "overview" | "ledger";

/** Parses karma_distribution bucket labels ("< -50", "-5 to 5", "> 50", ...) into a midpoint. */
function bucketMidpoint(label: string): number {
  if (label.startsWith("<")) return parseFloat(label.replace("<", "").trim()) - 10;
  if (label.startsWith(">")) return parseFloat(label.replace(">", "").trim()) + 10;
  const parts = label.split(" to ");
  if (parts.length === 2) return (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
  return 0;
}

/** Glyph ink and legend fill per lifecycle state — the soul-lifecycle tokens, not the chart literals. */
const STATE_INK: Record<string, string> = {
  ALIVE: "text-[oklch(var(--color-status-alive))]",
  JUDGING: "text-[oklch(var(--color-status-judging))]",
  DISPOSED: "text-[oklch(var(--color-status-disposed))]",
  REINCARNATING: "text-[oklch(var(--color-status-reincarnating))]",
  SETTLED: "text-[oklch(var(--color-status-settled))]",
  LOST: "text-[oklch(var(--color-status-lost))]",
};
const STATE_FILL: Record<string, string> = {
  ALIVE: "bg-[oklch(var(--color-status-alive))]",
  JUDGING: "bg-[oklch(var(--color-status-judging))]",
  DISPOSED: "bg-[oklch(var(--color-status-disposed))]",
  REINCARNATING: "bg-[oklch(var(--color-status-reincarnating))]",
  SETTLED: "bg-[oklch(var(--color-status-settled))]",
  LOST: "bg-[oklch(var(--color-status-lost))]",
};

/** Section label (规范 v1): 11 px mono, block line beneath. */
function SectionLabel({ children, className = "", columns = "" }: { children: React.ReactNode; className?: string; columns?: string }) {
  return (
    <h2
      className={`border-b border-[oklch(var(--color-block))] pb-1 pt-4 font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] ${columns} ${className}`}
    >
      {children}
    </h2>
  );
}

/** One 待办 cell: a count and where to go about it. */
function TodoCell({
  label,
  count,
  isLoading,
  isError,
  href,
  linkText,
}: {
  label: string;
  count: number | undefined;
  isLoading: boolean;
  isError: boolean;
  href: string;
  linkText: string;
}) {
  const { t } = useI18n();
  return (
    <div data-todo="" className="py-3 pr-4 md:border-r md:last:border-r-0 border-[oklch(var(--color-line))] max-md:border-b max-md:last:border-b-0">
      <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{label}</div>
      <div className="flex items-baseline justify-between gap-3">
        {isLoading ? (
          <Skeleton className="h-8 w-10" />
        ) : isError || count === undefined ? (
          <span role="alert" className="text-sm text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">! </span>
            {t("dashboard.todo.load_error")}
          </span>
        ) : (
          <>
            <span
              data-todo-count=""
              className={`font-mono text-xl ${count === 0 ? "text-[oklch(var(--color-ink-subtle))]" : "text-[oklch(var(--color-ink))]"}`}
            >
              {count}
            </span>
            {count > 0 ? (
              <Link href={href} className="text-sm underline text-[oklch(var(--color-accent-ink))]">
                {linkText}
              </Link>
            ) : (
              <span className="text-sm text-[oklch(var(--color-ink-subtle))]">{t("dashboard.todo.none")}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 待我审批 / 审判队列 (规范 v1 §3.4). Each count comes from the endpoint the
 * page it links to already reads, so the two can never disagree:
 * `/dispatch/records/proposed/` is the approval inbox (`target_tenant=<caller>`,
 * see dispatchApi.proposed), and `/judgment/next/`'s `total` is the queue's own
 * count. A cell only exists for someone who may open where it points.
 *
 * 死亡同步异常 is not here: `/death-sync/registrations/` has no status filter,
 * so the only count available is of one page — the truncation this repo has
 * already paid for once. It needs a server-side count first.
 */
function DashboardTodo() {
  const { t } = useI18n();
  const { hasPermission } = usePermissions();
  const canDispatch = hasPermission("dispatch.read");
  const canJudge = hasPermission("judgment.read");
  const dispatchQ = useQuery({
    queryKey: ["dashboard", "todo", "dispatch-proposed"],
    queryFn: async () => (await dispatchApi.proposed({ page: "1" })).data.count,
    enabled: canDispatch,
    staleTime: 60_000,
  });
  const queueQ = useQuery({
    queryKey: ["dashboard", "todo", "judgment-queue"],
    queryFn: async () => (await judgmentApi.next()).data.total,
    enabled: canJudge,
    staleTime: 60_000,
  });
  if (!canDispatch && !canJudge) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 border-y border-[oklch(var(--color-block))]">
      {canDispatch && (
        <TodoCell
          label={t("dashboard.todo.approve_dispatch")}
          count={dispatchQ.data}
          isLoading={dispatchQ.isLoading}
          isError={dispatchQ.isError}
          href="/dispatch"
          linkText={t("dashboard.todo.go_approve")}
        />
      )}
      {canJudge && (
        <TodoCell
          label={t("dashboard.todo.judgment_queue")}
          count={queueQ.data}
          isLoading={queueQ.isLoading}
          isError={queueQ.isError}
          href="/judgment/queue"
          linkText={t("dashboard.todo.enter")}
        />
      )}
    </div>
  );
}

function DashboardContent() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  // Recharts fills are literals and do not follow the `.light` cascade, so the
  // theme has to pick the table. `REALM_COLORS` used to be imported here and
  // never read — the realm histogram is single-series and fills with
  // CHART_SERIES.realm — so it is not destructured.
  const { CHART_SERIES } = useChartColors();
  const searchParams = useSearchParams();
  const activeTab: DashboardTab = searchParams.get("tab") === "ledger" ? "ledger" : "overview";

  const { data: stats, isLoading: loading, error: queryError } = useQuery<LedgerStatsOverview>({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const res = await ledgerApi.statsOverview();
      return res.data;
    },
    staleTime: 60_000,
  });
  const error = queryError ? t("dashboard.error_load") : null;

  const setTab = useCallback(
    (tab: DashboardTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.replace(`/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  /**
   * 导出正在进行 —— 此前没有任何东西记录这件事。
   *
   * `Button` 从写出来就有 `loading`(它会禁用按钮并挂上 `aria-busy`),全站 21
   * 处在用。这一处没用:一次导出要走完整的服务端统计再下载,而按钮在这期间
   * 看起来和空闲时**逐字节相同**,也接受点击 —— 点三下就下三个文件。
   *
   * 这不是缺一个组件,是既有的 prop 没接上。
   */
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await ledgerApi.exportStats();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "souls_ledger_export.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      showToast(t("dashboard.error_export"), "error");
    } finally {
      setExporting(false);
    }
  };

  // 标题、副标题、动作三样各进 PageShell 的一个槽。原先它们挤在一条页面自己
  // 画的 `border-b pb-4` 里,那条线与 PageShell 页头的下边框是同一条。
  const pageTitle = (
    <>
      {t("dashboard.title")}
      <MenuGloss path="/dashboard" />
    </>
  );

  // The backend's /ledger/stats/export/ is a hardcoded `role == "ADMIN"` check,
  // not a codename. `karma.export` never existed, and the whole `karma.*`
  // family was renamed to `ledger.*` by perm/0016 -- so the string was doubly
  // dead and the gate worked only because hasPermission short-circuits ADMIN.
  const pageActions = (
    <RequireAdmin>
      <Button type="button" variant="primary" loading={exporting} onClick={handleExport}>
        {t("dashboard.export_stats")}
      </Button>
    </RequireAdmin>
  );

  const tabs: { key: DashboardTab; label: string }[] = [
    { key: "overview", label: t("dashboard.tab_overview") },
    { key: "ledger", label: t("admin.ledger_stats") },
  ];

  // 交给 PageShell 的 `tabs` 槽。外层那条 `border-b border-hairline/50` 和
  // `gap-1` 都由槽自己给了 —— 这里只剩按钮,顺带把站里两派写法(gap-1 + 半透明
  // 线 / gap-2 + 实线)中的这一派也收掉。
  const pageTabs = tabs.map((tabItem) => {
    const button = (
      <button
        key={tabItem.key}
        type="button"
        // `aria-pressed`, not `role="tab"`. These are not a real tablist —
        // they do not own a `tabpanel`, arrow keys do not move between them,
        // and claiming the role without that contract is the defect this
        // repo already has three instances of. What they ARE is a set of
        // toggles where exactly one is on, and `aria-pressed` says that
        // truthfully. Before this the selected one differed only by border
        // and text COLOUR, so a screen-reader user heard two identical
        // buttons and could not tell which view was showing.
        // `components/ui/data-grid/FilterBar.tsx:181` already does this.
        aria-pressed={activeTab === tabItem.key}
        onClick={() => setTab(tabItem.key)}
        className={`${TAB_BASE} ${activeTab === tabItem.key ? TAB_ON : TAB_OFF}`}
      >
        {tabItem.label}
      </button>
    );
    // The ledger tab surfaces admin-only stats — hide the tab itself from non-admins.
    return tabItem.key === "ledger" ? (
      <RequireAdmin key={tabItem.key}>
        {button}
      </RequireAdmin>
    ) : (
      button
    );
  });

  // WHAT THE API ACTUALLY SENDS. `{"label": s}` — **the SCREAMING_SNAKE enum
  // member verbatim** (backend/apps/ledger/views.py). This comment used to say
  // it was an English label ("Alive", "Judging", …), and that reading made
  // `apiLabel` look like a safe fallback. It is not: on the day a
  // `souls.states.*` key goes missing, that fallback puts the raw enum member
  // into the chart legend — the exact defect §4.6 exists to remove.
  //
  // The branch is dead today (all six keys exist, pinned by
  // src/__tests__/domainNamespaceContract.test.ts). It is kept only for the
  // shape of the fallback chain; the value it prefers now is the convention's
  // own copy, never the server's string.
  const stateLabel = (state: string, apiLabel?: string) => {
    const resolved = resolveEnumDisplay(t, "souls.states", state);
    // The server's English label beats the convention's generic
    // "unrecognized" copy, but the raw enum member is never the fallback.
    // `label` is null only for an absent state; a chart axis needs a string.
    if (resolved.state === "known") return resolved.label;
    // `apiLabel` is deliberately NOT consulted — see above. It is the raw enum
    // member, and printing it is what the convention forbids.
    void apiLabel;
    return resolved.label || t("common.value.unrecorded");
  };

  /**
   * The lifecycle row and its 图例账 (规范 v1 §3.4). The five lifecycle states
   * in their fixed order, then any other state the payload carries (LOST, or
   * one this build does not know) so nothing it counted is dropped.
   */
  const LIFECYCLE = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"];
  const lifecycleStates = [
    ...LIFECYCLE,
    ...(stats?.state_distribution ?? []).map((s) => s.state).filter((st) => !LIFECYCLE.includes(st)),
  ];
  const stateCount = (state: string) =>
    stats?.state_distribution?.find((s) => s.state === state)?.count ?? 0;

  /** 各文明: all four civilizations, from the tenants that carry them. */
  const civCount = (civ: string) =>
    (stats?.tenants ?? [])
      .filter((tn) => getCivilizationFromTenantCode(tn.tenant_code) === civ)
      .reduce((sum, tn) => sum + tn.total_souls, 0);
  const civTotal = CIVILIZATION_OPTIONS.reduce((sum, civ) => sum + civCount(civ), 0);
  const civMax = Math.max(1, ...CIVILIZATION_OPTIONS.map(civCount));

  /**
   * Sorted descending, unlike the civilization rows above, and the difference
   * is the point.
   *
   * Realms have no canonical order, so the server's order is arbitrary and a
   * reader comparing magnitudes has to hunt. Tenants do: there are exactly
   * four, each carries its civilization's hue (contract-tested), and a stable
   * order lets a reader learn "the third bar is Egypt" and keep that across
   * page loads — sorting those by magnitude would make the bars swap places
   * between visits. Applying "always sort descending" to both would have
   * traded a real identity for a generic rule.
   */
  const realmChartData = [...(stats?.souls_by_realm ?? [])]
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      name: r.realm_name,
      count: r.count,
      civilization: r.civilization,
    }));

  const formatTimestamp = (ts: string) => formatDateTime(ts);

  // Ledger-tab-only derived data (admin/stats page's unique cards)
  const avgBalance = stats?.karma_distribution
    ? stats.karma_distribution.reduce((sum, k) => sum + bucketMidpoint(k.label) * k.count, 0) /
      (stats.total_souls || 1)
    : 0;

  return (
    <PageShell
      variant="page"
      title={pageTitle}
      subtitle={t("dashboard.subtitle")}
      actions={pageActions}
      tabs={pageTabs}
    >
      <div className="space-y-6">
        {activeTab === "overview" ? (
          <>
            {/* 待办(规范 v1 §3.4):数字 + 去处。只给有权限看的那几格。 */}
            <DashboardTodo />

            {/* The lifecycle states, glyph + word (never colour alone). */}
            <div className="grid grid-cols-2 md:grid-cols-5 border-b border-[oklch(var(--color-line))]">
              {lifecycleStates.map((state) => (
                <StatCard
                  key={state}
                  label={
                    <>
                      <span className={`font-mono ${STATE_INK[state] ?? ""}`}>{soulStateGlyph(state)}</span>{" "}
                      <span title={state}>{stateLabel(state)}</span>
                    </>
                  }
                  // A state missing from `state_distribution` means zero souls are
                  // in it — a real count, so `?? 0` here is honest.
                  value={stateCount(state)}
                  isLoading={loading}
                />
              ))}
            </div>

            {error && (
              <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {error}
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
              <section>
                {/* 各文明 — ledger rows, all four civilizations. A civilization
                    with no souls is a row saying so, with a way in, not an
                    empty card (规范 v1: 没有灵魂的文明不画空卡片). */}
                <SectionLabel columns="grid grid-cols-[1.3fr_56px_1.4fr]">
                  <span>{t("dashboard.souls_by_civilization")}</span>
                  <span className="text-right">{t("dashboard.chart_souls")}</span>
                  <span className="pl-4">{t("dashboard.civ_share")}</span>
                </SectionLabel>
                {CIVILIZATION_OPTIONS.map((civ) => {
                  const n = civCount(civ);
                  return (
                    <div
                      key={civ}
                      data-civ-row={civ}
                      className="grid min-h-9 grid-cols-[1.3fr_56px_1.4fr] items-center border-b border-[oklch(var(--color-rule))] text-sm"
                    >
                      <span className="flex items-baseline gap-1.5 text-[oklch(var(--color-ink))]">
                        <span aria-hidden="true" className="font-mono text-[oklch(var(--color-ink-subtle))]">{CIVILIZATION_MARK[civ]}</span>
                        <DomainEnum namespace="souls.civilizations" value={civ} />
                      </span>
                      <span className={`text-right font-mono ${n ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-subtle))]"}`}>
                        {loading ? <Skeleton as="span" className="inline-block h-4 w-6" /> : n}
                      </span>
                      <span className="flex items-center gap-2 pl-4">
                        {loading ? null : n > 0 ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="block h-2 min-w-1 bg-[oklch(var(--color-ink))]"
                              style={{ width: `${(n / civMax) * 60}%` }}
                            />
                            <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{sharePercent(n, civTotal)}</span>
                          </>
                        ) : (
                          <Link href="/souls" className="text-xs text-[oklch(var(--color-ink-subtle))] underline">
                            {t("dashboard.civ_empty")}
                          </Link>
                        )}
                      </span>
                    </div>
                  );
                })}

                {/* 生命周期 — the 图例账 that replaces the pie chart. */}
                <SectionLabel className="mt-6">
                  {t("dashboard.state_distribution")}
                  {stats ? ` · ${stats.total_souls}` : ""}
                </SectionLabel>
                {loading ? (
                  <Skeleton className="mt-3 h-24 w-full" />
                ) : (
                  <LegendLedger
                    rows={lifecycleStates.map((state) => ({
                      key: state,
                      label: (
                        <>
                          <span aria-hidden="true" className="font-mono">{soulStateGlyph(state)}</span>{" "}
                          <span title={state}>{stateLabel(state)}</span>
                        </>
                      ),
                      count: stateCount(state),
                      swatchClass: STATE_FILL[state] ?? "bg-[oklch(var(--color-ink-subtle))]",
                    }))}
                  />
                )}
              </section>

              <section>
                <SectionLabel columns="flex justify-between">
                  <span>{t("dashboard.balance_distribution")}</span>
                  {stats ? <span>n = {stats.total_souls}</span> : null}
                </SectionLabel>
                {loading ? (
                  <Skeleton className="mt-3 h-36 w-full" />
                ) : (
                  <BalanceHistogram
                    bars={(stats?.karma_distribution ?? []).map((k) => {
                      const mid = bucketMidpoint(k.label);
                      return { label: k.label, count: k.count, tone: mid < 0 ? "negative" : mid > 0 ? "positive" : "zero" };
                    })}
                  />
                )}

            {/* Recent Activity - grouped by action type */}
            <SectionLabel className="mt-6">{t("dashboard.recent_activity")}</SectionLabel>
            <div className="mt-2">
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-start gap-3 py-2">
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ))}
                </div>
              ) : stats?.recent_activity && stats.recent_activity.length > 0 ? (
                (() => {
                  // Group by action type
                  const grouped: Record<string, typeof stats.recent_activity> = {};
                  stats.recent_activity.forEach((log) => {
                    const action = log.action || "OTHER";
                    if (!grouped[action]) grouped[action] = [];
                    grouped[action].push(log);
                  });

                  const actionColors: Record<string, string> = {
                    CREATE: "bg-[oklch(var(--color-status-success)/0.1)] text-[oklch(var(--color-status-success))] border-[oklch(var(--color-status-success)/0.3)]",
                    UPDATE: "bg-[oklch(var(--color-status-info)/0.1)] text-[oklch(var(--color-status-info))] border-[oklch(var(--color-status-info)/0.3)]",
                    DELETE: "bg-[oklch(var(--color-status-error)/0.1)] text-[oklch(var(--color-status-error))] border-[oklch(var(--color-status-error)/0.3)]",
                    LOGIN: "bg-[oklch(var(--color-verdict-retry)/0.1)] text-[oklch(var(--color-verdict-retry))] border-[oklch(var(--color-verdict-retry)/0.3)]",
                    LOGOUT: "bg-[oklch(var(--color-status-lost)/0.1)] text-[oklch(var(--color-status-lost))] border-[oklch(var(--color-status-lost)/0.3)]",
                    TRANSFER: "bg-[oklch(var(--color-status-warning)/0.1)] text-[oklch(var(--color-status-warning))] border-[oklch(var(--color-status-warning)/0.3)]",
                    JUDGMENT: "bg-[oklch(var(--color-accent)/0.2)] text-[oklch(var(--color-accent-ink))] border-[oklch(var(--color-accent)/0.3)]",
                    OTHER: "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-hairline))]",
                  };

                  return (
                    <div className="space-y-4">
                      {Object.entries(grouped).map(([action, logs]) => (
                        <div key={action}>
                          <div className="flex items-center gap-2 mb-2">
                            {/* `OTHER` is this block's own bucket for rows with no action, not a
                                member the backend emits — so it goes to the screen as a missing
                                value, not as an unrecognised one. */}
                            <DomainEnum
                              namespace="audit.actions"
                              value={action === "OTHER" ? null : action}
                              className={`text-xs px-2 py-1 border font-medium ${actionColors[action] || actionColors.OTHER}`}
                            />
                            <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("dashboard.activity_count", { count: String(logs.length) })}</span>
                          </div>
                          <div className="space-y-1 pl-2 border-l-2 border-[oklch(var(--color-hairline))]">
                            {logs.map((log) => (
                              <div key={log.id} className="flex items-start gap-3 py-1 px-2 hover:bg-[oklch(var(--color-surface-2))] transition-colors">
                                <div className="flex-1 min-w-0">
                                  <span title={log.description || log.resource} className="text-sm text-[oklch(var(--color-ink))] truncate">{log.description || log.resource}</span>
                                  <div className="text-xs text-[oklch(var(--color-ink-muted))]">
                                    {log.user} · {formatTimestamp(log.timestamp)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : error ? null : (
                // Not on error: "no recent activity" would be the failed request
                // speaking as if it had succeeded (the alert above says why).
                <EmptyState title={t("dashboard.no_activity")} />
              )}
            </div>
              </section>
            </div>

            {/* Souls by Realm — a bar chart, not a pie; it stays. */}
            <section>
              <SectionLabel>{t("dashboard.souls_by_realm")}</SectionLabel>
              {loading ? (
                <Skeleton className="mt-3 h-[180px] w-full" />
              ) : realmChartData.length > 0 ? (
                <div className="mt-3">
                  <LazyBarChart data={realmChartData} dataKey="count" fill={CHART_SERIES.realm} height={180} name={t("dashboard.chart_souls")} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("dashboard.no_realm_data")}</p>
              )}
            </section>
          </>
        ) : (
          <RequireAdmin fallback={<PermissionDenied />}>
            {/* Ledger-only cards that don't already appear on the Overview tab */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))]">
                <div className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("admin.avg_balance")}</div>
                {loading ? (
                  <Skeleton className="h-8 w-24 mt-2" />
                ) : (
                  <div data-kpi="" className="text-xl tabular-nums text-[oklch(var(--color-accent-ink))] mt-2">{avgBalance.toFixed(2)}</div>
                )}
              </div>
              <div className="bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))]">
                <div className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-2">{t("admin.state_breakdown")}</div>
                {loading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : (
                  <div className="space-y-1">
                    {stats?.state_distribution?.map((s) => (
                      <div key={s.state} className="flex justify-between text-sm">
                        <span title={s.state} className="text-[oklch(var(--color-ink-muted))]">{stateLabel(s.state, s.label)}</span>
                        <span className="font-medium">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top Souls by Balance Table */}
            <div className="bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))]">
              <h2 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-4">
                {t("admin.top_balance")}
              </h2>
              <DataTable<LedgerStatsOverview["souls_by_realm"][number]>
                caption={t("admin.top_balance")}
                columns={[
                  { key: "realm_name", header: t("admin.realm") },
                  { key: "civilization", header: t("admin.civilization") },
                  { key: "count", header: t("admin.soul_count"), align: "right" },
                ]}
                data={stats?.souls_by_realm?.slice(0, 10) ?? []}
                // The page has an error branch, but it only wraps the pie
                // chart (line ~248). This table sits outside it and reads the
                // same query, so a failure gave it `?? []` and it rendered
                // "no data" beside a chart that said "failed to load".
                // DataTable suppresses its own empty state when isError is
                // set (data-table.tsx:144).
                isError={!!queryError}
                keyExtractor={(realm, idx) => `${realm.realm_code}-${idx}`}
                renderRow={(realm) => (
                  <>
                    <td className="px-4 py-3 text-[oklch(var(--color-ink))]">{realm.realm_name || realm.realm_code}</td>
                    <td className="px-4 py-3 text-[oklch(var(--color-ink-muted))]"><DomainEnum namespace="souls.civilizations" value={realm.civilization} /></td>
                    <td className="px-4 py-3 text-right font-medium">{realm.count}</td>
                  </>
                )}
                emptyMessage={t("admin.no_realm_data")}
              />
            </div>
          </RequireAdmin>
        )}
      </div>
    </PageShell>
  );
}

export default function DashboardPage() {
  // 不是 `min-h-screen`:AppLayout 给的槽位已经是 min-h-[calc(100vh-4rem)],
  // 再写一次就永远多出 64px 死滚动(PageShell 文件头第 3 条)。
  return (
    <Suspense fallback={<div className="min-h-[60vh] bg-[oklch(var(--color-canvas))]" />}>
      <DashboardContent />
    </Suspense>
  );
}
