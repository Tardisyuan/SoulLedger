"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSouls, useCreateSoul } from "@/src/hooks/useSouls";
import { useI18n } from "@/src/contexts/I18nContext";
import { SoulCreateModal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DataTable, parseOrdering, type SortState } from "@/components/ui/data-table";
import { PAGE_SIZE, type SoulListItem } from "@/lib/api";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-[hsl(var(--color-status-alive)/0.2)] text-[hsl(var(--color-status-alive))]",
  JUDGING: "bg-[hsl(var(--color-status-judging)/0.2)] text-[hsl(var(--color-status-judging))]",
  DISPOSED: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  REINCARNATING: "bg-[hsl(var(--color-status-reincarnating)/0.2)] text-[hsl(var(--color-status-reincarnating))]",
  LOST: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  SETTLED: "bg-[hsl(var(--color-status-settled)/0.2)] text-[hsl(var(--color-status-settled))]",
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

  // TanStack Query — automatic caching, background refetch, loading/error states.
  // Params live in the queryKey, so filter/sort/page changes refetch on their own.
  const { data, isLoading, isError, refetch } = useSouls(params);
  const souls = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;

  // Create mutation with auto-invalidation
  const createMutation = useCreateSoul();

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

  const isFiltered = Boolean(search || stateFilter || civilizationFilter || balanceMin || balanceMax);

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setStateFilter("");
    setCivilizationFilter("");
    setBalanceMin("");
    setBalanceMax("");
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">{t("souls.title")}</h1>
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
        </div>

        <DataTable<SoulListItem>
          caption={t("souls.title")}
          columns={[
            { key: "name", header: t("souls.name"), sortable: true },
            { key: "civilization", header: t("souls.civilization") },
            { key: "state", header: t("souls.state") },
            { key: "karmic_balance", header: t("souls.balance"), sortable: true, align: "right" },
            { key: "death", header: t("souls.death") },
            { key: "action", header: t("souls.action") },
          ]}
          data={souls}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          keyExtractor={(soul) => String(soul.id)}
          renderRow={(soul) => (
            <>
              <td className="px-4 py-3 font-medium text-[hsl(var(--color-ink))]">{soul.name}</td>
              <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">
                {t(`souls.civilizations.${soul.civilization}`)}
              </td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul.current_state] ?? "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"}`}>
                  {t(`souls.states.${soul.current_state}`)}
                </span>
              </td>
              <td className={`px-4 py-3 text-right font-mono text-sm ${(soul.karmic_balance ?? 0) >= 0 ? "text-[hsl(var(--color-accent))]" : "text-[hsl(var(--color-status-error))]"}`}>
                {(soul.karmic_balance ?? 0) >= 0 ? "+" : ""}{soul.karmic_balance ?? 0}
              </td>
              <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))] text-xs">{soul.death_date || "—"}</td>
              <td className="px-4 py-3">
                <Link
                  href={`/souls/${soul.id}`}
                  className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent))] text-sm"
                >
                  {t("souls.view")} →
                </Link>
              </td>
            </>
          )}
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
