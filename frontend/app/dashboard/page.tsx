"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { karmaApi, KarmaStatsOverview } from "@/lib/api";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { getDisplayNameForTenant } from "@/src/config/civilizations";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "#10b981",
  JUDGING: "#f59e0b",
  DISPOSED: "#6b7280",
  REINCARNATING: "#3b82f6",
  LOST: "#374151",
};

const CIVILIZATION_COLORS: Record<string, string> = {
  CN_DIYU: "#ef4444",
  EU_HEAVEN_HELL: "#3b82f6",
  EG_DUAT: "#f59e0b",
};

const REALM_COLORS: Record<string, string> = {
  HELL: "#ef4444",
  PURGATORY: "#f59e0b",
  BLISS: "#10b981",
  NEUTRAL: "#6b7280",
};

export default function DashboardPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [stats, setStats] = useState<KarmaStatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    karmaApi.statsOverview()
      .then((res) => {
        setStats(res.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load statistics");
        setLoading(false);
      });
  }, []);

  const handleExport = async () => {
    try {
      const response = await karmaApi.exportStats();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "souls_karma_export.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      showToast("Failed to export statistics", "error");
    }
  };

  // Page header renders immediately
  const pageHeader = (
    <div className="border-b border-[hsl(var(--color-hairline))] pb-4 flex justify-between items-start">
      <div>
        <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))]">{t("dashboard.title")}</h1>
        <p className="text-[hsl(var(--color-ink-muted))] text-sm mt-1">{t("dashboard.subtitle")}</p>
      </div>
      <button
        onClick={handleExport}
        className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] text-black font-medium rounded transition-colors text-sm"
      >
        {t("dashboard.export_stats")}
      </button>
    </div>
  );

  const stateData = stats?.state_distribution.map((s) => ({
    name: s.label,
    value: s.count,
    color: STATE_COLORS[s.state] || "#6b7280",
  })) ?? [];

  const tenantData = stats?.tenants.map((t) => ({
    name: getDisplayNameForTenant(t.tenant_code),
    total: t.total_souls,
    ...t.state_breakdown,
  })) ?? [];

  const realmChartData = stats?.souls_by_realm.map((r) => ({
    name: r.realm_name,
    count: r.count,
    civilization: r.civilization,
  })) ?? [];

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-canvas text-[hsl(var(--color-ink))] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header - renders immediately */}
        {pageHeader}

        {/* Summary cards - each loads independently */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label={t("dashboard.total_souls")} value={stats?.total_souls} isLoading={loading} />
          <StatCard
            label={t("dashboard.alive")}
            value={stats?.state_distribution.find(s => s.state === "ALIVE")?.count}
            isLoading={loading}
            color="text-emerald-400"
          />
          <StatCard
            label={t("dashboard.under_judgment")}
            value={stats?.state_distribution.find(s => s.state === "JUDGING")?.count}
            isLoading={loading}
            color="text-[hsl(var(--color-accent))]"
          />
          <StatCard
            label={t("dashboard.disposed")}
            value={stats?.state_distribution.find(s => s.state === "DISPOSED")?.count}
            isLoading={loading}
            color="text-gray-400"
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
              <div className="h-[240px] flex items-center justify-center text-red-400">{error}</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={stateData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {stateData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#0f1011", border: "1px solid #23252a", borderRadius: "6px", fontSize: 12 }}
                  />
                  <Legend
                    formatter={(value) => <span style={{ color: "#8a8f98", fontSize: 12 }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={tenantData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252a" />
                  <XAxis dataKey="name" tick={{ fill: "#8a8f98", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8a8f98", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0f1011", border: "1px solid #23252a", borderRadius: "6px", fontSize: 12 }}
                  />
                  <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} name={t("dashboard.total_souls")} />
                </BarChart>
              </ResponsiveContainer>
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
                    <div className="text-2xl font-bold text-[hsl(var(--color-accent))] mb-3">{stats.tenants[i].total_souls}</div>
                    <div className="space-y-1">
                      {Object.entries(stats.tenants[i].state_breakdown).map(([state, count]) => (
                        <div key={state} className="flex justify-between text-xs">
                          <span className="text-[hsl(var(--color-ink-muted))]">{state}</span>
                          <span style={{ color: STATE_COLORS[state] || "#8a8f98" }}>{count as number}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Karma distribution and Souls by Realm */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Karma distribution */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-4">{t("dashboard.karma_distribution")}</h2>
            {loading ? (
              <div className="h-[180px] flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={stats?.karma_distribution ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252a" />
                  <XAxis dataKey="label" tick={{ fill: "#8a8f98", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8a8f98", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0f1011", border: "1px solid #23252a", borderRadius: "6px", fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Souls" />
                </BarChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={realmChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252a" />
                  <XAxis dataKey="name" tick={{ fill: "#8a8f98", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8a8f98", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#0f1011", border: "1px solid #23252a", borderRadius: "6px", fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Souls" />
                </BarChart>
              </ResponsiveContainer>
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
                CREATE: "bg-green-500/20 text-green-400 border-green-500/30",
                UPDATE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
                DELETE: "bg-red-500/20 text-red-400 border-red-500/30",
                LOGIN: "bg-purple-500/20 text-purple-400 border-purple-500/30",
                LOGOUT: "bg-gray-500/20 text-gray-400 border-gray-500/30",
                TRANSFER: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
                JUDGMENT: "bg-orange-500/20 text-orange-400 border-orange-500/30",
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
      </div>
    </div>
  );
}

function StatCard({
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
