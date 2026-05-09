"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
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
import { useUpdateSoul, useDeleteSoul } from "@/src/hooks/useSouls";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import { BaseModal } from "@/src/components/ui/Modal";

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-emerald-600/20 text-emerald-400",
  JUDGING: "bg-amber-600/20 text-amber-400",
  DISPOSED: "bg-surface-3 text-ink-muted",
  REINCARNATING: "bg-blue-600/20 text-blue-400",
  LOST: "bg-surface-3 text-ink-muted",
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
  const router = useRouter();
  const { t } = useI18n();
  const { showToast } = useToast();
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
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const updateSoulMutation = useUpdateSoul();
  const deleteSoulMutation = useDeleteSoul();

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

  function handleEditSuccess() {
    loadSoulData();
  }

  function handleDeleteConfirm() {
    if (!soul) return;
    setIsDeleteModalOpen(true);
  }

  async function handleDelete() {
    if (!soul) return;
    try {
      await deleteSoulMutation.mutateAsync(soul.id);
      showToast("删除成功", "success");
      router.push("/souls");
    } catch {
      // error handled by hook
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center">
        <div className="text-ink-muted">Loading soul data...</div>
      </div>
    );
  }

  if (error || !soul) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center gap-4">
        <div className="text-red-400">{error || "Soul not found"}</div>
        <a href="/souls/" className="text-amber-400 hover:text-amber-400">← Back to souls</a>
      </div>
    );
  }

  const verdictOptions = [
    { key: "PASSED", label: "PASSED — 善行通过", color: "bg-green-600 hover:bg-green-500" },
    { key: "FAILED", label: "FAILED — 恶行失败", color: "bg-red-700 hover:bg-red-600" },
    { key: "PURGATORY", label: "PURGATORY — 待定", color: "bg-yellow-600 hover:bg-yellow-500" },
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Header */}
      <div className="border-b border-hairline px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-ink-muted hover:text-ink text-sm">← Home</a>
          <h1 className="text-xl font-bold text-amber-400">{soul.name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul.current_state]}`}>
            {soul.current_state} — {STATE_LABELS_ZH[soul.current_state] || soul.current_state}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-ink-muted text-sm">
            {soul.civilization} · {soul.birth_date || "?"} — {soul.death_date || "now"}
          </div>
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="px-3 py-1.5 bg-surface-1 border border-hairline hover:bg-surface-2 text-ink-muted hover:text-ink rounded-md text-sm transition-colors"
          >
            编辑
          </button>
          <button
            onClick={handleDeleteConfirm}
            className="px-3 py-1.5 bg-red-900/50 border border-red-800 hover:bg-red-800 text-red-300 rounded-md text-sm transition-colors"
          >
            删除
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Soul info + Karma */}
        <div className="lg:col-span-1 space-y-6">
          {/* Soul Card */}
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">Soul</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">ID</dt>
                <dd className="text-ink font-mono text-xs">{soul.id.slice(0, 8)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Civilization</dt>
                <dd className="text-ink">{soul.civilization}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Birth</dt>
                <dd className="text-ink">{soul.birth_date || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Death</dt>
                <dd className="text-ink">{soul.death_date || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Location</dt>
                <dd className="text-ink">{soul.origin_location || "—"}</dd>
              </div>
            </dl>
          </div>

          {/* Karma Card */}
          {karma && (
            <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
              <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">Karma</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-400">Merit</span>
                  <span className="text-lg font-bold text-green-400">+{karma.merit_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-red-400">Demerit</span>
                  <span className="text-lg font-bold text-red-400">-{karma.demerit_score}</span>
                </div>
                <div className="border-t border-hairline pt-2 flex justify-between items-center">
                  <span className="text-sm text-ink-muted">Balance</span>
                  <span className={`text-xl font-bold ${karma.karmic_balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {karma.karmic_balance >= 0 ? "+" : ""}{karma.karmic_balance}
                  </span>
                </div>
                <div className="text-xs text-ink-subtle text-right">{karma.total_records} records</div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">Actions</h2>
            <div className="space-y-2">
              {soul.current_state === "ALIVE" && (
                <button
                  onClick={handleDie}
                  disabled={!!actionLoading}
                  className="w-full py-2 px-4 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
                >
                  {actionLoading === "die" ? "Processing..." : "Mark Dead → Begin Judgment"}
                </button>
              )}
              {soul.current_state === "JUDGING" && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-muted text-center">Render Judgment</p>
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
                  className="w-full py-2 px-4 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
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
                <div className="text-center text-ink-subtle text-xs pt-2">
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
              <div key={j.id} className="bg-surface-2 rounded-lg p-4 border border-hairline">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-sm font-medium text-ink">{j.court || "Unknown Court"}</div>
                    <div className="text-xs text-ink-muted">{j.created_at?.slice(0, 19).replace("T", " ")}</div>
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
                <div className="text-xs text-ink-muted">
                  {j.is_final ? "Final" : "Pending"} · {j.civilization}
                </div>
              </div>
            ))}
          </Section>

          {/* Disposition Records */}
          <Section title="Dispositions" count={dispositions.length}>
            {dispositions.length === 0 && <EmptyState>No dispositions yet</EmptyState>}
            {dispositions.map((d) => (
              <div key={d.id} className="bg-surface-2 rounded-lg p-4 border border-hairline">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      → {d.destination_realm || "Unknown realm"}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      Memory reset: {d.memory_reset} · {d.is_eternal ? "Eternal" : `${d.memory_reset} reset`}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    d.is_executed ? "bg-blue-900 text-blue-300" : "bg-surface-3 text-ink-muted"
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
              <div key={r.id} className="bg-surface-2 rounded-lg p-4 border border-hairline">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      → {r.new_identity} ({r.rebirth_form})
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      Cycle {r.cycle_count} · {r.target_realm}
                    </div>
                  </div>
                  <span className="text-xs text-ink-subtle">
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
              <div key={e.id} className="bg-surface-2 rounded-lg p-3 border border-hairline text-xs">
                <div className="flex justify-between">
                  <span className="text-ink font-mono">{e.event_type}</span>
                  <span className="text-ink-subtle">{e.created_at?.slice(0, 19).replace("T", " ")}</span>
                </div>
                {e.actor && e.actor !== "system" && (
                  <div className="text-ink-subtle mt-0.5">Actor: {e.actor}</div>
                )}
              </div>
            ))}
          </Section>
        </div>
      </div>

      {/* Edit Modal */}
      {soul && (
        <SoulEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          soul={soul}
          onUpdated={handleEditSuccess}
        />
      )}

      {/* Delete Confirmation Modal */}
      <BaseModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="确认删除"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={deleteSoulMutation.isPending}
              className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteSoulMutation.isPending}
              className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900/50 text-white rounded text-sm font-medium transition-colors"
            >
              {deleteSoulMutation.isPending ? "删除中..." : "确认删除"}
            </button>
          </div>
        }
      >
        <p className="text-ink text-sm">确认删除此灵魂？此操作不可撤销。</p>
      </BaseModal>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-ink-muted uppercase">{title}</h2>
        <span className="bg-surface-3 text-ink text-xs px-1.5 py-0.5 rounded">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <div className="text-ink-subtle text-sm text-center py-4">{children}</div>;
}
