"use client";
import { useQuery } from "@tanstack/react-query";
import { karmaApi, type KarmaStatsOverview } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";

export default function KarmaPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["karma", "stats", "overview"],
    queryFn: () => karmaApi.statsOverview().then(r => r.data),
    enabled: !!user,
  });

  if (isLoading) return <div className="p-6">{t("common.loading")}</div>;

  if (!stats) {
    return <div className="p-6 text-ink-muted">{t("karma.no_data") || "暂无数据"}</div>;
  }

  const karmaStats = stats as KarmaStatsOverview;

  return (
    <div className="p-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("karma.title") || "功德统计"}</h1>
        <p className="text-ink-subtle mt-1">{t("karma.subtitle") || "灵魂功德 overview"}</p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-surface-1 border border-hairline rounded-lg p-4">
          <div className="text-sm text-ink-muted">{t("karma.total_souls") || "总灵魂数"}</div>
          <div className="text-3xl font-bold text-amber-400 mt-1">{karmaStats.total_souls}</div>
        </div>
        <div className="bg-surface-1 border border-hairline rounded-lg p-4">
          <div className="text-sm text-ink-muted">{t("karma.active_souls") || "活跃灵魂"}</div>
          <div className="text-3xl font-bold text-green-400 mt-1">
            {karmaStats.state_distribution.find(s => s.state === "ALIVE")?.count ?? 0}
          </div>
        </div>
        <div className="bg-surface-1 border border-hairline rounded-lg p-4">
          <div className="text-sm text-ink-muted">{t("karma.judging_souls") || "审判中"}</div>
          <div className="text-3xl font-bold text-amber-500 mt-1">
            {karmaStats.state_distribution.find(s => s.state === "JUDGING")?.count ?? 0}
          </div>
        </div>
      </div>

      {/* State Distribution */}
      <div className="bg-surface-1 border border-hairline rounded-lg p-4">
        <h2 className="text-lg font-semibold text-ink mb-4">
          {t("karma.state_distribution") || "状态分布"}
        </h2>
        <div className="space-y-2">
          {karmaStats.state_distribution.map((item) => (
            <div key={item.state} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${
                  item.state === "ALIVE" ? "bg-green-500" :
                  item.state === "JUDGING" ? "bg-amber-500" :
                  item.state === "DISPOSED" ? "bg-gray-500" :
                  item.state === "REINCARNATING" ? "bg-blue-500" :
                  "bg-red-500"
                }`} />
                <span className="text-sm text-ink">{item.label}</span>
              </div>
              <span className="text-sm font-mono text-ink-muted">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Karma Distribution */}
      <div className="bg-surface-1 border border-hairline rounded-lg p-4">
        <h2 className="text-lg font-semibold text-ink mb-4">
          {t("karma.karma_distribution") || "功德分布"}
        </h2>
        <div className="space-y-2">
          {karmaStats.karma_distribution.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-sm text-ink">{item.label}</span>
              <span className="text-sm font-mono text-amber-400">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Souls by Realm */}
      {karmaStats.souls_by_realm && karmaStats.souls_by_realm.length > 0 && (
        <div className="bg-surface-1 border border-hairline rounded-lg p-4">
          <h2 className="text-lg font-semibold text-ink mb-4">
            {t("karma.souls_by_realm") || "各领域灵魂数"}
          </h2>
          <div className="space-y-2">
            {karmaStats.souls_by_realm.map((item) => (
              <div key={item.realm_code} className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-ink">{item.realm_name}</span>
                  <span className="text-xs text-ink-muted ml-2">({item.civilization})</span>
                </div>
                <span className="text-sm font-mono text-ink-muted">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {karmaStats.recent_activity && karmaStats.recent_activity.length > 0 && (
        <div className="bg-surface-1 border border-hairline rounded-lg p-4">
          <h2 className="text-lg font-semibold text-ink mb-4">
            {t("karma.recent_activity") || "最近活动"}
          </h2>
          <div className="space-y-3">
            {karmaStats.recent_activity.slice(0, 10).map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-ink">{activity.description}</p>
                  <p className="text-xs text-ink-muted mt-1">
                    {activity.user} · {new Date(activity.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
