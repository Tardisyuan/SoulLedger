"use client";

import { useState } from "react";
import Link from "next/link";
import { useSouls, useCreateSoul } from "@/src/hooks/useSouls";
import { useI18n } from "@/src/contexts/I18nContext";
import { SoulCreateModal } from "@/src/components/ui/Modal";
import type { Soul } from "@/lib/api";
import { useAuth } from "@/src/hooks/useAuth";
import { RouteGuard } from "@/src/components/rbac";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-emerald-600/20 text-emerald-400",
  JUDGING: "bg-amber-600/20 text-amber-400",
  DISPOSED: "bg-surface-3 text-ink-muted",
  REINCARNATING: "bg-blue-600/20 text-blue-400",
  LOST: "bg-surface-3 text-ink-muted",
};

export default function SoulsPage() {
  const { t } = useI18n();
  const [stateFilter, setStateFilter] = useState("");
  const [civilizationFilter, setCivilizationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { user } = useAuth();

  // Build query params from filter state
  const params: Record<string, string> = {};
  if (stateFilter) params.current_state = stateFilter;
  if (civilizationFilter) params.civilization = civilizationFilter;
  if (search) params.search = search;

  // TanStack Query — automatic caching, background refetch, loading/error states
  const { data, isLoading, error, refetch } = useSouls(
    Object.keys(params).length > 0 ? params : undefined
  );
  const souls = (data?.results ?? []) as Soul[];

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
    <div className="min-h-screen bg-canvas text-ink">
      {/* Page header */}
      <div className="border-b border-hairline px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-ink-muted hover:text-ink text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-xl font-bold text-amber-400 flex-1">{t("souls.title")}</h1>
        <RouteGuard operation="soul.create" fallback={null}>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 rounded-md text-sm font-medium transition-colors"
          >
            + {t("souls.create")}
          </button>
        </RouteGuard>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              refetch(); // trigger refetch with current params
            }}
            className="flex gap-2 flex-1"
          >
            <input
              type="text"
              placeholder={t("souls.search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-surface-2 border border-hairline rounded-md px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 rounded-md text-sm transition-colors"
            >
              {t("souls.search")}
            </button>
          </form>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              refetch();
            }}
            className="bg-surface-2 border border-hairline rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500"
          >
            {states.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={civilizationFilter}
            onChange={(e) => {
              setCivilizationFilter(e.target.value);
              refetch();
            }}
            className="bg-surface-2 border border-hairline rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500"
          >
            {civilizations.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Loading / Error / Empty / Table */}
        {isLoading ? (
          <div className="text-center text-ink-muted py-12">{t("souls.loading")}</div>
        ) : error ? (
          <div className="text-center text-red-400 py-12">
            {String(error)}
          </div>
        ) : souls.length === 0 ? (
          <div className="text-center text-ink-subtle py-12">{t("souls.no_souls")}</div>
        ) : (
          <div className="bg-surface-1 rounded-lg border border-hairline overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-ink-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.name")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.civilization")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.state")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("souls.karma")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.death")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {souls.map((soul) => (
                  <tr key={soul.id} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-ink">{soul.name}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {t(`souls.civilizations.${soul.civilization}`)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul.current_state] ?? "bg-surface-3 text-ink-muted"}`}>
                        {t(`souls.states.${soul.current_state}`)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm ${(soul.karmic_balance ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {(soul.karmic_balance ?? 0) >= 0 ? "+" : ""}{soul.karmic_balance ?? 0}
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">{soul.death_date || "—"}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/souls/${soul.id}`}
                        className="text-amber-400 hover:text-amber-300 text-sm"
                      >
                        {t("souls.view")} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
