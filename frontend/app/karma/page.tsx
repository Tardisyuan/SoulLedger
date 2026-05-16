"use client";
import { useQuery } from "@tanstack/react-query";
import { karmaApi, type KarmaStatsOverview } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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
        <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))]">{t("karma.title")}</h1>
        <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("karma.subtitle")}</p>
      </div>

      {/* Overview Cards - each section loads independently */}
      <div className="grid gap-4 md:grid-cols-3">
        <OverviewCard
          label={t("karma.total_souls")}
          value={karmaStats?.total_souls}
          isLoading={isLoading}
          color="text-[hsl(var(--color-accent))]"
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
          color="text-[hsl(var(--color-accent))]"
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
                  <span className="text-sm text-[hsl(var(--color-ink))]">{item.label}</span>
                </div>
                {isLoading ? (
                  <Skeleton className="h-4 w-12" />
                ) : (
                  <span className="text-sm font-mono text-[hsl(var(--color-ink-muted))]">{item.count}</span>
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
        ) : isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="h-48 min-h-[192px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={karmaStats?.karma_distribution} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
                <XAxis dataKey="label" tick={{ fill: 'hsl(var(--color-ink-muted))', fontSize: 12 }} />
                <YAxis tick={{ fill: 'hsl(var(--color-ink-muted))', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--color-surface-1))',
                    border: '1px solid hsl(var(--color-hairline))',
                    borderRadius: '8px',
                    color: 'hsl(var(--color-ink))',
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {karmaStats?.karma_distribution.map((_, idx) => (
                    <Cell key={idx} fill="hsl(var(--color-accent))" fillOpacity={0.8 - idx * 0.1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
                    <span className="text-sm text-[hsl(var(--color-ink))]">{item.realm_name}</span>
                    <span className="text-xs text-[hsl(var(--color-ink-muted))] ml-2">({item.civilization})</span>
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-4 w-12" />
                  ) : (
                    <span className="text-sm font-mono text-[hsl(var(--color-ink-muted))]">{item.count}</span>
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
            <div className="space-y-2">
              {karmaStats.recent_activity.slice(0, 10).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg bg-[hsl(var(--color-surface-2))]/50 hover:bg-[hsl(var(--color-surface-2))] transition-colors">
                  {/* Action badge */}
                  <div className="flex-shrink-0 mt-0.5">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                      activity.action === "CREATE" ? "bg-green-500/20 text-green-400" :
                      activity.action === "UPDATE" ? "bg-blue-500/20 text-blue-400" :
                      activity.action === "DELETE" ? "bg-red-500/20 text-red-400" :
                      activity.action === "EXECUTE" ? "bg-purple-500/20 text-purple-400" :
                      "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                    }`}>
                      {t(`audit.actions.${activity.action}`)}
                    </span>
                  </div>
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[hsl(var(--color-ink))] font-medium">
                      {activity.description || t(`audit.actions.${activity.action}`)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-[hsl(var(--color-ink-muted))]">
                      <span className="flex items-center gap-1">
                        <span className="opacity-60">{activity.user}</span>
                      </span>
                      <span className="opacity-40">·</span>
                      <span>{activity.resource}</span>
                      <span className="opacity-60">#{activity.resource_id}</span>
                      <span className="opacity-40">·</span>
                      <span>{new Date(activity.timestamp).toLocaleString()}</span>
                    </div>
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
  color = "text-[hsl(var(--color-ink))]",
}: {
  label: string;
  value?: number;
  isLoading: boolean;
  color?: string;
}) {
  return (
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
      <div className="text-sm text-[hsl(var(--color-ink-muted))]">{label}</div>
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
    <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-4">
      <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-4">{title}</h2>
      {children}
    </div>
  );
}
