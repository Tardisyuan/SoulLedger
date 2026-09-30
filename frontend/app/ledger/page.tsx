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
import { currentMonth, runningBalances, shiftMonth, signed } from "@/src/lib/ledgerJournal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * 功过总账 —— 规范 v2 补足 B10:按月日记账,页首四柱,**不分页**。
 *
 *     期初 + 收入 − 支出 = 期末   (旧管 + 新收 − 开除 = 实在)
 *
 * 数据全部来自 `GET /ledger/journal/`(backend/apps/ledger/journal.py):四柱与流水是**同一组
 * 筛选**算出来的,所以筛了文明、类目或搜了一户,四柱跟着变,账始终是平的。四柱是登记原值
 * (`weight`)之和,**不是**衰减后的 `karmic_balance` —— 口径写在副题上。
 *
 * B10 的画法:四柱 28 等宽,柱间 1px 行线,期末一柱 s1 底;表格是这个月的全部行 ——
 * 不分页、不加「加载更多」,超过 500 行表头吸顶;收入、支出只写数字、**不上色**,符号本身
 * 已经表达方向;「结余」一列是逐行倒推的余额(最新一行 = 期末)。导出 CSV 是幽灵按钮。
 * v1 的按日小计、本页合计与右侧图例账,B10 都没有画,随分页一起撤掉。
 *
 * 后端的 journal 仍是每页 20 行(`PAGE_SIZE`),没有「整月」的开关 —— 所以这里先取第 1 页
 * 拿到总数,再并发取其余各页拼起来。
 * ponytail: 一月 N 条要 ⌈N/20⌉ 个请求;后端给 journal 加 `page_size=all`(或整月不分页)之后
 * 换成一次请求,`fetchWholeMonth` 整个删掉。
 */

const RECORD_CATEGORIES = [
  "CHARITY", "COMPASSION", "HONESTY", "COURAGE", "WISDOM", "PIETY",
  "CRUELTY", "DECEPTION", "COWARDICE", "GREED", "BLASPHEMY", "MURDER", "OTHER",
] as const;

const MONO_LABEL = "font-mono text-2xs text-[oklch(var(--color-ink-subtle))]";
/** 日期 · 灵魂 · 类别 · 摘要 · 收入 · 支出 · 结余(B10)。393 px:两行一条。 */
const JOURNAL_COLS =
  "grid grid-cols-[minmax(0,1fr)_4rem_4rem_5rem] md:grid-cols-[3.5rem_minmax(0,1fr)_5rem_minmax(0,1.3fr)_4.5rem_4.5rem_5rem] gap-x-3";
/** B10:超过 500 行时表头吸顶(C15 表格细节)。 */
const STICKY_AFTER = 500;

/** 本月全部行:第 1 页给总数,其余页并发取回,按页序拼接(服务端已按时间倒序)。 */
async function fetchWholeMonth(filters: LedgerJournalParams): Promise<LedgerJournal> {
  const first = (await ledgerApi.journal({ ...filters, page: 1 })).data;
  const pages = Math.ceil(first.count / Math.max(first.page_size, 1));
  const rest = await Promise.all(
    Array.from({ length: Math.max(pages - 1, 0) }, (_, i) =>
      ledgerApi.journal({ ...filters, page: i + 2 }).then((r) => r.data.results)
    )
  );
  return { ...first, results: [...first.results, ...rest.flat()] };
}

function LedgerPageContent() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [month, setMonth] = useState(() => currentMonth());
  const [civilization, setCivilization] = useState("");
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const { showToast } = useToast();

  // Same 300 ms debounce as /souls: one request per pause, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* 搜索与文明、类目是**同一组**筛选:四柱、流水与导出都读它,所以搜出一户,
     四柱就只是这一户的账,仍然平。 */
  const filters: LedgerJournalParams = {
    month,
    ...(civilization && { civilization }),
    ...(category && { category }),
    ...(search && { search }),
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ledger", "journal", "month", filters],
    queryFn: () => fetchWholeMonth(filters),
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

  const clearFilters = () => {
    setCivilization("");
    setCategory("");
    setSearchInput("");
    setSearch("");
  };
  const filtered = Boolean(civilization || category || search);

  /* 月份:◂ 2026-09 ▸,高 32、1px ink3 框、s1 底(B10 工具条)。 */
  const MONTH_STEP = "px-2 h-full text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]";

  return (
    <PageShell
      variant="full"
      title={t("ledger.journal.title")}
      subtitle={t("ledger.journal.subtitle")}
      filters={
        <>
          <span className="flex items-center h-8 border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] font-mono text-sm">
            <button type="button" aria-label={t("ledger.journal.month_prev")} onClick={() => setMonth(shiftMonth(month, -1))} className={MONTH_STEP}>
              ◂
            </button>
            <input
              type="month"
              aria-label={t("ledger.journal.month")}
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="bg-transparent px-1 h-full font-mono text-sm text-[oklch(var(--color-ink))]"
            />
            <button type="button" aria-label={t("ledger.journal.month_next")} onClick={() => setMonth(shiftMonth(month, 1))} className={MONTH_STEP}>
              ▸
            </button>
          </span>
          <FilterChipSelect
            label={t("ledger.journal.category")}
            value={category}
            options={[
              { value: "", label: t("filter.all") },
              ...RECORD_CATEGORIES.map((c) => ({ value: c, label: t(`souls.categories.${c}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("ledger.journal.category") })}
            onChange={setCategory}
          />
          <FilterChipSelect
            label={t("souls.filter_civilization")}
            value={civilization}
            options={[
              { value: "", label: t("filter.all") },
              ...CIVILIZATION_OPTIONS.map((c) => ({ value: c, label: t(`souls.civilizations.${c}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("souls.filter_civilization") })}
            onChange={setCivilization}
          />
          <input
            type="search"
            placeholder={t("ledger.journal.search")}
            aria-label={t("ledger.journal.search")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-40")}
          />
          <Button type="button" variant="secondary" loading={exporting} onClick={exportCsv}>
            {t("ledger.journal.export")}
          </Button>
        </>
      }
    >
      {isError && !data ? (
        <QueryError onRetry={() => refetch()} detail={t("ledger.journal.load_failed")} />
      ) : isLoading || !data ? (
        <LedgerSkeleton />
      ) : (
        <LedgerBody
          data={data}
          onPrevMonth={() => setMonth(shiftMonth(month, -1))}
          onClearFilters={filtered ? clearFilters : undefined}
        />
      )}
    </PageShell>
  );
}

function LedgerBody({
  data,
  onPrevMonth,
  onClearFilters,
}: {
  data: LedgerJournal;
  onPrevMonth: () => void;
  onClearFilters?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <FourPillars data={data} />
      <p className={MONO_LABEL} data-testid="ledger-formula">
        {t("ledger.journal.formula", { souls: String(data.soul_count), records: String(data.record_count) })}
      </p>

      {data.record_count === 0 ? (
        /* C15「空」:给一条出路 —— 有筛选就清筛选,没有就去上一月。 */
        <EmptyState
          title={t("ledger.journal.empty_title")}
          reason={t("ledger.journal.empty_reason", { month: data.month, opening: signed(data.opening) })}
          action={
            onClearFilters ? (
              <Button type="button" variant="secondary" size="sm" onClick={onClearFilters}>
                {t("filter.clear_all")}
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={onPrevMonth}>
                {t("ledger.journal.month_prev")}
              </Button>
            )
          }
        />
      ) : (
        <Journal rows={data.results} closing={data.closing} />
      )}
    </div>
  );
}

/** 四柱(B10):28 等宽,柱间 1px 行线,期末一柱 s1 底;数字不上色。 */
function FourPillars({ data }: { data: LedgerJournal }) {
  const { t } = useI18n();
  const cells: { key: string; label: string; value: string; closing?: boolean }[] = [
    { key: "opening", label: t("ledger.journal.pillar_opening"), value: signed(data.opening) },
    { key: "received", label: t("ledger.journal.pillar_received"), value: signed(data.received) },
    { key: "disbursed", label: t("ledger.journal.pillar_disbursed"), value: signed(-data.disbursed) },
    { key: "closing", label: t("ledger.journal.pillar_closing"), value: signed(data.closing), closing: true },
  ];
  return (
    <dl
      data-testid="four-pillars"
      className="grid grid-cols-2 md:grid-cols-4 border-t-2 border-b border-t-[oklch(var(--color-ink))] border-b-[oklch(var(--color-line))]"
    >
      {cells.map((c, i) => (
        <div
          key={c.key}
          data-pillar={c.key}
          className={cn(
            "px-3 py-2 border-[oklch(var(--color-line))]",
            i > 0 && "md:border-l",
            i % 2 === 1 && "max-md:border-l",
            c.closing && "bg-[oklch(var(--color-surface-1))]"
          )}
        >
          <dt className="text-xs text-[oklch(var(--color-ink-subtle))]">{c.label}</dt>
          <dd className="font-mono text-xl tabular-nums text-[oklch(var(--color-ink))]">{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Journal({ rows, closing }: { rows: LedgerJournalRow[]; closing: number }) {
  const { t } = useI18n();
  const balances = runningBalances(rows, closing);
  const sticky = rows.length > STICKY_AFTER;
  return (
    <section className="min-w-0" data-testid="ledger-journal">
      <div
        data-testid="journal-head"
        className={cn(
          JOURNAL_COLS,
          "max-md:hidden h-7 items-center border-b-2 border-[oklch(var(--color-ink))] bg-[oklch(var(--color-canvas))]",
          MONO_LABEL,
          sticky && "sticky top-0 z-10"
        )}
      >
        <span>{t("ledger.journal.col_day")}</span>
        <span>{t("ledger.journal.col_soul")}</span>
        <span>{t("ledger.journal.category")}</span>
        <span>{t("ledger.journal.col_entry")}</span>
        <span className="text-right">{t("souls.detail.ledger.col_in")}</span>
        <span className="text-right">{t("souls.detail.ledger.col_out")}</span>
        <span className="text-right">{t("ledger.journal.col_balance")}</span>
      </div>
      {rows.map((r, i) => (
        <JournalRow key={r.id} row={r} balance={balances[i]} />
      ))}
      <div
        data-testid="journal-foot"
        className="flex flex-wrap justify-between gap-3 pt-2 border-t-2 border-[oklch(var(--color-ink))] -mt-px text-xs text-[oklch(var(--color-ink-muted))]"
      >
        <span>{t("ledger.journal.all_shown", { n: String(rows.length) })}</span>
        <span className={MONO_LABEL}>{t("ledger.journal.row_hint")}</span>
      </div>
    </section>
  );
}

/** 整行可点:一条 `Link` 用 `::after` 盖住整行,进入该户详情的「乙 · 功过」。 */
function JournalRow({ row, balance }: { row: LedgerJournalRow; balance: number }) {
  const { t, formatDateTime } = useI18n();
  const merit = row.record_type === "MERIT";
  const category = t(`souls.categories.${row.category}`);
  // 摘要 = 事目,有依据就接在后面(v1 的「依据」一列,B10 并进摘要)。
  const summary = row.statute_clause ? `${row.description} · ${row.statute_clause}` : row.description;
  return (
    <div
      data-journal-row={row.id}
      className={`${JOURNAL_COLS} relative items-center min-h-9 max-md:py-2 border-b border-[oklch(var(--color-line))] hover:bg-[oklch(var(--color-surface-2))] [grid-template-areas:'s_r_p_b'_'m_m_m_m'] md:[grid-template-areas:'d_s_c_m_r_p_b']`}
    >
      <span className={`[grid-area:d] max-md:hidden ${MONO_LABEL}`} title={formatDateTime(row.recorded_at)}>
        {row.day.slice(5)}
      </span>
      <span className="[grid-area:s] text-sm truncate" title={row.soul_name}>
        <Link href={`/souls/${row.soul_id}#soul-karma`} className={ROW_LINK}>
          {row.soul_name}
        </Link>
      </span>
      <span className="[grid-area:c] max-md:hidden text-xs text-[oklch(var(--color-ink-muted))] truncate" title={category}>
        {category}
      </span>
      <span className="[grid-area:m] text-xs text-[oklch(var(--color-ink-muted))] truncate" title={summary}>
        <span className="md:hidden font-mono">
          {row.day.slice(5)} · {category} ·{" "}
        </span>
        {summary}
      </span>
      <span className="[grid-area:r] font-mono text-sm tabular-nums text-right">{merit ? signed(row.weight) : ""}</span>
      <span className="[grid-area:p] font-mono text-sm tabular-nums text-right">{merit ? "" : signed(-row.weight)}</span>
      <span className="[grid-area:b] font-mono text-sm tabular-nums text-right" data-testid="row-balance">
        {signed(balance)}
      </span>
    </div>
  );
}

/** 骨架照最终版式(C15:表格 = 表头 + 3 行,静态):四柱一行,表头,三行。 */
function LedgerSkeleton() {
  return (
    <div aria-busy="true" data-testid="ledger-skeleton" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t-2 border-[oklch(var(--color-ink))] pt-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/* 页级门。后端才是正解(`LedgerJournalView` 声明 `ledger.read`),这里是纵深:
   侧边栏的菜单过滤**只藏链接、不挡路由**。码名与后端对齐 ——
   `tests/test_page_gates_match_the_backend.py` 会因为路由没有门而红。 */
export default function LedgerPage() {
  return (
    <RequirePermission permissions="ledger.read" fallback={<PermissionDenied permission="ledger.read" />}>
      <LedgerPageContent />
    </RequirePermission>
  );
}
