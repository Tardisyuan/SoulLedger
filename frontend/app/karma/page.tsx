"use client";
import { useQuery } from "@tanstack/react-query";
import { karmaApi, type KarmaStatsOverview } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";

export default function KarmaPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["karma", "stats", "overview"],
    queryFn: () => karmaApi.statsOverview().then(r => r.data),
    enabled: !!user,
  });

  const karmaStats = stats as KarmaStatsOverview | undefined;

  return (
    <div className="p-6 space-y-6">
      {/* Page Header - renders immediately */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("karma.title")}</h1>
        <p className="text-ink-subtle mt-1">{t("karma.subtitle")}</p>
      </div>

      {/* Overview Cards - each section loads independently */}
      <div className="grid gap-4 md:grid-cols-3">
        <OverviewCard
          label={t("karma.total_souls")}
          value={karmaStats?.total_souls}
          isLoading={isLoading}
          color="text-amber-400"
        />
        <OverviewCard
          label={t("karma.active_souls")}
          value={karmaStats?.state_distribution.find(s => s.state === "ALIVE")?.count}
          isLoading={isLoading}
          color="text-green-400"
        />
        <OverviewCard
          label={t("karma.judging_souls")}
          value={karmaStats?.state_distribution.find(s => s.state === "JUDGING")?.count}
          isLoading={isLoading}
          color="text-amber-500"
        />
      </div>

      {/* State Distribution */}
      <SectionCard title={t("karma.state_distribution")} isLoading={isLoading} error={error}>
        {error ? (
          <div className="text-red-400 text-sm">{t("common.error")}</div>
        ) : (
          <div className="space-y-2">
            {karmaStats?.state_distribution.map((item) => (
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
                {isLoading ? (
                  <Skeleton className="h-4 w-12" />
                ) : (
                  <span className="text-sm font-mono text-ink-muted">{item.count}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Karma Distribution */}
      <SectionCard title={t("karma.karma_distribution")} isLoading={isLoading} error={error}>
        {error ? (
          <div className="text-red-400 text-sm">{t("common.error")}</div>
        ) : (
          <div className="space-y-2">
            {karmaStats?.karma_distribution.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className="text-sm text-ink">{item.label}</span>
                {isLoading ? (
                  <Skeleton className="h-4 w-12" />
                ) : (
                  <span className="text-sm font-mono text-amber-400">{item.count}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Souls by Realm */}
      {karmaStats?.souls_by_realm && karmaStats.souls_by_realm.length > 0 && (
        <SectionCard title={t("karma.souls_by_realm")} isLoading={isLoading} error={error}>
          {error ? (
            <div className="text-red-400 text-sm">{t("common.error")}</div>
          ) : (
            <div className="space-y-2">
              {karmaStats.souls_by_realm.map((item) => (
                <div key={item.realm_code} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-ink">{item.realm_name}</span>
                    <span className="text-xs text-ink-muted ml-2">({item.civilization})</span>
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-4 w-12" />
                  ) : (
                    <span className="text-sm font-mono text-ink-muted">{item.count}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Recent Activity */}
      {karmaStats?.recent_activity && karmaStats.recent_activity.length > 0 && (
        <SectionCard title={t("karma.recent_activity")} isLoading={isLoading} error={error}>
          {error ? (
            <div className="text-red-400 text-sm">{t("common.error")}</div>
          ) : (
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
          )}
        </SectionCard>
      )}
    </div>
  );
}

// Overview Card with loading state
function OverviewCard({
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
    <div className="bg-surface-1 border border-hairline rounded-lg p-4">
      <div className="text-sm text-ink-muted">{label}</div>
      {isLoading ? (
        <Skeleton className="h-8 w-20 mt-1" />
      ) : (
        <div className={`text-3xl font-bold ${color} mt-1`}>{value ?? 0}</div>
      )}
    </div>
  );
}

// Section Card with loading state
function SectionCard({
  title,
  isLoading,
  error,
  children,
}: {
  title: string;
  isLoading: boolean;
  error?: unknown;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-1 border border-hairline rounded-lg p-4">
      <h2 className="text-lg font-semibold text-ink mb-4">{title}</h2>
      {children}
    </div>
  );
}
