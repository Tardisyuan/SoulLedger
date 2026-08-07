"use client";

import React, { Suspense, useCallback } from "react";
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
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { STATE_COLORS, CIVILIZATION_COLORS, REALM_COLORS, CHART_SERIES } from "@/lib/chart-colors";
import { MenuGloss } from "@/src/components/layout/MenuGloss";

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

  // Page header renders immediately
  const pageHeader = (
    <div className="border-b border-[hsl(var(--color-hairline))] pb-4 flex justify-between items-start">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--color-accent-ink))]">
          {t("dashboard.title")}
          <MenuGloss path="/dashboard" />
        </h1>
        <p className="text-[hsl(var(--color-ink-muted))] text-sm mt-1">{t("dashboard.subtitle")}</p>
      </div>
      <RequirePermission permissions="karma.export">
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] text-black font-medium rounded transition-colors text-sm"
        >
          {t("dashboard.export_stats")}
        </button>
      </RequirePermission>
    </div>
  );

  const tabs: { key: DashboardTab; label: string }[] = [
    { key: "overview", label: t("dashboard.tab_overview") },
    { key: "ledger", label: t("admin.ledger_stats") },
  ];

  // The API hands back an English `label` per state ("Alive", "Judging", ...).
  // Prefer the translated enum so the chart legend and the compact list follow
  // the language picker; fall back to the API label if a key is ever missing
  // (t() returns the key itself when it can't resolve one).
  const stateLabel = (state: string, apiLabel?: string) => {
    const key = `souls.states.${state}`;
    const translated = t(key);
    return translated === key ? apiLabel || state : translated;
  };

  const stateData = stats?.state_distribution.map((s) => ({
    name: stateLabel(s.state, s.label),
    value: s.count,
    color: STATE_COLORS[s.state] || CHART_SERIES.neutral,
  })) ?? [];

  const tenantData = stats?.tenants.map((tenant) => ({
    name: getDisplayNameForTenant(tenant.tenant_code),
    total: tenant.total_souls,
    ...tenant.state_breakdown,
  })) ?? [];

  const realmChartData = stats?.souls_by_realm.map((r) => ({
    name: r.realm_name,
    count: r.count,
    civilization: r.civilization,
  })) ?? [];

  const formatTimestamp = (ts: string) => formatDateTime(ts);

  // Ledger-tab-only derived data (admin/stats page's unique cards)
  const avgBalance = stats
    ? stats.karma_distribution.reduce((sum, k) => sum + bucketMidpoint(k.label) * k.count, 0) /
      (stats.total_souls || 1)
    : 0;

  return (
    <div className="min-h-screen bg-canvas text-[hsl(var(--color-ink))] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header - renders immediately */}
        {pageHeader}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[hsl(var(--color-hairline))]/50">
          {tabs.map((tabItem) => {
            const button = (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
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
              <RequirePermission key={tabItem.key} permissions="ADMIN">
                {button}
              </RequirePermission>
            ) : (
              button
            );
          })}
        </div>

        {activeTab === "overview" ? (
          <>
            {/* Summary cards - each loads independently */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label={t("dashboard.total_souls")} value={stats?.total_souls} isLoading={loading} />
              <StatCard
                label={t("dashboard.alive")}
                value={stats?.state_distribution.find(s => s.state === "ALIVE")?.count}
                isLoading={loading}
                color="text-[hsl(var(--color-status-success))]"
              />
              <StatCard
                label={t("dashboard.under_judgment")}
                value={stats?.state_distribution.find(s => s.state === "JUDGING")?.count}
                isLoading={loading}
                color="text-[hsl(var(--color-accent-ink))]"
              />
              <StatCard
                label={t("dashboard.disposed")}
                value={stats?.state_distribution.find(s => s.state === "DISPOSED")?.count}
                isLoading={loading}
                color="text-[hsl(var(--color-status-lost))]"
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* State distribution pie chart */}
              <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.state_distribution")}</h2>
                {loading ? (
                  <div className="h-[240px] flex items-center justify-center">
                    <Skeleton className="h-[200px] w-[200px] rounded-full" />
                  </div>
                ) : error ? (
                  <div className="h-[240px] flex items-center justify-center text-[hsl(var(--color-status-error))]">{error}</div>
                ) : (
                  <LazyDashboardPieChart data={stateData} />
                )}
              </div>

              {/* tenant comparison bar chart */}
              <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.souls_by_civilization")}</h2>
                {loading ? (
                  <div className="h-[240px] flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : (
                  <LazyBarChart data={tenantData} dataKey="total" name={t("dashboard.total_souls")} />
                )}
              </div>
            </div>

            {/* Per-tenant breakdown */}
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
              <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.per_civilization_breakdown")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-[hsl(var(--color-surface-2))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
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
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: CIVILIZATION_COLORS[stats.tenants[i].tenant_code] || "#6b7280" }}
                          />
                          <span className="font-medium text-[hsl(var(--color-ink))]">{stats.tenants[i].tenant_name || stats.tenants[i].tenant_code}</span>
                        </div>
                        <div className="text-2xl font-bold text-[hsl(var(--color-accent-ink))] mb-3">{stats.tenants[i].total_souls}</div>
                        <div className="space-y-1">
                          {Object.entries(stats.tenants[i].state_breakdown).map(([state, count]) => (
                            <div key={state} className="flex justify-between text-xs">
                              <span className="text-[hsl(var(--color-ink-muted))]">{stateLabel(state)}</span>
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
              <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.balance_distribution")}</h2>
                {loading ? (
                  <div className="h-[180px] flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : (
                  <LazyBarChart data={stats?.karma_distribution ?? []} dataKey="count" fill={CHART_SERIES.balance} height={180} name={t("dashboard.chart_souls")} />
                )}
              </div>

              {/* Souls by Realm */}
              <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.souls_by_realm")}</h2>
                {loading ? (
                  <div className="h-[180px] flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
                ) : realmChartData.length > 0 ? (
                  <LazyBarChart data={realmChartData} dataKey="count" fill={CHART_SERIES.realm} height={180} name={t("dashboard.chart_souls")} />
                ) : (
                  <div className="h-[180px] flex items-center justify-center text-[hsl(var(--color-ink-muted))] text-sm">
                    {t("dashboard.no_realm_data")}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity - grouped by action type */}
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
              <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.recent_activity")}</h2>
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
                            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${actionColors[action] || actionColors.OTHER}`}>
                              {action}
                            </span>
                            <span className="text-xs text-[hsl(var(--color-ink-muted))]">{logs.length} {logs.length === 1 ? "action" : "actions"}</span>
                          </div>
                          <div className="space-y-1 pl-2 border-l-2 border-[hsl(var(--color-hairline))]">
                            {logs.map((log) => (
                              <div key={log.id} className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-[hsl(var(--color-surface-2))] transition-colors">
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm text-[hsl(var(--color-ink))] truncate">{log.description || log.resource}</span>
                                  <div className="text-xs text-[hsl(var(--color-ink-muted))]">
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
                <div className="py-8 text-center text-[hsl(var(--color-ink-muted))] text-sm">
                  {t("dashboard.no_activity")}
                </div>
              )}
            </div>
          </>
        ) : (
          <RequirePermission permissions="ADMIN" fallback={<PermissionDenied />}>
            {/* Ledger-only cards that don't already appear on the Overview tab */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
                <div className="text-sm text-[hsl(var(--color-ink-muted))] uppercase tracking-wide">{t("admin.avg_balance")}</div>
                {loading ? (
                  <Skeleton className="h-8 w-24 mt-2" />
                ) : (
                  <div className="text-3xl font-bold text-[hsl(var(--color-accent-ink))] mt-2">{avgBalance.toFixed(2)}</div>
                )}
              </div>
              <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
                <div className="text-sm text-[hsl(var(--color-ink-muted))] uppercase tracking-wide mb-2">{t("admin.state_breakdown")}</div>
                {loading ? (
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : (
                  <div className="space-y-1">
                    {stats?.state_distribution.map((s) => (
                      <div key={s.state} className="flex justify-between text-sm">
                        <span className="text-[hsl(var(--color-ink-muted))]">{stateLabel(s.state, s.label)}</span>
                        <span className="font-medium">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top Souls by Balance Table */}
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
              <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">
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
                keyExtractor={(realm, idx) => `${realm.realm_code}-${idx}`}
                renderRow={(realm) => (
                  <>
                    <td className="px-4 py-3 text-[hsl(var(--color-ink))]">{realm.realm_name || realm.realm_code}</td>
                    <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">{realm.civilization}</td>
                    <td className="px-4 py-3 text-right font-medium">{realm.count}</td>
                  </>
                )}
                emptyMessage={t("admin.no_realm_data")}
              />
            </div>
          </RequirePermission>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <DashboardContent />
    </Suspense>
  );
}

function StatCardInner({
  label,
  value,
  isLoading,
  color = "text-[hsl(var(--color-ink))]",
}: {
  label: string;
  value?: number;
  isLoading: boolean;
  color?: string;
}) {
  return (
    <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
      <div className="text-xs text-[hsl(var(--color-ink-muted))] uppercase mb-1">{label}</div>
      {isLoading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className={`text-2xl font-bold ${color}`}>{value ?? 0}</div>
      )}
    </div>
  );
}

const StatCard = React.memo(StatCardInner);
