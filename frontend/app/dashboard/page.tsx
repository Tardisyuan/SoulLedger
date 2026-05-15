"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
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
      alert("Failed to export statistics");
    }
  };

  // Page header renders immediately
  const pageHeader = (
    <div className="border-b border-hairline pb-4 flex justify-between items-start">
      <div>
        <h1 className="text-2xl font-bold text-amber-400">{t("dashboard.title")}</h1>
        <p className="text-ink-muted text-sm mt-1">{t("dashboard.subtitle")}</p>
      </div>
      <button
        onClick={handleExport}
        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded transition-colors text-sm"
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
    name: t.tenant_code.replace("CN_DIYU", "Chinese").replace("EU_HEAVEN_HELL", "European").replace("EG_DUAT", "Egyptian"),
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
    <div className="min-h-screen bg-canvas text-ink p-6">
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
            color="text-amber-400"
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
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">{t("dashboard.state_distribution")}</h2>
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
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">{t("dashboard.souls_by_civilization")}</h2>
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
        <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
          <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">{t("dashboard.per_civilization_breakdown")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-surface-2 rounded-lg p-4 border border-hairline">
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
                      <span className="font-medium text-ink">{stats.tenants[i].tenant_name || stats.tenants[i].tenant_code}</span>
                    </div>
                    <div className="text-2xl font-bold text-amber-400 mb-3">{stats.tenants[i].total_souls}</div>
                    <div className="space-y-1">
                      {Object.entries(stats.tenants[i].state_breakdown).map(([state, count]) => (
                        <div key={state} className="flex justify-between text-xs">
                          <span className="text-ink-muted">{state}</span>
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
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">{t("dashboard.karma_distribution")}</h2>
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
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">{t("dashboard.souls_by_realm")}</h2>
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
              <div className="h-[180px] flex items-center justify-center text-ink-muted text-sm">
                {t("dashboard.no_realm_data")}
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
          <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">{t("dashboard.recent_activity")}</h2>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          ) : stats?.recent_activity && stats.recent_activity.length > 0 ? (
            <div className="space-y-2">
              {stats.recent_activity.map((log) => (
                <div key={log.id} className="flex items-start gap-3 py-2 border-b border-hairline last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-surface-2 text-ink-muted">{log.action}</span>
                      <span className="text-sm font-medium text-ink truncate">{log.description || log.resource}</span>
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      {log.user} · {formatTimestamp(log.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-ink-muted text-sm">
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
  color = "text-ink",
}: {
  label: string;
  value?: number;
  isLoading: boolean;
  color?: string;
}) {
  return (
    <div className="bg-surface-1 rounded-lg p-4 border border-hairline">
      <div className="text-xs text-ink-muted uppercase mb-1">{label}</div>
      {isLoading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className={`text-2xl font-bold ${color}`}>{value ?? 0}</div>
      )}
    </div>
  );
}
