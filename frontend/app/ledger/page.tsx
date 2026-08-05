"use client";
import { useQuery } from "@tanstack/react-query";
import { ledgerApi, type LedgerStatsOverview } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { LazyBarChart } from "@/src/components/charts/LazyDashboardCharts";

export default function LedgerPage() {
  const { t, formatDateTime } = useI18n();
  const { user } = useTenant();

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["ledger", "stats", "overview"],
    queryFn: () => ledgerApi.statsOverview().then(r => r.data),
    enabled: !!user,
  });

  const ledgerStats = stats as LedgerStatsOverview | undefined;

  return (
    <div className="p-6 space-y-6">
      {/* Page Header - renders immediately */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))]">{t("ledger.title")}</h1>
        <p className="text-[hsl(var(--color-ink-subtle))] mt-1">{t("ledger.subtitle")}</p>
      </div>

      {/* Overview Cards - each section loads independently */}
      <div className="grid gap-4 md:grid-cols-3">
        <OverviewCard
          label={t("ledger.total_souls")}
          value={ledgerStats?.total_souls}
          isLoading={isLoading}
          color="text-[hsl(var(--color-accent))]"
        />
        <OverviewCard
          label={t("ledger.active_souls")}
          value={ledgerStats?.state_distribution.find(s => s.state === "ALIVE")?.count}
          isLoading={isLoading}
          color="text-[hsl(var(--color-status-success))]"
        />
        <OverviewCard
          label={t("ledger.judging_souls")}
          value={ledgerStats?.state_distribution.find(s => s.state === "JUDGING")?.count}
          isLoading={isLoading}
          color="text-[hsl(var(--color-accent))]"
        />
      </div>

      {/* State Distribution */}
      <SectionCard title={t("ledger.state_distribution")} isLoading={isLoading} error={error}>
        {error ? (
          <div className="text-[hsl(var(--color-status-error))] text-sm">{t("common.error")}</div>
        ) : (
          <div className="space-y-2">
            {ledgerStats?.state_distribution.map((item) => (
              <div key={item.state} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${
                    item.state === "ALIVE" ? "bg-[hsl(var(--color-status-alive))]" :
                    item.state === "JUDGING" ? "bg-[hsl(var(--color-status-judging))]" :
                    item.state === "DISPOSED" ? "bg-[hsl(var(--color-status-lost))]" :
                    item.state === "REINCARNATING" ? "bg-[hsl(var(--color-status-reincarnating))]" :
                    item.state === "SETTLED" ? "bg-[hsl(var(--color-status-settled))]" :
                    "bg-[hsl(var(--color-status-error))]"
                  }`} />
                  <span className="text-sm text-[hsl(var(--color-ink))]">{t(`souls.states.${item.state}`) === `souls.states.${item.state}` ? item.label : t(`souls.states.${item.state}`)}</span>
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

      {/* Balance Distribution */}
      <SectionCard title={t("ledger.balance_distribution")} isLoading={isLoading} error={error}>
        {error ? (
          <div className="text-[hsl(var(--color-status-error))] text-sm">{t("common.error")}</div>
        ) : isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="h-48 min-h-[192px]">
            <LazyBarChart
              data={ledgerStats?.karma_distribution ?? []}
              dataKey="count"
              fill="hsl(var(--color-accent))"
              height={192}
              showGrid={false}
            />
          </div>
        )}
      </SectionCard>

      {/* Souls by Realm */}
      {ledgerStats?.souls_by_realm && ledgerStats.souls_by_realm.length > 0 && (
        <SectionCard title={t("ledger.souls_by_realm")} isLoading={isLoading} error={error}>
          {error ? (
            <div className="text-[hsl(var(--color-status-error))] text-sm">{t("common.error")}</div>
          ) : (
            <div className="space-y-2">
              {ledgerStats.souls_by_realm.map((item) => (
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
      {ledgerStats?.recent_activity && ledgerStats.recent_activity.length > 0 && (
        <SectionCard title={t("ledger.recent_activity")} isLoading={isLoading} error={error}>
          {error ? (
            <div className="text-[hsl(var(--color-status-error))] text-sm">{t("common.error")}</div>
          ) : (
            <div className="space-y-2">
              {ledgerStats.recent_activity.slice(0, 10).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg bg-[hsl(var(--color-surface-2))]/50 hover:bg-[hsl(var(--color-surface-2))] transition-colors">
                  {/* Action badge */}
                  <div className="flex-shrink-0 mt-0.5">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                      activity.action === "CREATE" ? "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]" :
                      activity.action === "UPDATE" ? "bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]" :
                      activity.action === "DELETE" ? "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]" :
                      activity.action === "EXECUTE" ? "bg-[hsl(var(--color-verdict-retry)/0.2)] text-[hsl(var(--color-verdict-retry))]" :
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
                      <span>{formatDateTime(activity.timestamp)}</span>
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
