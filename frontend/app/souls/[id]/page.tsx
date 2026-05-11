"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
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
  KarmaRecord,
  SoulRecord,
} from "@/lib/api";
import { useUpdateSoul, useDeleteSoul } from "@/src/hooks/useSouls";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import { BaseModal } from "@/src/components/ui/Modal";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-emerald-600/20 text-emerald-400",
  JUDGING: "bg-amber-600/20 text-amber-400",
  DISPOSED: "bg-surface-3 text-ink-muted",
  REINCARNATING: "bg-blue-600/20 text-blue-400",
  LOST: "bg-surface-3 text-ink-muted",
};

export default function SoulDetailPage() {
  const params = useParams();
  const id = params.id as string;
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
      setError(e?.response?.data?.detail || e?.message || t("souls.detail.loading"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDie() {
    if (!soul) return;
    if (!confirm(t("souls.detail.mark_dead_confirm", { name: soul.name }))) return;
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
      showToast(t("souls.detail.delete_success"), "success");
      router.push("/souls");
    } catch {
      // error handled by hook
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center">
        <div className="text-ink-muted">{t("souls.detail.loading")}</div>
      </div>
    );
  }

  if (error || !soul) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center gap-4">
        <div className="text-red-400">{error || t("souls.detail.not_found")}</div>
        <a href="/souls/" className="text-amber-400 hover:text-amber-400">{t("souls.detail.back_to_list")}</a>
      </div>
    );
  }

  const verdictOptions = [
    { key: "PASSED", color: "bg-green-600 hover:bg-green-500" },
    { key: "FAILED", color: "bg-red-700 hover:bg-red-600" },
    { key: "PURGATORY", color: "bg-yellow-600 hover:bg-yellow-500" },
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Header */}
      <div className="border-b border-hairline px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-ink-muted hover:text-ink text-sm">{t("souls.detail.back_to_list").slice(0, 2)}</a>
          <h1 className="text-xl font-bold text-amber-400">{soul.name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul.current_state]}`}>
            {soul.current_state} — {t(`souls.states.${soul.current_state}`) || soul.current_state}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-ink-muted text-sm">
            {soul.civilization} · {soul.birth_date || "?"} — {soul.death_date || "—"}
          </div>
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="px-3 py-1.5 bg-surface-1 border border-hairline hover:bg-surface-2 text-ink-muted hover:text-ink rounded-md text-sm transition-colors"
          >
            {t("souls.detail.edit")}
          </button>
          <button
            onClick={handleDeleteConfirm}
            className="px-3 py-1.5 bg-red-900/50 border border-red-800 hover:bg-red-800 text-red-300 rounded-md text-sm transition-colors"
          >
            {t("souls.detail.delete")}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Soul info + Karma */}
        <div className="lg:col-span-1 space-y-6">
          {/* Soul Card */}
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">{t("souls.detail.soul_info")}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("souls.detail.id")}</dt>
                <dd className="text-ink font-mono text-xs">{soul.id.slice(0, 8)}...</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("souls.civilization")}</dt>
                <dd className="text-ink">{soul.civilization}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("souls.detail.birth")}</dt>
                <dd className="text-ink">{soul.birth_date || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("souls.detail.death")}</dt>
                <dd className="text-ink">{soul.death_date || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("souls.detail.location_label")}</dt>
                <dd className="text-ink">{soul.origin_location || "—"}</dd>
              </div>
            </dl>
          </div>

          {/* Karma Card */}
          {karma && (
            <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
              <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">{t("souls.karma")}</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-400">{t("souls.detail.merit")}</span>
                  <span className="text-lg font-bold text-green-400">+{karma.merit_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-red-400">{t("souls.detail.demerit")}</span>
                  <span className="text-lg font-bold text-red-400">-{karma.demerit_score}</span>
                </div>
                <div className="border-t border-hairline pt-2 flex justify-between items-center">
                  <span className="text-sm text-ink-muted">{t("souls.detail.balance")}</span>
                  <span className={`text-xl font-bold ${karma.karmic_balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {karma.karmic_balance >= 0 ? "+" : ""}{karma.karmic_balance}
                  </span>
                </div>
                <div className="text-xs text-ink-subtle text-right">{karma.record_count} {t("souls.detail.records")}</div>

                {/* Karma Timeline Chart */}
                {karma.records && karma.records.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-ink-muted mb-2">{t("karma.timeline")} ({t("karma.time_decay")})</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={getKarmaChartData(karma.records)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#23252a" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#8a8f98", fontSize: 9 }}
                          tickFormatter={(v) => v.slice(5, 10)}
                        />
                        <YAxis tick={{ fill: "#8a8f98", fontSize: 9 }} width={30} />
                        <Tooltip
                          contentStyle={{ background: "#0f1011", border: "1px solid #23252a", borderRadius: "6px", fontSize: 11 }}
                          labelStyle={{ color: "#8a8f98" }}
                        />
                        <ReferenceLine x={0} stroke="#23252a" />
                        <Line
                          type="monotone"
                          dataKey="cumulative"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                          name="Balance"
                        />
                      </LineChart>
                    </ResponsiveContainer>

                    {/* Reincarnation Inheritance Preview */}
                    {karma.karmic_balance !== 0 && (
                      <div className="mt-3 pt-2 border-t border-hairline">
                        <p className="text-xs text-ink-muted mb-1">{t("karma.next_life_inheritance")}</p>
                        <div className="flex justify-between text-xs">
                          <span className="text-green-400">{t("souls.detail.merit")}: +{Math.round(karma.merit_score * 0.2)}</span>
                          <span className="text-red-400">{t("souls.detail.demerit")}: -{Math.round(karma.demerit_score * 0.2)}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-ink-subtle">{t("souls.detail.balance")}: </span>
                          <span className={karma.karmic_balance >= 0 ? "text-green-400" : "text-red-400"}>
                            {karma.karmic_balance >= 0 ? "+" : ""}{Math.round(karma.karmic_balance * 0.2)}
                          </span>
                        </div>
                        <p className="text-[10px] text-ink-subtle mt-1">{t("karma.inheritance_note")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="bg-surface-1 rounded-lg p-5 border border-hairline">
            <h2 className="text-sm font-semibold text-ink-muted uppercase mb-3">{t("souls.detail.actions")}</h2>
            <div className="space-y-2">
              {soul.current_state === "ALIVE" && (
                <button
                  onClick={handleDie}
                  disabled={!!actionLoading}
                  className="w-full py-2 px-4 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
                >
                  {actionLoading === "die" ? t("souls.detail.processing") : t("souls.detail.mark_dead")}
                </button>
              )}
              {soul.current_state === "JUDGING" && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-muted text-center">{t("souls.detail.render_judgment")}</p>
                  {verdictOptions.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => handleJudgment(opt.key)}
                      disabled={!!actionLoading}
                      className={`w-full py-2 px-4 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 ${opt.color}`}
                    >
                      {actionLoading === `judge-${opt.key}` ? t("souls.detail.processing") : t(`souls.detail.verdict_${opt.key.toLowerCase()}`)}
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
                  {actionLoading === "reincarnate" ? t("souls.detail.processing") : `${t("souls.detail.reincarnate")} ${disp.destination_realm || t("souls.detail.destination")}`}
                </button>
              ))}
              {soul.current_state === "REINCARNATING" && (
                <div className="text-center text-blue-400 text-sm py-2">
                  {t("souls.detail.being_reborn")}
                </div>
              )}
              {soul.current_state === "ALIVE" && reincarnations.length > 0 && (
                <div className="text-center text-ink-subtle text-xs pt-2">
                  {reincarnations.length} {t("souls.detail.previous_reincarnations")}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Judgment Records */}
          <Section title={t("souls.detail.judgments")} count={judgments.length}>
            {judgments.length === 0 && <EmptyState>{t("souls.detail.no_judgments")}</EmptyState>}
            {judgments.map((j) => (
              <div key={j.id} className="bg-surface-2 rounded-lg p-4 border border-hairline">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-sm font-medium text-ink">{j.court || t("souls.detail.court")}</div>
                    <div className="text-xs text-ink-muted">{j.created_at?.slice(0, 19).replace("T", " ")}</div>
                  </div>
                  {j.verdict && (
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      j.verdict === "PASSED" ? "bg-green-900 text-green-300" :
                      j.verdict === "FAILED" ? "bg-red-900 text-red-300" :
                      "bg-yellow-900 text-yellow-300"
                    }`}>
                      {t(`souls.detail.verdict_${j.verdict.toLowerCase()}`) || j.verdict}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-muted">
                  {j.is_final ? t("souls.detail.final") : t("souls.detail.pending")} · {j.civilization}
                </div>
              </div>
            ))}
          </Section>

          {/* Disposition Records */}
          <Section title={t("souls.detail.dispositions")} count={dispositions.length}>
            {dispositions.length === 0 && <EmptyState>{t("souls.detail.no_dispositions")}</EmptyState>}
            {dispositions.map((d) => (
              <div key={d.id} className="bg-surface-2 rounded-lg p-4 border border-hairline">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      → {d.destination_realm || t("souls.detail.destination")}
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      {t("souls.detail.memory_reset")}: {d.memory_reset} · {d.is_eternal ? t("souls.detail.eternal") : `${d.memory_reset} ${t("souls.detail.memory_reset")}`}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    d.is_executed ? "bg-blue-900 text-blue-300" : "bg-surface-3 text-ink-muted"
                  }`}>
                    {d.is_executed ? t("souls.detail.executed") : t("souls.detail.pending")}
                  </span>
                </div>
              </div>
            ))}
          </Section>

          {/* Reincarnation Records */}
          <Section title={t("souls.detail.reincarnations")} count={reincarnations.length}>
            {reincarnations.length === 0 && <EmptyState>{t("souls.detail.no_reincarnations")}</EmptyState>}
            {reincarnations.map((r) => (
              <div key={r.id} className="bg-surface-2 rounded-lg p-4 border border-hairline">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      → {r.new_identity} ({r.rebirth_form})
                    </div>
                    <div className="text-xs text-ink-muted mt-1">
                      {t("souls.detail.cycle")} {r.cycle_count} · {r.target_realm}
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
          <Section title={t("souls.detail.event_log")} count={events.length}>
            {events.length === 0 && <EmptyState>{t("souls.detail.no_events")}</EmptyState>}
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
        title={t("souls.detail.confirm_delete")}
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={deleteSoulMutation.isPending}
              className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
            >
              {t("souls.detail.cancel_delete")}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteSoulMutation.isPending}
              className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900/50 text-white rounded text-sm font-medium transition-colors"
            >
              {deleteSoulMutation.isPending ? t("souls.detail.deleting") : t("souls.detail.confirm_delete_action")}
            </button>
          </div>
        }
      >
        <p className="text-ink text-sm">{t("souls.detail.delete_confirm_message")}</p>
      </BaseModal>
    </div>
  );
}

function getKarmaChartData(records: KarmaRecord[]) {
  if (!records || records.length === 0) return [];

  // Sort by date ascending, compute cumulative balance
  const sorted = [...records].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  let cumulative = 0;
  return sorted.map((r) => {
    cumulative += r.type === "MERIT" ? r.effective_weight : -r.effective_weight;
    return {
      date: r.event_date || r.recorded_at.slice(0, 10),
      merit: r.type === "MERIT" ? r.effective_weight : 0,
      demerit: r.type === "DEMERIT" ? r.effective_weight : 0,
      cumulative,
    };
  });
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
