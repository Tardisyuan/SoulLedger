"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSouls } from "@/src/hooks/useSouls";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { SoulCreateModal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable, parseOrdering, type SortState } from "@/components/ui/data-table";
import { DomainEnum, DomainNumber, DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { isColumnUninformative, resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PAGE_SIZE, soulsApi, type SoulListItem } from "@soulledger/core/api";
import { cn, formatHistoricalDate } from "@/lib/utils";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { fieldControl } from "@/src/components/ui/Field";
import { soulStateBadgeClass } from "@/src/lib/soulStateBadge";

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

export default function SoulsPage() {
  const { t, locale } = useI18n();
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

  // Built from CIVILIZATION_OPTIONS rather than listed: a civilization missing
  // from this filter is one whose souls cannot be filtered for at all, and the
  // dropdown looks complete either way.
  const civilizations = [
    { value: "", label: t("souls.all_civilizations") },
    ...CIVILIZATION_OPTIONS.map((civ) => ({
      value: civ,
      label: t(`souls.civilizations.${civ}`),
    })),
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
    /* `page` (1200px), up from the `max-w-5xl` (1024) this page chose for
       itself. The column count is variable — the death column comes and goes
       with the rows — so the wider column is what stops a page of dead souls
       from being narrower per-column than a page of living ones. */
    <PageShell
      variant="page"
      title={t("souls.title")}
      actions={
        <RequirePermission permissions="soul.create">
          <Button type="button" variant="primary" onClick={() => setIsCreateModalOpen(true)}>
            + {t("souls.create")}
          </Button>
        </RequirePermission>
      }
      filters={
        /* Filter bar: visible labels would crowd the row — and the sticky slot
           is 32px of content height, which a `Field`'s stacked label does not
           fit in — so each control carries an aria-label instead. A placeholder
           is not an accessible name and disappears once the user types. What is
           new is that the skin is `fieldControl`, the same one `Field` puts on
           every form control, so this row and `app/users/page.tsx` no longer
           disagree about the surface (`surface-2` vs `surface-1`), the corner
           (`` vs ``) or the gap (3 vs 4). */
        <>
          <input
            type="text"
            placeholder={t("souls.search_placeholder")}
            aria-label={t("souls.search_placeholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[160px]")}
          />
          <select
            value={stateFilter}
            aria-label={t("souls.filter_state")}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setPage(1);
            }}
            className={cn(fieldControl({ size: "md" }), "w-auto shrink-0")}
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
            className={cn(fieldControl({ size: "md" }), "w-auto shrink-0")}
          >
            {civilizations.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              placeholder={t("souls.balance_min")}
              aria-label={`${t("souls.balance_range")} — ${t("souls.balance_min")}`}
              value={balanceMin}
              onChange={(e) => setBalanceMin(e.target.value)}
              onBlur={() => setPage(1)}
              className={cn(fieldControl({ size: "md" }), "w-20")}
            />
            <span className="text-03 text-[hsl(var(--color-ink-muted))]">-</span>
            <input
              type="number"
              placeholder={t("souls.balance_max")}
              aria-label={`${t("souls.balance_range")} — ${t("souls.balance_max")}`}
              value={balanceMax}
              onChange={(e) => setBalanceMax(e.target.value)}
              onBlur={() => setPage(1)}
              className={cn(fieldControl({ size: "md" }), "w-20")}
            />
          </div>
          {/* Server-side filter (SoulFilter.has_date_problem), not a
              client-side slice of the current page — the badge count and
              the toggle's own result set both come from the same query
              param, so they agree even across pages. */}
          <Button
            type="button"
            onClick={() => {
              setProblemsOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={problemsOnly}
            className={cn(
              "shrink-0",
              problemsOnly &&
                "bg-[hsl(var(--color-status-warning)/0.1)] border-[hsl(var(--color-status-warning)/0.4)] text-[hsl(var(--color-status-warning))] hover:bg-[hsl(var(--color-status-warning)/0.2)] hover:border-[hsl(var(--color-status-warning)/0.4)]"
            )}
          >
            {t("souls.date_problem_filter")}
            {typeof problemCountQuery.data === "number" && (
              <Badge className="bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink))]">
                {problemCountQuery.data}
              </Badge>
            )}
          </Button>
        </>
      }
    >
      {/* No `pagination` slot — DataTable renders its own <Pagination>
          (components/ui/data-table.tsx:288) from the four props at the end. */}
      {/* `compact` (~36px rows) because this page is scan-and-find: the operator
          is looking for a row, not deciding on each one. Decision surfaces
          (the judgment list) stay `comfortable`. */}
      <DataTable<SoulListItem>
        density="compact"
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
              <span className="flex items-center gap-1">
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
              {/* The lifecycle table keeps its own tints: these are
                  soul-lifecycle tokens (`--color-status-alive` / `-judging` /
                  `-settled` …), not the system-feedback four, and `Badge`'s
                  tone table is the feedback layer. Only the geometry moves.
                  The table itself is src/lib/soulStateBadge.ts — it was two
                  byte-identical copies, one here and one on the detail page. */}
              <Badge
                title={soul.current_state}
                className={soulStateBadgeClass(soul.current_state)}
              >
                {resolveEnumDisplay(t, "souls.states", soul.current_state).label ?? t("common.value.unrecorded")}
              </Badge>
            </td>
            {/* §4.6: this column was `+0` on every row. A sign is only ever
                attached to a value that has one, so a zero balance now
                prints a bare neutral `0` — a recorded fact — while a soul
                whose cosmology does not net merit against demerit gets the
                "not applicable" dot, visibly different from both. */}
            <td className="px-4 py-3 text-right">
              {/* `?? 0` rendered a confident zero -- signed and toned -- for a
                  value the backend deliberately withholds. `SoulSerializer
                  .to_representation` deletes merit/demerit/karmic_balance for
                  VIEWER, so the key is absent, not zero. Measured 2026-08-29:
                  a VIEWER's row read `... 审判中 0 ...`, indistinguishable
                  from a soul whose balance really is zero. Every other missing
                  value on this page goes through MissingValue; this column was
                  the one exception. */}
              {!showsBalance ? (
                <MissingValue kind="inapplicable" reason={t("souls.balance_not_applicable")} />
              ) : soul.karmic_balance === undefined || soul.karmic_balance === null ? (
                <MissingValue kind="unrecorded" reason={t("souls.balance_withheld")} />
              ) : (
                <DomainNumber value={soul.karmic_balance} signed toned />
              )}
            </td>
            {showsDeathColumn && (
              /* 02 档：日期是元数据，不是正文。 */
              <td className="px-4 py-3 text-02 text-[hsl(var(--color-ink-muted))]">
                <DomainText value={formatHistoricalDate(soul.death_date, locale)} />
              </td>
            )}
            <td className="px-4 py-3">
              <Link
                href={`/souls/${soul.id}`}
                className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline"
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

      <SoulCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => {
          setIsCreateModalOpen(false);
          refetch();
        }}
      />
    </PageShell>
  );
}
