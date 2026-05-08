"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { soulsApi, Soul } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { SoulCreateModal } from "@/src/components/ui/Modal";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-green-600",
  JUDGING: "bg-yellow-600",
  DISPOSED: "bg-orange-600",
  REINCARNATING: "bg-blue-600",
  LOST: "bg-red-600",
};

export default function SoulsPage() {
  const { t } = useI18n();
  const [souls, setSouls] = useState<Soul[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState("");
  const [civilizationFilter, setCivilizationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  useEffect(() => {
    loadSouls();
  }, [stateFilter, civilizationFilter]);

  async function loadSouls() {
    setLoading(true);
    const params: Record<string, string> = {};
    if (stateFilter) params.current_state = stateFilter;
    if (civilizationFilter) params.civilization = civilizationFilter;
    if (search) params.search = search;
    try {
      const res = await soulsApi.list(params);
      setSouls(res.data.results || res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    loadSouls();
  }

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
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Page header */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-slate-400 hover:text-white text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-xl font-bold text-amber-400 flex-1">{t("souls.title")}</h1>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm font-medium transition-colors"
        >
          + {t("souls.create")}
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1">
            <input
              type="text"
              placeholder={t("souls.search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm transition-colors"
            >
              {t("souls.search")}
            </button>
          </form>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            {states.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={civilizationFilter}
            onChange={(e) => setCivilizationFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            {civilizations.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Souls Table */}
        {loading ? (
          <div className="text-center text-slate-400 py-12">{t("souls.loading")}</div>
        ) : souls.length === 0 ? (
          <div className="text-center text-slate-500 py-12">{t("souls.no_souls")}</div>
        ) : (
          <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.name")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.civilization")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.state")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("souls.karma")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.death")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("souls.action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {souls.map((soul) => (
                  <tr key={soul.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{soul.name}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {t(`souls.civilizations.${soul.civilization}`)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${STATE_COLORS[soul.current_state]}`}>
                        {t(`souls.states.${soul.current_state}`)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm ${soul.karmic_balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {soul.karmic_balance >= 0 ? "+" : ""}{soul.karmic_balance}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{soul.death_date || "—"}</td>
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

        <SoulCreateModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={loadSouls}
        />
      </div>
    </div>
  );
}
