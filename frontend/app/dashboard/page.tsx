"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { ledgerApi, LedgerStatsOverview } from "@/lib/api";
import {
  LazyDashboardPieChart,
  LazyBarChart,
} from "@/src/components/charts/LazyDashboardCharts";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { getDisplayNameForTenant } from "@/src/config/civilizations";
import { RequireAdmin, RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { useChartColors } from "@/src/hooks/useChartColors";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
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

function DashboardContent() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  // Recharts fills are literals and do not follow the `.light` cascade, so the
  // theme has to pick the table. `REALM_COLORS` used to be imported here and
  // never read — the realm histogram is single-series and fills with
  // CHART_SERIES.realm — so it is not destructured.
  const { STATE_COLORS, CIVILIZATION_COLORS, CHART_SERIES } = useChartColors();
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

  const handleExport = async () => {
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
      <Button type="button" variant="primary" onClick={handleExport}>
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
        onClick={() => setTab(tabItem.key)}
        className={`px-4 py-2 text-03 font-medium transition-colors border-b-2 -mb-px ${
          activeTab === tabItem.key
            ? "text-[hsl(var(--color-accent-ink))] border-[hsl(var(--color-accent))]"
            : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
        }`}
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

  const stateData = stats?.state_distribution?.map((s) => ({
    name: stateLabel(s.state, s.label),
    value: s.count,
    color: STATE_COLORS[s.state] || CHART_SERIES.neutral,
  })) ?? [];

  // One colour per tenant, from the same map as the swatches on the cards
  // below. This chart used to take LazyBarChart's own `"#f59e0b"` default, so
  // four cosmologies were drawn as one amber series directly above four cards
  // that each carried their own mark — the chart said "one category, four
  // sizes" and the cards said "four categories". The swatch was never the
  // redundant half: it is the legend, and this is the thing it keys.
  //
  // `CHART_SERIES.neutral` for a tenant this deployment has no mark for, the
  // same refusal `CIVILIZATION_COLORS` makes by not having an entry — a grey
  // bar says "unmapped", and borrowing a neighbour's hue would say something
  // false about which cosmology it is.
  const tenantData = stats?.tenants?.map((tenant) => ({
    name: getDisplayNameForTenant(tenant.tenant_code),
    total: tenant.total_souls,
    color: CIVILIZATION_COLORS[tenant.tenant_code] ?? CHART_SERIES.neutral,
    ...tenant.state_breakdown,
  })) ?? [];

  const realmChartData = stats?.souls_by_realm?.map((r) => ({
    name: r.realm_name,
    count: r.count,
    civilization: r.civilization,
  })) ?? [];

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
            {/* Summary cards - each loads independently */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label={t("dashboard.total_souls")} value={stats?.total_souls} isLoading={loading} />
              <StatCard
                label={t("dashboard.alive")}
                value={stats?.state_distribution?.find(s => s.state === "ALIVE")?.count}
                isLoading={loading}
                color="text-[hsl(var(--color-status-success))]"
              />
              <StatCard
                label={t("dashboard.under_judgment")}
                value={stats?.state_distribution?.find(s => s.state === "JUDGING")?.count}
                isLoading={loading}
                color="text-[hsl(var(--color-accent-ink))]"
              />
              <StatCard
                label={t("dashboard.disposed")}
                value={stats?.state_distribution?.find(s => s.state === "DISPOSED")?.count}
                isLoading={loading}
                color="text-[hsl(var(--color-status-lost))]"
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* State distribution pie chart */}
              <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">{t("dashboard.state_distribution")}</h2>
                {loading ? (
                  <div className="h-[240px] flex items-center justify-center">
                    <Skeleton className="h-[200px] w-[200px] rounded-full" />
                  </div>
                ) : error ? (
                  <div className="h-[240px] flex items-center justify-center text-[hsl(var(--color-status-error))]">{error}</div>
                ) : (
                  <LazyDashboardPieChart data={stateData} fallbackFill={CHART_SERIES.neutral} />
                )}
              </div>

              {/* tenant comparison bar chart */}
              <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">{t("dashboard.souls_by_civilization")}</h2>
                {loading ? (
                  <div className="h-[240px] flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : (
                  <LazyBarChart data={tenantData} dataKey="total" fill={CHART_SERIES.neutral} name={t("dashboard.total_souls")} />
                )}
              </div>
            </div>

            {/* Per-tenant breakdown */}
            <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
              <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">{t("dashboard.per_civilization_breakdown")}</h2>
              {/* `md:grid-cols-3` alongside a hardcoded three cards was
                  self-consistent and wrong together; with four civilizations
                  the fourth card needs somewhere to go. */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Driven by the data, not by a fixed count. This read
                    `[0, 1, 2]`, so the fourth civilization never appeared:
                    measured 2026-08-29 with four tenants seeded, the page
                    showed 中国地府 / 欧洲炼狱 / 埃及杜阿特 and no 希腊冥府 --
                    while the bar chart directly above drew four bars and four
                    swatches. Two views on one screen answering "how many
                    civilizations are there" differently.

                    The loading branch keeps a fixed length on purpose: with no
                    data yet there is nothing to take a count from, and three
                    skeletons are a guess at the layout rather than a claim
                    about the world. (The other `[0, 1, 2]` in this file, in
                    the recent-activity skeleton, is that same kind and stays.) */}
                {(loading
                  ? [0, 1, 2]
                  : (stats?.tenants ?? []).map((_, i) => i)
                ).map((i) => (
                  <div key={i} className="bg-[hsl(var(--color-surface-2))] p-4 border border-[hsl(var(--color-hairline))]">
                    {loading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    ) : stats?.tenants[i] ? (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          {/* The same neutral the bars above fall back to, and
                              that is the point. This swatch is the chart's
                              legend; when it said `#6b7280` and the bar said
                              CHART_SERIES.neutral, an unmapped tenant was drawn
                              in two different greys — the legend disagreeing
                              with its own chart in the smaller way, one
                              viewport after the larger one was fixed. The
                              literal was also fixed across both themes, where
                              every other neutral in the app moves. */}
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor:
                                CIVILIZATION_COLORS[stats.tenants[i].tenant_code] ?? CHART_SERIES.neutral,
                            }}
                          />
                          <span className="font-medium text-[hsl(var(--color-ink))]">{stats.tenants[i].tenant_name || stats.tenants[i].tenant_code}</span>
                        </div>
                        <div className="text-06 tabular-nums text-[hsl(var(--color-accent-ink))] mb-3">{groupDigits(stats.tenants[i].total_souls)}</div>
                        <div className="space-y-1">
                          {Object.entries(stats.tenants[i].state_breakdown).map(([state, count]) => (
                            <div key={state} className="flex justify-between text-02">
                              <span title={state} className="text-[hsl(var(--color-ink-muted))]">{stateLabel(state)}</span>
                              <span style={{ color: STATE_COLORS[state] || CHART_SERIES.neutral }}>{count as number}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Balance distribution and Souls by Realm */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Balance distribution */}
              <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">{t("dashboard.balance_distribution")}</h2>
                {loading ? (
                  <div className="h-[180px] flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : (
                  <LazyBarChart data={stats?.karma_distribution ?? []} dataKey="count" nameKey="label" fill={CHART_SERIES.balance} height={180} name={t("dashboard.chart_souls")} />
                )}
              </div>

              {/* Souls by Realm */}
              <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">{t("dashboard.souls_by_realm")}</h2>
                {loading ? (
                  <div className="h-[180px] flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : realmChartData.length > 0 ? (
                  <LazyBarChart data={realmChartData} dataKey="count" fill={CHART_SERIES.realm} height={180} name={t("dashboard.chart_souls")} />
                ) : (
                  <div className="h-[180px] flex items-center justify-center text-[hsl(var(--color-ink-muted))] text-03">
                    {t("dashboard.no_realm_data")}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity - grouped by action type */}
            <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
              <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">{t("dashboard.recent_activity")}</h2>
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
                    CREATE: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.3)]",
                    UPDATE: "bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))] border-[hsl(var(--color-status-info)/0.3)]",
                    DELETE: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.3)]",
                    LOGIN: "bg-[hsl(var(--color-verdict-retry)/0.1)] text-[hsl(var(--color-verdict-retry))] border-[hsl(var(--color-verdict-retry)/0.3)]",
                    LOGOUT: "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))] border-[hsl(var(--color-status-lost)/0.3)]",
                    TRANSFER: "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.3)]",
                    JUDGMENT: "bg-[hsl(var(--color-accent)/0.2)] text-[hsl(var(--color-accent-ink))] border-[hsl(var(--color-accent)/0.3)]",
                    OTHER: "bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] border-[hsl(var(--color-hairline))]",
                  };

                  return (
                    <div className="space-y-4">
                      {Object.entries(grouped).map(([action, logs]) => (
                        <div key={action}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-02 px-2 py-1 border font-medium ${actionColors[action] || actionColors.OTHER}`}>
                              {action}
                            </span>
                            <span className="text-02 text-[hsl(var(--color-ink-muted))]">{logs.length} {logs.length === 1 ? "action" : "actions"}</span>
                          </div>
                          <div className="space-y-1 pl-2 border-l-2 border-[hsl(var(--color-hairline))]">
                            {logs.map((log) => (
                              <div key={log.id} className="flex items-start gap-3 py-1 px-2 hover:bg-[hsl(var(--color-surface-2))] transition-colors">
                                <div className="flex-1 min-w-0">
                                  <span className="text-03 text-[hsl(var(--color-ink))] truncate">{log.description || log.resource}</span>
                                  <div className="text-02 text-[hsl(var(--color-ink-muted))]">
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
              ) : (
                <EmptyState title={t("dashboard.no_activity")} />
              )}
            </div>
          </>
        ) : (
          <RequireAdmin fallback={<PermissionDenied />}>
            {/* Ledger-only cards that don't already appear on the Overview tab */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
                <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("admin.avg_balance")}</div>
                {loading ? (
                  <Skeleton className="h-8 w-24 mt-2" />
                ) : (
                  <div data-kpi="" className="text-08 tabular-nums text-[hsl(var(--color-accent-ink))] mt-2">{avgBalance.toFixed(2)}</div>
                )}
              </div>
              <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
                <div className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-2">{t("admin.state_breakdown")}</div>
                {loading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : (
                  <div className="space-y-1">
                    {stats?.state_distribution?.map((s) => (
                      <div key={s.state} className="flex justify-between text-03">
                        <span title={s.state} className="text-[hsl(var(--color-ink-muted))]">{stateLabel(s.state, s.label)}</span>
                        <span className="font-medium">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top Souls by Balance Table */}
            <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
              <h2 className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] mb-4">
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
                    <td className="px-4 py-3 text-[hsl(var(--color-ink))]">{realm.realm_name || realm.realm_code}</td>
                    <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]"><DomainEnum namespace="souls.civilizations" value={realm.civilization} /></td>
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
    <Suspense fallback={<div className="min-h-[60vh] bg-canvas" />}>
      <DashboardContent />
    </Suspense>
  );
}
