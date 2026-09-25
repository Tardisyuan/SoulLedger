"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ledgerApi, type LedgerJournal, type LedgerJournalParams, type LedgerJournalRow } from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { cn } from "@/lib/utils";
import { fieldControl } from "@/src/components/ui/Field";
import { saveBlob } from "@/src/lib/saveBlob";
import { Skeleton } from "@/components/ui/skeleton";
import { ROW_LINK } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Button } from "@/src/components/ui/Button";
import { QueryError } from "@/src/components/ui/PageError";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { DomainText } from "@/src/components/ui/DomainValue";
import { LegendLedger, type LegendLedgerRow } from "@/src/components/dashboard/LegendLedger";
import { currentMonth, groupByDay, shiftMonth, signed } from "@/src/lib/ledgerJournal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * 功过总账 —— 跨灵魂的月度流水,页首用账房的「四柱」(第三类 B · /ledger):
 *
 *     旧管 + 新收 − 开除 = 实在
 *
 * 数据全部来自 `GET /ledger/journal/`(backend/apps/ledger/journal.py):四柱、按类目
 * 的本期合计与一页流水是**同一次查询、同一组筛选**算出来的,所以筛了文明或类目,
 * 四柱跟着变,账始终是平的。四柱是登记原值(`weight`)之和,**不是**衰减后的
 * `karmic_balance` —— 口径写在副题上,见 journal.py 的说明。
 *
 * 这一页此前是「功德统计」(`statsOverview` 的状态分布、业力分桶、各界域人数、最近
 * 活动)。那些读数在仪表盘上各有位置;/ledger 按设计稿改成它名字所说的那本账。
 *
 * 线:日小计压单线(区块边界),本页合计收双线,「实在」下也是双线 —— 与详情页
 * 「乙 · 功过」同一套:合计用单线,终结用双线。整行可点,进入该户详情的「乙 · 功过」。
 */

const RECORD_CATEGORIES = [
  "CHARITY", "COMPASSION", "HONESTY", "COURAGE", "WISDOM", "PIETY",
  "CRUELTY", "DECEPTION", "COWARDICE", "GREED", "BLASPHEMY", "MURDER", "OTHER",
] as const;

const INK_OK = "text-[oklch(var(--color-karma-merit))]";
const INK_DANGER = "text-[oklch(var(--color-karma-demerit))]";
const MONO_LABEL = "font-mono text-2xs text-[oklch(var(--color-ink-subtle))]";
/** Journal grid: 日 · 灵魂 · 条目 · 依据 · 收 · 支. 393 px: two lines per row. */
const JOURNAL_COLS =
  "grid grid-cols-[1fr_1fr_4rem_4rem] md:grid-cols-[3.5rem_1.2fr_1.4fr_1fr_4.5rem_4.5rem] gap-x-3";

function LedgerPageContent() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [month, setMonth] = useState(() => currentMonth());
  const [page, setPage] = useState(1);
  const [civilization, setCivilization] = useState("");
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const { showToast } = useToast();

  // Same 300 ms debounce as /souls: one request per pause, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* 搜索与文明、类目是**同一组**筛选:四柱、类目账、流水与导出都读它,所以搜出一户,
     四柱就只是这一户的账,仍然平。 */
  const filters: LedgerJournalParams = {
    month,
    ...(civilization && { civilization }),
    ...(category && { category }),
    ...(search && { search }),
  };
  const params = { ...filters, page };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ledger", "journal", params],
    queryFn: () => ledgerApi.journal(params).then((r) => r.data),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await ledgerApi.exportJournal(filters);
      saveBlob(response.data, `ledger_journal_${month}.csv`);
    } catch {
      showToast(t("ledger.journal.export_failed"), "error");
    } finally {
      setExporting(false);
    }
  };

  const goMonth = (next: string) => {
    setMonth(next);
    setPage(1);
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;

  return (
    <PageShell
      variant="full"
      title={t("ledger.journal.title")}
      subtitle={t("ledger.journal.subtitle")}
      filters={
        <>
          <span className="flex items-center h-8 border border-[oklch(var(--color-block))] font-mono text-xs">
            <button
              type="button"
              aria-label={t("ledger.journal.month_prev")}
              onClick={() => goMonth(shiftMonth(month, -1))}
              className="px-2 h-full text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]"
            >
              ‹
            </button>
            <input
              type="month"
              aria-label={t("ledger.journal.month")}
              value={month}
              onChange={(e) => e.target.value && goMonth(e.target.value)}
              className="bg-transparent px-1 h-full font-mono text-xs text-[oklch(var(--color-ink))]"
            />
            <button
              type="button"
              aria-label={t("ledger.journal.month_next")}
              onClick={() => goMonth(shiftMonth(month, 1))}
              className="px-2 h-full text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]"
            >
              ›
            </button>
          </span>
          <FilterChipSelect
            label={t("souls.filter_civilization")}
            value={civilization}
            options={[
              { value: "", label: t("filter.all") },
              ...CIVILIZATION_OPTIONS.map((c) => ({ value: c, label: t(`souls.civilizations.${c}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("souls.filter_civilization") })}
            onChange={(v) => {
              setCivilization(v);
              setPage(1);
            }}
          />
          <FilterChipSelect
            label={t("ledger.journal.category")}
            value={category}
            options={[
              { value: "", label: t("filter.all") },
              ...RECORD_CATEGORIES.map((c) => ({ value: c, label: t(`souls.categories.${c}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("ledger.journal.category") })}
            onChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
          />
          <input
            type="search"
            placeholder={t("ledger.journal.search")}
            aria-label={t("ledger.journal.search")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(fieldControl({ size: "md" }), "w-44 min-w-[140px]")}
          />
          <Button type="button" variant="secondary" size="sm" className="ml-auto" loading={exporting} onClick={exportCsv}>
            {t("ledger.journal.export")}
          </Button>
        </>
      }
      pagination={
        data && data.count > data.page_size
          ? {
              count: (
                <p className="text-xs font-mono tabular-nums text-[oklch(var(--color-ink-subtle))]">
                  {`${(page - 1) * data.page_size + 1}–${Math.min(page * data.page_size, data.count)} / ${data.count}`}
                </p>
              ),
              controls: (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t("common.prev")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                    {t("common.next")}
                  </Button>
                </div>
              ),
            }
          : undefined
      }
    >
      {isError && !data ? (
        <QueryError onRetry={() => refetch()} detail={t("ledger.journal.load_failed")} />
      ) : isLoading || !data ? (
        <LedgerSkeleton />
      ) : (
        <LedgerBody data={data} onPrevMonth={() => goMonth(shiftMonth(month, -1))} />
      )}
    </PageShell>
  );
}

function LedgerBody({ data, onPrevMonth }: { data: LedgerJournal; onPrevMonth: () => void }) {
  const { t } = useI18n();
  return (
    <div>
      <FourPillars data={data} />
      <p className={`${MONO_LABEL} py-1.5`} data-testid="ledger-formula">
        {t("ledger.journal.formula", { souls: String(data.soul_count), records: String(data.record_count) })}
      </p>

      {data.record_count === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={t("ledger.journal.empty_title")}
            reason={t("ledger.journal.empty_reason", { month: data.month, opening: signed(data.opening) })}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={onPrevMonth}>
                {t("ledger.journal.month_prev")}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-6 mt-2">
          <Journal rows={data.results} />
          <section aria-labelledby="ledger-categories">
            <h2 id="ledger-categories" className="font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pb-1 border-b border-[oklch(var(--color-block))]">
              {t("ledger.journal.categories")}
            </h2>
            <LegendLedger rows={categoryRows(data, t)} />
          </section>
        </div>
      )}
    </div>
  );
}

/** 四柱。实在压双线:它是这张账的终结数。 */
function FourPillars({ data }: { data: LedgerJournal }) {
  const { t } = useI18n();
  const cells: { key: string; label: string; value: string; className: string; closing?: boolean }[] = [
    { key: "opening", label: t("ledger.journal.pillar_opening"), value: signed(data.opening), className: "" },
    { key: "received", label: t("ledger.journal.pillar_received"), value: signed(data.received), className: INK_OK },
    { key: "disbursed", label: t("ledger.journal.pillar_disbursed"), value: signed(-data.disbursed), className: INK_DANGER },
    { key: "closing", label: t("ledger.journal.pillar_closing"), value: signed(data.closing), className: "font-semibold", closing: true },
  ];
  return (
    <dl data-testid="four-pillars" className="grid grid-cols-2 md:grid-cols-4 border-t border-[oklch(var(--color-block))]">
      {cells.map((c) => (
        <div
          key={c.key}
          data-pillar={c.key}
          className={`px-3 pt-2 pb-3 max-md:odd:pl-0 md:first:pl-0 border-[oklch(var(--color-line))] md:border-r last:border-r-0 ${
            c.closing ? "border-b-[3px] border-double !border-b-[oklch(var(--color-block))]" : "border-b"
          }`}
        >
          <dt className={MONO_LABEL}>{c.label}</dt>
          <dd className={`font-mono text-lg tabular-nums ${c.className}`}>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const sumOf = (rows: LedgerJournalRow[], type: LedgerJournalRow["record_type"]) =>
  rows.filter((r) => r.record_type === type).reduce((s, r) => s + r.weight, 0);

function Journal({ rows }: { rows: LedgerJournalRow[] }) {
  const { t } = useI18n();
  const groups = groupByDay(rows);
  return (
    <section className="min-w-0" data-testid="ledger-journal">
      <div className={`${JOURNAL_COLS} max-md:hidden ${MONO_LABEL} pb-1 border-b border-[oklch(var(--color-block))]`}>
        <span>{t("ledger.journal.col_day")}</span>
        <span>{t("ledger.journal.col_soul")}</span>
        <span>{t("ledger.journal.col_entry")}</span>
        <span>{t("ledger.journal.col_basis")}</span>
        <span className="text-right">{t("souls.detail.ledger.col_in")}</span>
        <span className="text-right">{t("souls.detail.ledger.col_out")}</span>
      </div>
      {groups.map((g) => (
        <div key={g.day} data-journal-day={g.day}>
          <div className="flex justify-between pt-3 pb-1 border-b border-[oklch(var(--color-block))] font-mono text-xs">
            <span className="font-semibold">{g.day.slice(5)}</span>
            <span className={MONO_LABEL} data-testid="day-subtotal">
              {t("ledger.journal.subtotal")} <span className={INK_OK}>{signed(sumOf(g.rows, "MERIT"))}</span> /{" "}
              <span className={INK_DANGER}>{signed(-sumOf(g.rows, "DEMERIT"))}</span>
            </span>
          </div>
          {g.rows.map((r) => (
            <JournalRow key={r.id} row={r} />
          ))}
        </div>
      ))}
      <div
        data-testid="page-total"
        className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-x-3 py-2 border-b-[3px] border-double border-[oklch(var(--color-block))] font-mono font-semibold"
      >
        <span className="font-sans">{t("ledger.journal.page_total", { n: String(rows.length) })}</span>
        <span className={`text-right ${INK_OK}`}>{signed(sumOf(rows, "MERIT"))}</span>
        <span className={`text-right ${INK_DANGER}`}>{signed(-sumOf(rows, "DEMERIT"))}</span>
      </div>
      <p className={`${MONO_LABEL} pt-2`}>{t("ledger.journal.row_hint")}</p>
    </section>
  );
}

/** 整行可点:一条 `Link` 用 `::after` 盖住整行,进入该户详情的「乙 · 功过」。 */
function JournalRow({ row }: { row: LedgerJournalRow }) {
  const { t, formatDateTime } = useI18n();
  const merit = row.record_type === "MERIT";
  return (
    <div
      data-journal-row={row.id}
      className={`${JOURNAL_COLS} relative items-center min-h-9 max-md:py-2 border-b border-[oklch(var(--color-rule))] hover:bg-[oklch(var(--color-surface-2))] [grid-template-areas:'s_s_r_p'_'i_i_b_b'] md:[grid-template-areas:'d_s_i_b_r_p']`}
    >
      <span className={`[grid-area:d] max-md:hidden ${MONO_LABEL}`} title={formatDateTime(row.recorded_at)}>
        {row.recorded_at.slice(11, 16)}
      </span>
      <span className="[grid-area:s] text-sm font-medium truncate" title={row.soul_name}>
        <Link href={`/souls/${row.soul_id}#soul-karma`} className={ROW_LINK}>
          {row.soul_name}
        </Link>
      </span>
      <span className="[grid-area:i] text-sm truncate" title={row.description}>
        <span className="text-[oklch(var(--color-ink-subtle))]">{t(`souls.categories.${row.category}`)} · </span>
        {row.description}
      </span>
      <span className={`[grid-area:b] ${MONO_LABEL} truncate`} title={row.statute_clause || undefined}>
        <DomainText value={row.statute_clause || null} missingKind="unrecorded" />
      </span>
      <span className={`[grid-area:r] font-mono text-right ${INK_OK}`}>{merit ? signed(row.weight) : ""}</span>
      <span className={`[grid-area:p] font-mono text-right ${INK_DANGER}`}>{merit ? "" : signed(-row.weight)}</span>
    </div>
  );
}

/** 图例账:每个类目的功、过各占一行,条形只示意,数字在账行里。 */
function categoryRows(data: LedgerJournal, t: (k: string) => string): LegendLedgerRow[] {
  const rows: LegendLedgerRow[] = [];
  for (const c of data.categories) {
    if (c.merit > 0)
      rows.push({ key: `${c.category}:M`, label: `${t(`souls.categories.${c.category}`)} · ${t("souls.detail.ledger.col_in")}`, count: c.merit, swatchClass: "bg-[oklch(var(--color-karma-merit))]" });
    if (c.demerit > 0)
      rows.push({ key: `${c.category}:D`, label: `${t(`souls.categories.${c.category}`)} · ${t("souls.detail.ledger.col_out")}`, count: c.demerit, swatchClass: "bg-[oklch(var(--color-karma-demerit))]" });
  }
  return rows;
}

/** 骨架照最终版式:四柱一行,流水十行。 */
function LedgerSkeleton() {
  return (
    <div aria-busy="true" data-testid="ledger-skeleton">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-[oklch(var(--color-block))] pt-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}

/* 页级门。后端才是正解(`LedgerJournalView` 声明 `ledger.read`),这里是纵深:
   侧边栏的菜单过滤**只藏链接、不挡路由**。码名与后端对齐 ——
   `tests/test_page_gates_match_the_backend.py` 会因为路由没有门而红。 */
export default function LedgerPage() {
  return (
    <RequirePermission permissions="ledger.read" fallback={<PermissionDenied />}>
      <LedgerPageContent />
    </RequirePermission>
  );
}
