"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { ledgerApi, LedgerStatsOverview } from "@soulledger/core/api";
import Link from "next/link";
import { LegendLedger, STATE_SWATCH, orderLifecycle, sharePercent } from "@/src/components/dashboard/LegendLedger";
import { BalanceHistogram } from "@/src/components/dashboard/BalanceHistogram";
import { soulStateGlyph } from "@/src/lib/soulStateBadge";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { CIVILIZATION_OPTIONS, getCivilizationFromTenantCode } from "@soulledger/core/config/civilizations";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RealmBars, RealmLegend, PATTERN_CLASS, patternOf } from "@/src/components/dashboard/RealmBars";
import { TodoStrip } from "@/src/components/dashboard/TodoStrip";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { StatCard } from "@/src/components/dashboard/StatCard";

type DashboardTab = "overview" | "ledger";

/** One Design A4 card: s1, 1px line, padding 20, a 20/28 h2 with an optional aside. */
function ChartCard({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg text-[oklch(var(--color-ink))]">{title}</h2>
        {aside && <div className="text-xs text-[oklch(var(--color-ink-muted))]">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** 平均余额带正负号、一位小数(「+42.7」);零不带号。 */
function signedBalance(n: number): string {
  const fixed = n.toFixed(1);
  return n > 0 ? `+${fixed}` : fixed === "-0.0" ? "0.0" : fixed;
}

/** Parses karma_distribution bucket labels ("< -50", "-5 to 5", "> 50", ...) into a midpoint. */
function bucketMidpoint(label: string): number {
  // The server's top bucket is `>= 50` (apps/ledger/views.py). Stripping only the
  // `>` left `= 50`, parseFloat gave NaN, and the average balance read NaN.
  const bound = (l: string) => parseFloat(l.replace(/^[<>]=?/, "").trim());
  if (label.startsWith("<")) return bound(label) - 10;
  if (label.startsWith(">")) return bound(label) + 10;
  const parts = label.split(" to ");
  if (parts.length === 2) return (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
  return 0;
}


function DashboardContent() {
  const { t, formatDate, formatDateTime } = useI18n();
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

  // 身份带(A4):题是当前标签名(「概览」/「账本」),右栏只写今天的日期 —— 统计接口不带
  // 「数据截至」时间,稿里的「截至 08:00」没有来源,不写。
  usePlaque({
    title: t(activeTab === "ledger" ? "dashboard.tab_ledger" : "dashboard.tab_overview"),
    meta: formatDate(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" }),
  });

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

  /**
   * 导出正在进行 —— 此前没有任何东西记录这件事。
   *
   * `Button` 从写出来就有 `loading`(它会禁用按钮并挂上 `aria-busy`),全站 21
   * 处在用。这一处没用:一次导出要走完整的服务端统计再下载,而按钮在这期间
   * 看起来和空闲时**逐字节相同**,也接受点击 —— 点三下就下三个文件。
   *
   * 这不是缺一个组件,是既有的 prop 没接上。
   */
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
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
    } finally {
      setExporting(false);
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
      <Button type="button" variant="primary" loading={exporting} onClick={handleExport}>
        {t("dashboard.export_stats")}
      </Button>
    </RequireAdmin>
  );

  const tabs: { key: DashboardTab; label: string }[] = [
    { key: "overview", label: t("dashboard.tab_overview") },
    { key: "ledger", label: t("dashboard.tab_ledger") },
  ];

  // 交给 PageShell 的 `tabs` 槽。外层那条 `border-b border-hairline/50` 和
  // `gap-1` 都由槽自己给了 —— 这里只剩按钮,顺带把站里两派写法(gap-1 + 半透明
  // 线 / gap-2 + 实线)中的这一派也收掉。
  const pageTabs = tabs.map((tabItem) => {
    const button = (
      <button
        key={tabItem.key}
        type="button"
        // `aria-pressed`, not `role="tab"`. These are not a real tablist —
        // they do not own a `tabpanel`, arrow keys do not move between them,
        // and claiming the role without that contract is the defect this
        // repo already has three instances of. What they ARE is a set of
        // toggles where exactly one is on, and `aria-pressed` says that
        // truthfully. Before this the selected one differed only by border
        // and text COLOUR, so a screen-reader user heard two identical
        // buttons and could not tell which view was showing.
        // `components/ui/data-grid/FilterBar.tsx:181` already does this.
        aria-pressed={activeTab === tabItem.key}
        onClick={() => setTab(tabItem.key)}
        className={`${TAB_BASE} ${activeTab === tabItem.key ? TAB_ON : TAB_OFF}`}
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

  /**
   * The lifecycle row and its 图例账 (规范 v1 §3.4). The five lifecycle states
   * in their fixed order, then any other state the payload carries (LOST, or
   * one this build does not know) so nothing it counted is dropped.
   */
  const LIFECYCLE = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "SETTLED"];
  const lifecycleStates = orderLifecycle(LIFECYCLE, (stats?.state_distribution ?? []).map((s) => s.state));
  const stateCount = (state: string) =>
    stats?.state_distribution?.find((s) => s.state === state)?.count ?? 0;

  /** 各文明: all four civilizations, from the tenants that carry them. */
  const civCount = (civ: string) =>
    (stats?.tenants ?? [])
      .filter((tn) => getCivilizationFromTenantCode(tn.tenant_code) === civ)
      .reduce((sum, tn) => sum + tn.total_souls, 0);
  const civTotal = CIVILIZATION_OPTIONS.reduce((sum, civ) => sum + civCount(civ), 0);
  const civMax = Math.max(1, ...CIVILIZATION_OPTIONS.map(civCount));

  const realmBars = [...(stats?.souls_by_realm ?? [])]
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ key: r.realm_code, name: r.realm_name || r.realm_code, count: r.count, realmType: r.realm_type }));
  const topRealms = [...(stats?.souls_by_realm ?? [])].sort((a, b) => b.count - a.count).slice(0, 10);

  /** 今天的只写 HH:MM;更早的写月 / 日(Design A4 最近动态的右栏)。 */
  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    const today = !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
    return formatDateTime(ts, today ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" });
  };

  // Ledger-tab-only derived data (admin/stats page's unique cards)
  const avgBalance = stats?.karma_distribution
    ? stats.karma_distribution.reduce((sum, k) => sum + bucketMidpoint(k.label) * k.count, 0) /
      (stats.total_souls || 1)
    : 0;
  const total = stats?.total_souls ?? 0;

  return (
    <PageShell
      variant="page"
      title={pageTitle}
      subtitle={t("dashboard.subtitle")}
      actions={pageActions}
      tabs={pageTabs}
    >
      <div className="space-y-4 md:space-y-6">
        {activeTab === "overview" ? (
          <>
            <TodoStrip />

            {error && (
              <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">✕ </span>
                {error}
              </p>
            )}

            {/* 状态卡(Design A4):五个生命周期状态,五等分;393 宽下前四张 2 × 2,已终结是网格下的一行。
                迷失与本版本不认得的状态不另起卡片 —— 它们在下面的图例账里,一个都不少。 */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-4">
              {LIFECYCLE.map((state) => (
                <StatCard
                  key={state}
                  label={
                    <>
                      <span aria-hidden="true" className="font-mono">{soulStateGlyph(state)}</span>{" "}
                      <span title={state}>{stateLabel(state)}</span>
                    </>
                  }
                  // A state missing from `state_distribution` means zero souls are
                  // in it — a real count, so `?? 0` here is honest.
                  value={stateCount(state)}
                  total={total}
                  barClass={STATE_SWATCH[state] ?? "bg-[oklch(var(--color-chart-1))]"}
                  isLoading={loading}
                  compactLine={state === "SETTLED"}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr_1.2fr]">
              {/* 按文明 — all four civilizations, one ramp step; civ colour stays out of charts. */}
              <ChartCard title={t("dashboard.souls_by_civilization")}>
                <div className="space-y-3">
                  {CIVILIZATION_OPTIONS.map((civ) => {
                    const n = civCount(civ);
                    return (
                      <div
                        key={civ}
                        data-civ-row={civ}
                        className="grid grid-cols-[minmax(40px,auto)_1fr_80px_48px] items-center gap-x-3 text-sm"
                      >
                        <span className="flex items-baseline gap-1 whitespace-nowrap text-[oklch(var(--color-ink))]">
                          <span aria-hidden="true" className="font-mono text-[oklch(var(--color-ink-subtle))]">{CIVILIZATION_MARK[civ]}</span>
                          <DomainEnum namespace="souls.civilizations" value={civ} />
                        </span>
                        {loading ? (
                          <Skeleton className="h-3 w-full" />
                        ) : n > 0 ? (
                          <span aria-hidden="true" className="block h-3 bg-[oklch(var(--color-surface-2))]">
                            <span className="block h-full min-w-0.5 bg-[oklch(var(--color-chart-3))]" style={{ width: `${(n / civMax) * 100}%` }} />
                          </span>
                        ) : (
                          // 没有灵魂的文明是一行,带去处,不画空条(规范 v1)。
                          <Link href="/souls" className="truncate text-xs text-[oklch(var(--color-ink-subtle))] underline">
                            {t("dashboard.civ_empty")}
                          </Link>
                        )}
                        <span className={`text-right font-mono ${n ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-subtle))]"}`}>
                          {loading ? <Skeleton as="span" className="inline-block h-4 w-6" /> : n}
                        </span>
                        <span className="text-right font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                          {loading ? null : sharePercent(n, civTotal)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </ChartCard>

              {/* 状态分布 — the 图例账 that replaces the pie chart. */}
              <ChartCard title={t("dashboard.state_distribution")}>
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <LegendLedger
                    rows={lifecycleStates.map((state) => ({
                      key: state,
                      label: (
                        <>
                          <span aria-hidden="true" className="font-mono">{soulStateGlyph(state)}</span>{" "}
                          <span title={state}>{stateLabel(state)}</span>
                        </>
                      ),
                      count: stateCount(state),
                      swatchClass: STATE_SWATCH[state] ?? "border-2 border-[oklch(var(--color-ink-subtle))]",
                    }))}
                  />
                )}
              </ChartCard>

              {/* 余额分布 — 0 左右两档明度,0 线墨色,负值不用红。 */}
              <ChartCard
                title={t("dashboard.balance_distribution")}
                aside={stats ? <span className="font-mono">n = {stats.total_souls}</span> : null}
              >
                {loading ? (
                  <Skeleton className="h-50 w-full" />
                ) : (
                  <BalanceHistogram
                    bars={(stats?.karma_distribution ?? []).map((k) => {
                      const mid = bucketMidpoint(k.label);
                      return { label: k.label, count: k.count, tone: mid < 0 ? "negative" : mid > 0 ? "positive" : "zero" };
                    })}
                  />
                )}
              </ChartCard>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
              {/* 按界域 — sorted descending: realms have no canonical order, so the
                  server's is arbitrary and a reader comparing magnitudes would have to
                  hunt. Each bar takes its realm type's pattern. */}
              <ChartCard title={t("dashboard.souls_by_realm")} aside={<RealmLegend />}>
                {loading ? (
                  <Skeleton className="h-60 w-full" />
                ) : realmBars.length > 0 ? (
                  <RealmBars bars={realmBars} />
                ) : (
                  <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("dashboard.no_realm_data")}</p>
                )}
              </ChartCard>

              {/* 最近动态 — grouped by action. */}
              <ChartCard title={t("dashboard.recent_activity")}>
                {loading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-11 w-full" />
                    ))}
                  </div>
                ) : stats?.recent_activity && stats.recent_activity.length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(
                      stats.recent_activity.reduce<Record<string, typeof stats.recent_activity>>((acc, log) => {
                        (acc[log.action || "OTHER"] ??= []).push(log);
                        return acc;
                      }, {})
                    ).map(([action, logs]) => (
                      <div key={action}>
                        <div className="flex items-baseline gap-1 pb-1 text-2xs text-[oklch(var(--color-ink-subtle))]">
                          {/* `OTHER` is this block's own bucket for rows with no action, not a
                              member the backend emits — so it goes to the screen as a missing
                              value, not as an unrecognised one. */}
                          <DomainEnum namespace="audit.actions" value={action === "OTHER" ? null : action} />
                          <span aria-hidden="true">·</span>
                          <span>{t("dashboard.activity_count", { count: String(logs.length) })}</span>
                        </div>
                        <ul className="border-t border-[oklch(var(--color-line))]">
                          {logs.map((log) => (
                            <li
                              key={log.id}
                              className="grid min-h-11 grid-cols-[1fr_auto] items-center gap-x-3 border-b border-[oklch(var(--color-line))] py-1"
                            >
                              <div className="min-w-0">
                                <div title={log.description || log.resource} className="truncate text-sm text-[oklch(var(--color-ink))]">
                                  {log.description || log.resource}
                                </div>
                                <div className="text-xs text-[oklch(var(--color-ink-muted))]">{log.user}</div>
                              </div>
                              <time dateTime={log.timestamp} className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                                {formatTimestamp(log.timestamp)}
                              </time>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : error ? null : (
                  // Not on error: "no recent activity" would be the failed request
                  // speaking as if it had succeeded (the alert above says why).
                  <EmptyState title={t("dashboard.no_activity")} />
                )}
              </ChartCard>
            </div>
          </>
        ) : (
          <RequireAdmin fallback={<PermissionDenied />}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
                <ChartCard title={t("admin.avg_balance")}>
                  {loading ? (
                    <Skeleton className="h-16 w-32" />
                  ) : (
                    <div data-avg-balance="" className="font-title text-display-lg tabular-nums text-[oklch(var(--color-ink))]">
                      {signedBalance(avgBalance)}
                    </div>
                  )}
                  <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("dashboard.avg_scope")}</p>
                </ChartCard>
                <section
                  aria-labelledby="dash-state-breakdown"
                  className="min-w-0 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]"
                >
                  <h2 id="dash-state-breakdown" className="px-4 pt-4 text-lg text-[oklch(var(--color-ink))]">
                    {t("admin.state_breakdown")}
                  </h2>
                  <div className="grid grid-cols-[20px_1fr_140px] px-4">
                    <div className="col-span-3 grid h-10 grid-cols-subgrid items-center text-2xs text-[oklch(var(--color-ink-subtle))]">
                      <span />
                      <span>{t("souls.state")}</span>
                      <span className="text-right">{t("admin.soul_count")}</span>
                    </div>
                    {loading ? (
                      <Skeleton className="col-span-3 h-32 w-full" />
                    ) : (
                      stats?.state_distribution?.map((s) => (
                        <div
                          key={s.state}
                          data-breakdown-row={s.state}
                          className="col-span-3 grid min-h-(--table-row-h) grid-cols-subgrid items-center border-t border-[oklch(var(--color-line))] text-sm"
                        >
                          <span aria-hidden="true" className={`block size-3 ${STATE_SWATCH[s.state] ?? "border-2 border-[oklch(var(--color-ink-subtle))]"}`} />
                          <span className="text-[oklch(var(--color-ink))]">
                            <span aria-hidden="true" className="font-mono">{soulStateGlyph(s.state)}</span>{" "}
                            <span title={s.state}>{stateLabel(s.state, s.label)}</span>
                          </span>
                          <span className="text-right font-mono">{s.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              {/* 界域前十 — the realms holding the most souls. It used to be titled
                  「功过榜首灵魂」, which is not what `souls_by_realm` holds. */}
              <ChartCard title={t("dashboard.top_realms")}>
                <DataTable<LedgerStatsOverview["souls_by_realm"][number]>
                  caption={t("dashboard.top_realms")}
                  columns={[
                    { key: "rank", header: "#", width: "40px" },
                    { key: "realm_name", header: t("admin.realm") },
                    { key: "realm_type", header: t("realms.table.col_kind"), width: "160px" },
                    { key: "count", header: t("admin.soul_count"), align: "right", width: "140px" },
                  ]}
                  data={topRealms}
                  // DataTable suppresses its own empty state when isError is set, so a
                  // failed load never reads as "no realms" beside an error.
                  isError={!!queryError}
                  keyExtractor={(realm, idx) => `${realm.realm_code}-${idx}`}
                  renderRow={(realm, idx) => (
                    <>
                      <td className="px-4 font-mono text-[oklch(var(--color-ink-muted))]">{idx + 1}</td>
                      <td className="px-4 text-[oklch(var(--color-ink))]">
                        {realm.realm_name || realm.realm_code}
                        <span className="text-[oklch(var(--color-ink-muted))]">
                          {" · "}
                          <DomainEnum namespace="souls.civilizations" value={realm.civilization} />
                        </span>
                      </td>
                      <td className="px-4">
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className={`block size-3 ${PATTERN_CLASS[patternOf(realm.realm_type)]}`} />
                          <DomainEnum namespace="realms.types" value={realm.realm_type} />
                        </span>
                      </td>
                      <td className="px-4 text-right font-mono">{realm.count}</td>
                    </>
                  )}
                  emptyMessage={t("admin.no_realm_data")}
                />
              </ChartCard>
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
    <Suspense fallback={<div className="min-h-[60vh] bg-[oklch(var(--color-canvas))]" />}>
      <DashboardContent />
    </Suspense>
  );
}
