"use client";

import { useQuery } from "@tanstack/react-query";
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

const STATE_COLORS: Record<string, string> = {
  ALIVE: "#10b981",
  JUDGING: "#f59e0b",
  DISPOSED: "#6b7280",
  REINCARNATING: "#3b82f6",
  LOST: "#4b5563",
};

const CHART_COLORS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export default function AdminStatsPage() {
  const { t } = useI18n();

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["karma-stats"],
    queryFn: () => karmaApi.statsOverview().then(res => res.data),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  async function handleExport() {
    try {
      const res = await karmaApi.exportStats({ format: "csv" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "karma_stats.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      console.error("Export failed:", e);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center">
        <div className="text-ink-muted">Loading statistics...</div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center gap-4">
        <div className="text-red-400">{String(error || "Failed to load statistics")}</div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-surface-1 border border-hairline rounded-md text-sm hover:bg-surface-2"
        >
          Retry
        </button>
      </div>
    );
  }

  const stateData = stats.state_distribution.map((s) => ({
    name: s.label || s.state,
    value: s.count,
    fill: STATE_COLORS[s.state] || "#6b7280",
  }));

  const karmaDistData = stats.karma_distribution.map((k) => ({
    name: k.label,
    count: k.count,
  }));

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Header */}
      <div className="border-b border-hairline px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-amber-400">Karma Statistics</h1>
          <p className="text-sm text-ink-muted mt-0.5">System-wide karmic overview</p>
        </div>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-surface-1 border border-hairline hover:bg-surface-2 text-ink-muted rounded-md text-sm transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <div className="text-sm text-ink-muted uppercase tracking-wide">Total Souls</div>
            <div className="text-3xl font-bold text-amber-400 mt-2">
              {stats.total_souls.toLocaleString()}
            </div>
          </div>
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <div className="text-sm text-ink-muted uppercase tracking-wide">Avg Karma Balance</div>
            <div className="text-3xl font-bold mt-2">
              {(stats.karma_distribution.reduce((sum, k) => {
                // Parse label like "< -50", "-50 to -20", "-5 to 5", "> 50" to get midpoint
                const label = k.label;
                let midVal = 0;
                if (label.startsWith("<")) {
                  midVal = parseFloat(label.replace("<", "").trim()) - 10;
                } else if (label.startsWith(">")) {
                  midVal = parseFloat(label.replace(">", "").trim()) + 10;
                } else {
                  const parts = label.split(" to ");
                  if (parts.length === 2) {
                    midVal = (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
                  }
                }
                return sum + midVal * k.count;
              }, 0) / (stats.total_souls || 1)).toFixed(2)}
            </div>
          </div>
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <div className="text-sm text-ink-muted uppercase tracking-wide">State Breakdown</div>
            <div className="mt-2 space-y-1">
              {stats.state_distribution.map((s) => (
                <div key={s.state} className="flex justify-between text-sm">
                  <span className="text-ink-muted">{s.label || s.state}</span>
                  <span className="font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* State Distribution Pie */}
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">
              Soul State Distribution
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={stateData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {stateData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#0f1011",
                    border: "1px solid #23252a",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value) => <span className="text-ink-muted">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Karma Distribution Bar */}
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">
              Karma Score Distribution
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={karmaDistData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252a" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#8a8f98", fontSize: 10 }}
                  axisLine={{ stroke: "#23252a" }}
                  tickLine={{ stroke: "#23252a" }}
                />
                <YAxis
                  tick={{ fill: "#8a8f98", fontSize: 10 }}
                  axisLine={{ stroke: "#23252a" }}
                  tickLine={{ stroke: "#23252a" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f1011",
                    border: "1px solid #23252a",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Karma Souls Table */}
        <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
          <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">
            Top Karma Souls
          </h2>
          {stats.souls_by_realm && stats.souls_by_realm.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-muted border-b border-hairline">
                    <th className="pb-2 font-medium">Realm</th>
                    <th className="pb-2 font-medium">Civilization</th>
                    <th className="pb-2 font-medium text-right">Soul Count</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.souls_by_realm.slice(0, 10).map((realm, idx) => (
                    <tr
                      key={`${realm.realm_code}-${idx}`}
                      className="border-b border-hairline/50"
                    >
                      <td className="py-2 text-ink">{realm.realm_name || realm.realm_code}</td>
                      <td className="py-2 text-ink-muted">{realm.civilization}</td>
                      <td className="py-2 text-right font-medium">{realm.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-ink-muted py-8">No realm data available</div>
          )}
        </div>

        {/* Tenant Breakdown */}
        {stats.tenants && stats.tenants.length > 0 && (
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">
              Tenant Breakdown
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.tenants.map((tenant) => (
                <div
                  key={tenant.tenant_code}
                  className="bg-surface-2 rounded-lg p-4 border border-hairline"
                >
                  <div className="font-medium text-ink mb-2">
                    {tenant.tenant_name || tenant.tenant_code}
                  </div>
                  <div className="text-2xl font-bold text-amber-400">
                    {tenant.total_souls}
                  </div>
                  <div className="text-xs text-ink-muted mt-1">souls</div>
                  <div className="mt-3 space-y-1">
                    {Object.entries(tenant.state_breakdown).map(([state, count]) => (
                      <div key={state} className="flex justify-between text-xs">
                        <span className="text-ink-subtle">{state}</span>
                        <span className="text-ink-muted">{count as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {stats.recent_activity && stats.recent_activity.length > 0 && (
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-4">
              Recent Activity
            </h2>
            <div className="space-y-2">
              {stats.recent_activity.slice(0, 10).map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between py-2 border-b border-hairline/50 text-sm"
                >
                  <div>
                    <span className="text-amber-400">{activity.action}</span>
                    <span className="text-ink-muted"> on {activity.resource}</span>
                    <span className="text-ink-subtle"> #{activity.resource_id}</span>
                  </div>
                  <div className="text-ink-subtle text-xs">
                    {new Date(activity.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
