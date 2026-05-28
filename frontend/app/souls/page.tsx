"use client";

import { useState } from "react";
import Link from "next/link";
import { useSouls, useCreateSoul } from "@/src/hooks/useSouls";
import { useI18n } from "@/src/contexts/I18nContext";
import { SoulCreateModal } from "@/src/components/ui/Modal";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import type { Soul } from "@/lib/api";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-[hsl(38,92%,50%,0.2)] text-[hsl(38,92%,50%)]",
  JUDGING: "bg-[hsl(38,92%,50%,0.2)] text-[hsl(38,92%,50%)]",
  DISPOSED: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  REINCARNATING: "bg-[hsl(217,91%,52%,0.2)] text-[hsl(217,91%,52%)]",
  LOST: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
};

export default function SoulsPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState("");
  const [civilizationFilter, setCivilizationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [karmaMin, setKarmaMin] = useState("");
  const [karmaMax, setKarmaMax] = useState("");
  const [ordering, setOrdering] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Build query params from filter state
  // Map civilization to tenant code for backend filtering
  const civilizationToTenantCode: Record<string, string> = {
    CHINESE: "CN_DIYU",
    EUROPEAN: "EU_HEAVEN_HELL",
    EGYPTIAN: "EG_DUAT",
  };
  const params: Record<string, string | number | undefined> = { page };
  if (stateFilter) params.state = stateFilter;
  if (civilizationFilter) params.civilization = civilizationFilter;
  if (search) params.search = search;
  if (karmaMin) params.karma_min = parseInt(karmaMin, 10);
  if (karmaMax) params.karma_max = parseInt(karmaMax, 10);
  if (ordering) params.ordering = ordering;

  // TanStack Query — automatic caching, background refetch, loading/error states
  const { data, isLoading, error, refetch } = useSouls(params);
  const souls = (data?.results ?? []) as Soul[];
  const totalPages = data ? Math.ceil(data.count / 20) : 0;

  // Create mutation with auto-invalidation
  const createMutation = useCreateSoul();

  const states = [
    { value: "", label: t("souls.all_states") },
    { value: "ALIVE", label: t("souls.states.ALIVE") },
    { value: "JUDGING", label: t("souls.states.JUDGING") },
    { value: "DISPOSED", label: t("souls.states.DISPOSED") },
    { value: "REINCARNATING", label: t("souls.states.REINCARNATING") },
  ];

  const civilizations = [
    { value: "", label: t("souls.all_civilizations") },
    { value: "CHINESE", label: t("souls.civilizations.CHINESE") },
    { value: "EUROPEAN", label: t("souls.civilizations.EUROPEAN") },
    { value: "EGYPTIAN", label: t("souls.civilizations.EGYPTIAN") },
  ];

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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              refetch();
            }}
            className="flex gap-2 flex-1"
          >
            <input
              type="text"
              placeholder={t("souls.search_placeholder")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="flex-1 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] rounded-md text-sm transition-colors"
            >
              {t("souls.search")}
            </button>
          </form>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setPage(1);
              refetch();
            }}
            className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {states.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={civilizationFilter}
            onChange={(e) => {
              setCivilizationFilter(e.target.value);
              setPage(1);
              refetch();
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
              placeholder={t("souls.karma_min")}
              value={karmaMin}
              onChange={(e) => setKarmaMin(e.target.value)}
              onBlur={() => { setPage(1); refetch(); }}
              className="w-20 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-2 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
            <span className="text-[hsl(var(--color-ink-muted))] text-sm">-</span>
            <input
              type="number"
              placeholder={t("souls.karma_max")}
              value={karmaMax}
              onChange={(e) => setKarmaMax(e.target.value)}
              onBlur={() => { setPage(1); refetch(); }}
              className="w-20 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-2 py-2 text-sm text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
            />
          </div>
          <select
            value={ordering}
            onChange={(e) => {
              setOrdering(e.target.value);
              setPage(1);
              refetch();
            }}
            className="bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-md px-3 py-2 text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            <option value="">{t("souls.order_default")}</option>
            <option value="name">{t("souls.order_name")}</option>
            <option value="-name">{t("souls.order_name_desc")}</option>
            <option value="karmic_balance">{t("souls.order_karma")}</option>
            <option value="-karmic_balance">{t("souls.order_karma_desc")}</option>
          </select>
        </div>

        {/* Loading / Error / Empty / Table */}
        {isLoading ? (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.name")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.civilization")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.state")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("souls.karma")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.death")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-[hsl(var(--color-surface-2))] rounded"></div></td>
                    <td className="px-4 py-3"><div className="h-4 w-16 bg-[hsl(var(--color-surface-2))] rounded"></div></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-[hsl(var(--color-surface-2))] rounded"></div></td>
                    <td className="px-4 py-3"><div className="h-4 w-12 bg-[hsl(var(--color-surface-2))] rounded ml-auto"></div></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-[hsl(var(--color-surface-2))] rounded"></div></td>
                    <td className="px-4 py-3"><div className="h-4 w-12 bg-[hsl(var(--color-surface-2))] rounded"></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : error ? (
          <div className="text-center text-red-400 py-12">
            {String(error)}
          </div>
        ) : souls.length === 0 ? (
          <div className="text-center text-[hsl(var(--color-ink-subtle))] py-12">{t("souls.no_souls")}</div>
        ) : (
          <>
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.name")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.civilization")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.state")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("souls.karma")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.death")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--color-hairline))]">
                {souls.map((soul) => (
                  <tr key={soul.id} className="hover:bg-[hsl(var(--color-surface-2))]/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-[hsl(var(--color-ink))]">{soul.name}</td>
                    <td className="px-4 py-3 text-[hsl(var(--color-ink-muted))]">
                      {t(`souls.civilizations.${soul.civilization}`)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul.current_state] ?? "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"}`}>
                        {t(`souls.states.${soul.current_state}`)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm ${(soul.karmic_balance ?? 0) >= 0 ? "text-[hsl(var(--color-accent))]" : "text-red-400"}`}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {souls.length > 0 && (
            <div className="flex items-center justify-between mt-4 px-2">
              <p className="text-sm text-[hsl(var(--color-ink-muted))]">
                {t("souls.page_info", {
                  page: String(page),
                  total: String(totalPages),
                  count: String(data?.count ?? 0),
                })}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
                >
                  ← {t("common.prev")}
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 disabled:cursor-not-allowed text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
                >
                  {t("common.next")} →
                </button>
              </div>
            </div>
          )}
          </>
        )}
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
