"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSouls, useCreateSoul } from "@/src/hooks/useSouls";
import { useI18n } from "@/src/contexts/I18nContext";
import { SoulCreateModal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable, parseOrdering, type SortState } from "@/components/ui/data-table";
import { DomainEnum, DomainNumber, DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { isColumnUninformative, resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PAGE_SIZE, soulsApi, type SoulListItem } from "@/lib/api";
import { formatHistoricalDate } from "@/lib/utils";

/**
 * ⊘ (red) for any ERROR-severity date problem — either the soul's own
 * dates against each other (death_before_birth, implausible_lifespan, from
 * `soul.date_problems`) or a record's event_before_birth (from
 * `soul.has_record_error`). △ (amber) for a record's unacknowledged
 * event_after_death WARNING when there's no ERROR, from
 * `soul.has_date_warning`. All three fields are computed server-side
 * (SoulListSerializer) from data already loaded per row — no extra
 * per-soul request here. See backend/apps/souls/serializers.py.
 */
function dateProblemMarker(soul: SoulListItem): { glyph: string; className: string; labelKey: string } | null {
  if (soul.date_problems.some((p) => p.severity === "error") || soul.has_record_error) {
    return {
      glyph: "⊘",
      className: "text-[hsl(var(--color-status-error))]",
      labelKey: "souls.date_problem_marker.error",
    };
  }
  if (soul.has_date_warning) {
    return {
      glyph: "△",
      className: "text-[hsl(var(--color-status-warning))]",
      labelKey: "souls.date_problem_marker.warning",
    };
  }
  return null;
}

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-[hsl(var(--color-status-alive)/0.1)] text-[hsl(var(--color-status-alive))]",
  JUDGING: "bg-[hsl(var(--color-status-judging)/0.1)] text-[hsl(var(--color-status-judging))]",
  DISPOSED: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  REINCARNATING: "bg-[hsl(var(--color-status-reincarnating)/0.1)] text-[hsl(var(--color-status-reincarnating))]",
  LOST: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  SETTLED: "bg-[hsl(var(--color-status-settled)/0.1)] text-[hsl(var(--color-status-settled))]",
};

export default function SoulsPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState("");
  const [civilizationFilter, setCivilizationFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [balanceMin, setBalanceMin] = useState("");
  const [balanceMax, setBalanceMax] = useState("");
  const [ordering, setOrdering] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Build query params from filter state
  const params: Record<string, string | number | undefined> = { page };
  if (stateFilter) params.state = stateFilter;
  if (civilizationFilter) params.civilization = civilizationFilter;
  if (search) params.search = search;
  if (balanceMin) params.karma_min = parseInt(balanceMin, 10);
  if (balanceMax) params.karma_max = parseInt(balanceMax, 10);
  if (ordering) params.ordering = ordering;
  if (problemsOnly) params.has_date_problem = "true";

  // TanStack Query — automatic caching, background refetch, loading/error states.
  // Params live in the queryKey, so filter/sort/page changes refetch on their own.
  const { data, isLoading, isError, refetch } = useSouls(params);
  const souls = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;

  // Independent of `problemsOnly` — this is the toggle's own badge count, so
  // it has to be visible before the toggle is switched on. A single extra
  // list request (page_size irrelevant, only `.count` is read), not one per
  // row — the thing item 4 said not to do.
  const problemCountQuery = useQuery({
    queryKey: ["souls", "date-problem-count"],
    queryFn: async () => (await soulsApi.list({ has_date_problem: "true", page: 1 })).data.count,
    staleTime: 30_000,
  });

  // Create mutation with auto-invalidation
  const createMutation = useCreateSoul();

  /**
   * BRIEF §4.6: "03-souls-list shows a 死亡时间 column that is `—` for every
   * row … columns earning no space." Most souls in the ledger are ALIVE, and
   * an alive soul has no death date — so on a page of living souls the column
   * is a header and a stack of dashes.
   *
   * It is dropped for that page, header and all, and comes straight back on a
   * page where any soul has died. Hiding rather than merging: the column is
   * legitimate, it just has nothing to say about *these* rows.
   */
  const showsDeathColumn = !isColumnUninformative(souls, (s) => Boolean(s.death_date));

  const states = [
    { value: "", label: t("souls.all_states") },
    { value: "ALIVE", label: t("souls.states.ALIVE") },
    { value: "JUDGING", label: t("souls.states.JUDGING") },
    { value: "DISPOSED", label: t("souls.states.DISPOSED") },
    { value: "REINCARNATING", label: t("souls.states.REINCARNATING") },
    { value: "SETTLED", label: t("souls.states.SETTLED") },
  ];

  const civilizations = [
    { value: "", label: t("souls.all_civilizations") },
    { value: "CHINESE", label: t("souls.civilizations.CHINESE") },
    { value: "EUROPEAN", label: t("souls.civilizations.EUROPEAN") },
    { value: "EGYPTIAN", label: t("souls.civilizations.EGYPTIAN") },
  ];

  const isFiltered = Boolean(search || stateFilter || civilizationFilter || balanceMin || balanceMax || problemsOnly);

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setStateFilter("");
    setCivilizationFilter("");
    setBalanceMin("");
    setBalanceMax("");
    setProblemsOnly(false);
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent-ink))] flex-1">{t("souls.title")}</h1>
        <RequirePermission permissions="soul.create">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] rounded-md text-sm font-medium transition-colors"
          >
            + {t("souls.create")}
          </button>
        </RequirePermission>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          {/* Filter bar: visible labels would crowd the row, so each control
              carries an aria-label instead — a placeholder is not an
              accessible name and disappears once the user types. */}
          <input
            type="text"
            placeholder={t("souls.search_placeholder")}
            aria-label={t("souls.search_placeholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
          <select
            value={stateFilter}
            aria-label={t("souls.filter_state")}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setPage(1);
            }}
            className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {states.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={civilizationFilter}
            aria-label={t("souls.filter_civilization")}
            onChange={(e) => {
              setCivilizationFilter(e.target.value);
              setPage(1);
            }}
            className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {civilizations.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder={t("souls.balance_min")}
              aria-label={`${t("souls.balance_range")} — ${t("souls.balance_min")}`}
              value={balanceMin}
              onChange={(e) => setBalanceMin(e.target.value)}
              onBlur={() => setPage(1)}
              className="w-20 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-2 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
            <span className="text-[hsl(var(--color-ink-muted))] text-sm">-</span>
            <input
              type="number"
              placeholder={t("souls.balance_max")}
              aria-label={`${t("souls.balance_range")} — ${t("souls.balance_max")}`}
              value={balanceMax}
              onChange={(e) => setBalanceMax(e.target.value)}
              onBlur={() => setPage(1)}
              className="w-20 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-2 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          {/* Server-side filter (SoulFilter.has_date_problem), not a
              client-side slice of the current page — the badge count and
              the toggle's own result set both come from the same query
              param, so they agree even across pages. */}
          <button
            type="button"
            onClick={() => {
              setProblemsOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={problemsOnly}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border transition-colors ${
              problemsOnly
                ? "bg-[hsl(var(--color-status-warning)/0.1)] border-[hsl(var(--color-status-warning)/0.4)] text-[hsl(var(--color-status-warning))]"
                : "bg-[hsl(var(--color-surface-2))] border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
            }`}
          >
            {t("souls.date_problem_filter")}
            {typeof problemCountQuery.data === "number" && (
              <span className="bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink))] text-xs px-1.5 py-0.5 rounded">
                {problemCountQuery.data}
              </span>
            )}
          </button>
        </div>

        <DataTable<SoulListItem>
          caption={t("souls.title")}
          columns={[
            { key: "name", header: t("souls.name"), sortable: true },
            { key: "civilization", header: t("souls.civilization") },
            { key: "state", header: t("souls.state") },
            { key: "karmic_balance", header: t("souls.balance"), sortable: true, align: "right" as const },
            ...(showsDeathColumn ? [{ key: "death", header: t("souls.death") }] : []),
            { key: "action", header: t("souls.action") },
          ]}
          data={souls}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          keyExtractor={(soul) => String(soul.id)}
          renderRow={(soul) => {
            const marker = dateProblemMarker(soul);
            // karmic_balance (merit − demerit) is the CHINESE/BALANCE
            // instrument specifically — see SoulReadingPanel and
            // backend/apps/ledger/readings.py. Showing it for every
            // civilization used to put a netted number next to an
            // Egyptian or European soul that reads on a completely
            // different mechanic; this column now only claims a balance
            // for the one civilization where that claim is true, and
            // points elsewhere for the rest rather than guessing at their
            // headline figure without the actual reading in hand.
            const showsBalance = soul.civilization === "CHINESE";
            return (
            <>
              <td className="px-4 py-3 font-medium text-[hsl(var(--color-ink))]">
                <span className="flex items-center gap-1.5">
                  {marker && (
                    <span className={marker.className} aria-hidden="true" title={t(marker.labelKey)}>
                      {marker.glyph}
                    </span>
                  )}
                  {soul.name}
                </span>
              </td>
              <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">
                <DomainEnum namespace="souls.civilizations" value={soul.civilization} />
              </td>
              <td className="px-4 py-3">
                <span
                  title={soul.current_state}
                  className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul.current_state] ?? "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"}`}
                >
                  {resolveEnumDisplay(t, "souls.states", soul.current_state).label ?? t("common.value.unrecorded")}
                </span>
              </td>
              {/* §4.6: this column was `+0` on every row. A sign is only ever
                  attached to a value that has one, so a zero balance now
                  prints a bare neutral `0` — a recorded fact — while a soul
                  whose cosmology does not net merit against demerit gets the
                  "not applicable" dot, visibly different from both. */}
              <td className="px-4 py-3 text-right text-sm">
                {showsBalance
                  ? <DomainNumber value={soul.karmic_balance ?? 0} signed toned />
                  : <MissingValue kind="inapplicable" reason={t("souls.balance_not_applicable")} />}
              </td>
              {showsDeathColumn && (
                <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))] text-xs">
                  <DomainText value={formatHistoricalDate(soul.death_date)} />
                </td>
              )}
              <td className="px-4 py-3">
                <Link
                  href={`/souls/${soul.id}`}
                  className="text-[hsl(var(--color-accent-ink))] hover:text-[hsl(var(--color-accent-ink))] text-sm"
                >
                  {t("souls.view")} →
                </Link>
              </td>
            </>
            );
          }}
          sort={parseOrdering(ordering)}
          onSortChange={(next) => {
            setOrdering(next ? `${next.direction === "desc" ? "-" : ""}${next.key}` : "");
            setPage(1);
          }}
          isFiltered={isFiltered}
          onClearFilters={resetFilters}
          emptyMessage={t("souls.no_souls")}
          page={page}
          totalPages={totalPages}
          totalCount={data?.count}
          onPageChange={setPage}
        />
      </div>

      <SoulCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => {
          setIsCreateModalOpen(false);
          refetch();
        }}
      />
    </div>
  );
}
