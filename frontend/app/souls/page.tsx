"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { soulsApi, Soul } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import SoulCreateModal from "@/src/components/souls/SoulCreateModal";

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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-slate-400 hover:text-white text-sm">← Home</Link>
        <h1 className="text-xl font-bold text-amber-400 flex-1">Souls</h1>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm font-medium transition-colors"
        >
          + Create Soul
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-center">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1">
            <input
              type="text"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded text-sm transition-colors"
            >
              Search
            </button>
          </form>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">All States</option>
            <option value="ALIVE">Alive</option>
            <option value="JUDGING">Judging</option>
            <option value="DISPOSED">Disposed</option>
            <option value="REINCARNATING">Reincarnating</option>
          </select>
          <select
            value={civilizationFilter}
            onChange={(e) => setCivilizationFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">All Civilizations</option>
            <option value="CHINESE">Chinese</option>
            <option value="EUROPEAN">European</option>
            <option value="EGYPTIAN">Egyptian</option>
          </select>
        </div>

        {/* Souls Table */}
        {loading ? (
          <div className="text-center text-slate-400 py-12">Loading...</div>
        ) : souls.length === 0 ? (
          <div className="text-center text-slate-500 py-12">No souls found</div>
        ) : (
          <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Civilization</th>
                  <th className="text-left px-4 py-3 font-medium">State</th>
                  <th className="text-right px-4 py-3 font-medium">Karma</th>
                  <th className="text-left px-4 py-3 font-medium">Death</th>
                  <th className="text-left px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {souls.map((soul) => (
                  <tr key={soul.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{soul.name}</td>
                    <td className="px-4 py-3 text-slate-400">{soul.civilization}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${STATE_COLORS[soul.current_state]}`}>
                        {soul.current_state}
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
                        View →
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
