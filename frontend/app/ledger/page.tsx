"use client";
import { useQuery } from "@tanstack/react-query";
import { ledgerApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { LazyBarChart } from "@/src/components/charts/LazyDashboardCharts";
import { DomainEnum, IdentifierChip } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";

/**
 * 功德统计 —— 租户级统计,**不是**功过台账。
 *
 * WHY THIS PAGE HAS NO 竖格线, AND WHY THAT IS THE FINDING RATHER THAN A GAP.
 * Stage 12 C2 asked for this route to become the 功過格 account page: six ruled
 * columns 条 / 日 / 事目 / 功 / 过 / 销算余, merit and demerit each holding a
 * column, the empty side left empty. That spec describes `LedgerSummary` —
 * `records: LedgerRecord[]` from `ledgerApi.balance(soulId)`, which carries a
 * type (MERIT/DEMERIT), a weight, a description and a date per row.
 *
 * This route does not call that endpoint and cannot. It calls
 * `ledgerApi.statsOverview()` → `LedgerOverviewStatsView`
 * (backend/apps/ledger/views.py:166), which is ADMIN-only, tenant-wide, and
 * returns five aggregates: a soul total, a state histogram, per-tenant totals,
 * seven karma buckets, ten audit rows and a realm breakdown. There is not one
 * `SoulRecord.weight` on the page. Every number here is a count of souls or a
 * count of audit events, and there is no soul, no event date and no running
 * balance to settle.
 *
 * The nearest-looking candidate was `karma_distribution`, whose seven buckets
 * do straddle zero and so do carry real polarity. It was rejected twice over.
 * First, its counts are tallies of souls, not sums of weight: drawing them
 * under merit/demerit headers would state that a soul tally is a karma sum,
 * which is exactly the defect `readingQuantityContract.test.tsx` was written
 * for (European culpa 22 and a Greek road count 4 drawn with one class string).
 * Second, the backend drops the bucket bounds and sends only `{label, count}`
 * — deriving a row's polarity would mean parsing the display string `"< -50"`,
 * and `"-5 to 5"` straddles zero and belongs to neither side. A colour decided
 * by parsing an English label is a defect waiting for its first translation.
 *
 * So the ruled account form is deliberately NOT claimed here. It belongs on the
 * per-soul ledger, where the line items are — and where, today, they are not
 * drawn as lines at all: `SoulKarmaLedgerCard` receives `records` and renders
 * five sums plus a lifespan chart, so the 功過格's per-article entries reach no
 * screen in this product. That is the real finding behind the C2 note, and it
 * is one file over.
 *
 * What this page did get is the Stage 11/12 migration it was owed: PageShell,
 * the eight-step scale, theme tokens, and figures that are labelled as the
 * counts they are rather than sized like the weight sums they are not.
 */
export default function LedgerPage() {
  const { t, formatDateTime } = useI18n();
  const { user } = useTenant();

  // Same rule as the dashboard's state chart: the translated enum wins, the
  // server's own label is the fallback, and the raw enum member never is.
  const stateLabel = (state: string, apiLabel?: string) => {
    const resolved = resolveEnumDisplay(t, "souls.states", state);
    return resolved.state === "known" ? resolved.label : apiLabel || resolved.label || t("common.value.unrecorded");
  };

  const { data: ledgerStats, isLoading, error } = useQuery({
    queryKey: ["ledger", "stats", "overview"],
    queryFn: () => ledgerApi.statsOverview().then(r => r.data),
    enabled: !!user,
  });

  return (
    <PageShell
      variant="page"
      title={t("ledger.title")}
      subtitle={t("ledger.subtitle")}
    >
      <div className="space-y-10">
        {/* 三个总计。计数,不是权重 —— 所以标签在数字之上说出它数的是什么,
            而数字本身不带 `ledger.figure_scale_weight` 那个标尺词。那个词是
            `SoulRecord.weight` 的事实,这一页没有一个权重。 */}
        <section className="border-t-2 border-ink-subtle pt-6 grid gap-6 md:grid-cols-3">
          <OverviewFigure
            label={t("ledger.total_souls")}
            value={ledgerStats?.total_souls}
            isLoading={isLoading}
          />
          <OverviewFigure
            label={t("ledger.active_souls")}
            value={ledgerStats?.state_distribution?.find(s => s.state === "ALIVE")?.count}
            isLoading={isLoading}
          />
          <OverviewFigure
            label={t("ledger.judging_souls")}
            value={ledgerStats?.state_distribution?.find(s => s.state === "JUDGING")?.count}
            isLoading={isLoading}
          />
        </section>

        <Section title={t("ledger.state_distribution")}>
          {error ? (
            <SectionError label={t("common.error")} />
          ) : (
            <ul className="divide-y divide-hairline">
              {ledgerStats?.state_distribution?.map((item) => (
                <li key={item.state} className="flex items-center justify-between gap-4 py-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`w-3 h-3 rounded-full shrink-0 ${STATE_DOT[item.state] ?? "bg-[hsl(var(--color-status-error))]"}`}
                    />
                    <span title={item.state} className="text-03 text-ink truncate">
                      {stateLabel(item.state, item.label)}
                    </span>
                  </span>
                  {isLoading ? (
                    <Skeleton className="h-4 w-12" />
                  ) : (
                    <span className="text-03 font-mono tabular-nums text-ink-muted">{item.count}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("ledger.balance_distribution")}>
          {error ? (
            <SectionError label={t("common.error")} />
          ) : isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="h-48">
              <LazyBarChart
                data={ledgerStats?.karma_distribution ?? []}
                dataKey="count"
                fill="hsl(var(--color-accent))"
                height={192}
                showGrid={false}
              />
            </div>
          )}
        </Section>

        {ledgerStats?.souls_by_realm && ledgerStats.souls_by_realm.length > 0 && (
          <Section title={t("ledger.souls_by_realm")}>
            {error ? (
              <SectionError label={t("common.error")} />
            ) : (
              <ul className="divide-y divide-hairline">
                {ledgerStats.souls_by_realm.map((item) => (
                  <li key={item.realm_code} className="flex items-center justify-between gap-4 py-2">
                    <span className="min-w-0">
                      <span className="text-03 text-ink">{item.realm_name}</span>
                      <span className="text-02 text-ink-subtle ml-2">
                        (<DomainEnum namespace="souls.civilizations" value={item.civilization} />)
                      </span>
                    </span>
                    {isLoading ? (
                      <Skeleton className="h-4 w-12" />
                    ) : (
                      <span className="text-03 font-mono tabular-nums text-ink-muted">{item.count}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {ledgerStats?.recent_activity && ledgerStats.recent_activity.length > 0 && (
          <Section title={t("ledger.recent_activity")}>
            {error ? (
              <SectionError label={t("common.error")} />
            ) : (
              <ul className="divide-y divide-hairline">
                {ledgerStats.recent_activity.slice(0, 10).map((activity) => (
                  <li key={activity.id} className="flex items-start gap-3 py-3">
                    <span className="text-01 uppercase text-ink-subtle shrink-0 pt-px">
                      <DomainEnum namespace="audit.actions" value={activity.action} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-03 text-ink">
                        {activity.description || <DomainEnum namespace="audit.actions" value={activity.action} />}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-02 font-mono text-ink-subtle">
                        <span>{activity.user}</span>
                        <span aria-hidden="true">·</span>
                        <span>{activity.resource}</span>
                        {/* A registered departure from IDENTIFIER_POLICY clauses
                            1 and 2 — see IDENTIFIER_POLICY_EXCEPTIONS in
                            src/lib/domainDisplay.ts. An audit line's content IS
                            the record it touched, so the id stays; clause 3 does
                            not bend, so it is copyable rather than the dead text
                            it used to be. */}
                        <IdentifierChip
                          id={activity.resource_id}
                          variant="inline"
                          ariaLabel={t("ledger.copy_resource_id", { resource: activity.resource })}
                        />
                        <span aria-hidden="true">·</span>
                        <span>{formatDateTime(activity.timestamp)}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </PageShell>
  );
}

/** 状态点。identity 物,所以是这一页仅有的 `rounded-full`。 */
const STATE_DOT: Record<string, string> = {
  ALIVE: "bg-[hsl(var(--color-status-alive))]",
  JUDGING: "bg-[hsl(var(--color-status-judging))]",
  DISPOSED: "bg-[hsl(var(--color-status-lost))]",
  REINCARNATING: "bg-[hsl(var(--color-status-reincarnating))]",
  SETTLED: "bg-[hsl(var(--color-status-settled))]",
};

/**
 * 一个总计数字。
 *
 * `text-07` 而不是 `text-08`:三个figure 等阶,08 档留给单一主数字。这三个都是
 * 计数,标签写在数字之上说出它数的是什么 —— 计数自带名词,量纲自带标尺词,
 * 这是 `QuantityFigure` 那条规则在没有权重的一页上的样子。
 */
function OverviewFigure({
  label,
  value,
  isLoading,
}: {
  label: string;
  value?: number;
  isLoading: boolean;
}) {
  return (
    <div>
      <div className="text-01 uppercase text-ink-subtle">{label}</div>
      {isLoading ? (
        <Skeleton className="h-10 w-20 mt-2" />
      ) : (
        <div data-overview-figure="" className="text-07 font-mono tabular-nums text-ink mt-2">
          {value ?? 0}
        </div>
      )}
    </div>
  );
}

/** 区块标题:`text-01` uppercase + 2px ink-subtle 下划线(取代 font-bold 做层级)。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-01 uppercase text-ink-subtle border-b-2 border-ink-subtle pb-2 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SectionError({ label }: { label: string }) {
  return <p className="text-03 text-[hsl(var(--color-status-error))]">{label}</p>;
}
