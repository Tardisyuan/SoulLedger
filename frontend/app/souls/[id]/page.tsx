"use client";

import { use, useEffect, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import {
  soulsApi,
  judgmentApi,
  dispositionApi,
  reincarnationApi,
  eventsApi,
  Soul,
  Judgment,
  Disposition,
  Reincarnation,
  SoulEvent,
  KarmaSummary,
  SoulRecord,
} from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-green-600",
  JUDGING: "bg-yellow-600",
  DISPOSED: "bg-orange-600",
  REINCARNATING: "bg-blue-600",
  LOST: "bg-red-600",
};

const STATE_LABELS_ZH: Record<string, string> = {
  ALIVE: "存活",
  JUDGING: "审判中",
  DISPOSED: "已处置",
  REINCARNATING: "轮回中",
  LOST: "失踪",
};

export default function SoulDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { t } = useI18n();
  const [soul, setSoul] = useState<Soul | null>(null);
  const [karma, setKarma] = useState<KarmaSummary | null>(null);
  const [records, setRecords] = useState<SoulRecord[]>([]);
  const [judgments, setJudgments] = useState<Judgment[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [reincarnations, setReincarnations] = useState<Reincarnation[]>([]);
  const [events, setEvents] = useState<SoulEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");

  useEffect(() => {
    if (!id) return;
    loadSoulData();
  }, [id]);

  async function loadSoulData() {
    setLoading(true);
    setError("");
    try {
      const [soulRes, karmaRes, recordsRes, judgmentRes, dispRes, reincRes, evtsRes] =
        await Promise.all([
          soulsApi.get(id),
          soulsApi.karma(id),
          soulsApi.records(id),
          judgmentApi.list({ soul: id }),
          dispositionApi.list({ soul: id }),
          reincarnationApi.list({ soul: id }),
          eventsApi.list({ soul: id }),
        ]);
      setSoul(soulRes.data);
      setKarma(karmaRes.data);
      setRecords(recordsRes.data.results || recordsRes.data);
      setJudgments(judgmentRes.data.results || judgmentRes.data);
      setDispositions(dispRes.data.results || dispRes.data);
      setReincarnations(reincRes.data.results || reincRes.data);
      setEvents(evtsRes.data.results || evtsRes.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load soul data");
    } finally {
      setLoading(false);
    }
  }

  async function handleDie() {
    if (!soul) return;
    if (!confirm(`Mark ${soul.name} as dead?`)) return;
    setActionLoading("die");
    try {
      await soulsApi.die(soul.id, {});
      await loadSoulData();
    } catch (e: any) {
      alert(e?.response?.data?.error || "Failed");
    } finally {
      setActionLoading("");
    }
  }

  async function handleJudgment(verdict: string) {
    if (!soul) return;
    setActionLoading(`judge-${verdict}`);
    try {
      const jRes = await judgmentApi.create({ soul: soul.id, civilization: soul.civilization });
      await judgmentApi.conclude(jRes.data.id, { verdict, notes: `Auto-judged. Karma: ${karma?.karmic_balance}` });
      await loadSoulData();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || "Failed");
    } finally {
      setActionLoading("");
    }
  }

  async function handleReincarnate(dispositionId: string) {
    setActionLoading("reincarnate");
    try {
      await reincarnationApi.reborn({
        soul_id: soul?.id,
        disposition_id: dispositionId,
        new_identity: `${soul?.name} (rebirth)`,
        rebirth_form: "HUMAN",
      });
      await loadSoulData();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || "Failed");
    } finally {
      setActionLoading("");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-slate-400">Loading soul data...</div>
      </div>
    );
  }

  if (error || !soul) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-4">
        <div className="text-red-400">{error || "Soul not found"}</div>
        <a href="/souls/" className="text-amber-400 hover:text-amber-300">← Back to souls</a>
      </div>
    );
  }

  const verdictOptions = [
    { key: "PASSED", label: "PASSED — 善行通过", color: "bg-green-700 hover:bg-green-600" },
    { key: "FAILED", label: "FAILED — 恶行失败", color: "bg-red-800 hover:bg-red-700" },
    { key: "PURGATORY", label: "PURGATORY — 待定", color: "bg-yellow-700 hover:bg-yellow-600" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-slate-400 hover:text-white text-sm">← Home</a>
          <h1 className="text-xl font-bold text-amber-400">{soul.name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${STATE_COLORS[soul.current_state]}`}>
            {soul.current_state} — {STATE_LABELS_ZH[soul.current_state] || soul.current_state}
          </span>
        </div>
        <div className="text-slate-400 text-sm">
          {soul.civilization} · {soul.birth_date || "?"} — {soul.death_date || "now"}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Soul info + Karma */}
        <div className="lg:col-span-1 space-y-6">
          {/* Soul Card */}
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-700">
            <h2 className="text-sm font-semibold text-slate-400 uppercase mb-3">Soul</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">ID</dt>
                <dd className="text-slate-200 font-mono text-xs">{soul.id.slice(0, 8)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Civilization</dt>
                <dd className="text-slate-200">{soul.civilization}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Birth</dt>
                <dd className="text-slate-200">{soul.birth_date || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Death</dt>
                <dd className="text-slate-200">{soul.death_date || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Location</dt>
                <dd className="text-slate-200">{soul.origin_location || "—"}</dd>
              </div>
            </dl>
          </div>

          {/* Karma Card */}
          {karma && (
            <div className="bg-slate-900 rounded-xl p-5 border border-slate-700">
              <h2 className="text-sm font-semibold text-slate-400 uppercase mb-3">Karma</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-400">Merit</span>
                  <span className="text-lg font-bold text-green-400">+{karma.merit_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-red-400">Demerit</span>
                  <span className="text-lg font-bold text-red-400">-{karma.demerit_score}</span>
                </div>
                <div className="border-t border-slate-700 pt-2 flex justify-between items-center">
                  <span className="text-sm text-slate-400">Balance</span>
                  <span className={`text-xl font-bold ${karma.karmic_balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {karma.karmic_balance >= 0 ? "+" : ""}{karma.karmic_balance}
                  </span>
                </div>
                <div className="text-xs text-slate-500 text-right">{karma.total_records} records</div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-700">
            <h2 className="text-sm font-semibold text-slate-400 uppercase mb-3">Actions</h2>
            <div className="space-y-2">
              {soul.current_state === "ALIVE" && (
                <button
                  onClick={handleDie}
                  disabled={!!actionLoading}
                  className="w-full py-2 px-4 bg-red-800 hover:bg-red-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
                >
                  {actionLoading === "die" ? "Processing..." : "Mark Dead → Begin Judgment"}
                </button>
              )}
              {soul.current_state === "JUDGING" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 text-center">Render Judgment</p>
                  {verdictOptions.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => handleJudgment(opt.key)}
                      disabled={!!actionLoading}
                      className={`w-full py-2 px-4 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 ${opt.color}`}
                    >
                      {actionLoading === `judge-${opt.key}` ? "Processing..." : opt.label}
                    </button>
                  ))}
                </div>
              )}
              {soul.current_state === "DISPOSED" && dispositions.filter(d => !d.is_executed).map((disp) => (
                <button
                  key={disp.id}
                  onClick={() => handleReincarnate(disp.id)}
                  disabled={!!actionLoading}
                  className="w-full py-2 px-4 bg-blue-800 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
                >
                  {actionLoading === "reincarnate" ? "Processing..." : `Reincarnate → ${disp.destination_realm || "Unknown realm"}`}
                </button>
              ))}
              {soul.current_state === "REINCARNATING" && (
                <div className="text-center text-blue-400 text-sm py-2">
                  Soul is being reborn...
                </div>
              )}
              {soul.current_state === "ALIVE" && reincarnations.length > 0 && (
                <div className="text-center text-slate-500 text-xs pt-2">
                  {reincarnations.length} previous reincarnation(s)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Judgment Records */}
          <Section title="Judgments" count={judgments.length}>
            {judgments.length === 0 && <EmptyState>No judgments yet</EmptyState>}
            {judgments.map((j) => (
              <div key={j.id} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-sm font-medium text-white">{j.court || "Unknown Court"}</div>
                    <div className="text-xs text-slate-400">{j.created_at?.slice(0, 19).replace("T", " ")}</div>
                  </div>
                  {j.verdict && (
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      j.verdict === "PASSED" ? "bg-green-900 text-green-300" :
                      j.verdict === "FAILED" ? "bg-red-900 text-red-300" :
                      "bg-yellow-900 text-yellow-300"
                    }`}>
                      {j.verdict}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {j.is_final ? "Final" : "Pending"} · {j.civilization}
                </div>
              </div>
            ))}
          </Section>

          {/* Disposition Records */}
          <Section title="Dispositions" count={dispositions.length}>
            {dispositions.length === 0 && <EmptyState>No dispositions yet</EmptyState>}
            {dispositions.map((d) => (
              <div key={d.id} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-white">
                      → {d.destination_realm || "Unknown realm"}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Memory reset: {d.memory_reset} · {d.is_eternal ? "Eternal" : `${d.memory_reset} reset`}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    d.is_executed ? "bg-blue-900 text-blue-300" : "bg-slate-700 text-slate-400"
                  }`}>
                    {d.is_executed ? "Executed" : "Pending"}
                  </span>
                </div>
              </div>
            ))}
          </Section>

          {/* Reincarnation Records */}
          <Section title="Reincarnations" count={reincarnations.length}>
            {reincarnations.length === 0 && <EmptyState>No reincarnations yet</EmptyState>}
            {reincarnations.map((r) => (
              <div key={r.id} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-white">
                      → {r.new_identity} ({r.rebirth_form})
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Cycle {r.cycle_count} · {r.target_realm}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">
                    {r.reincarnated_at?.slice(0, 19).replace("T", " ")}
                  </span>
                </div>
              </div>
            ))}
          </Section>

          {/* Event Log */}
          <Section title="Event Log" count={events.length}>
            {events.length === 0 && <EmptyState>No events yet</EmptyState>}
            {events.map((e) => (
              <div key={e.id} className="bg-slate-800 rounded-lg p-3 border border-slate-700 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-300 font-mono">{e.event_type}</span>
                  <span className="text-slate-500">{e.created_at?.slice(0, 19).replace("T", " ")}</span>
                </div>
                {e.actor && e.actor !== "system" && (
                  <div className="text-slate-500 mt-0.5">Actor: {e.actor}</div>
                )}
              </div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-xl p-5 border border-slate-700">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase">{title}</h2>
        <span className="bg-slate-700 text-slate-300 text-xs px-1.5 py-0.5 rounded">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <div className="text-slate-500 text-sm text-center py-4">{children}</div>;
}
