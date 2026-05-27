"use client";

import { useCallback, useEffect, useState } from "react";
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
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { Skeleton, SkeletonCard } from "@/src/components/ui/skeleton";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-[hsl(var(--color-status-alive)/0.2)] text-[hsl(var(--color-status-alive))]",
  JUDGING: "bg-[hsl(var(--color-status-judging)/0.2)] text-[hsl(var(--color-status-judging))]",
  DISPOSED: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  REINCARNATING: "bg-[hsl(var(--color-status-reincarnating)/0.2)] text-[hsl(var(--color-status-reincarnating))]",
  LOST: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
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
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmCallback, setConfirmCallback] = useState<(() => void) | null>(null);

  const updateSoulMutation = useUpdateSoul();
  const deleteSoulMutation = useDeleteSoul();

  const loadSoulData = useCallback(async () => {
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
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err?.response?.data?.detail || err?.message || t("souls.detail.loading"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (!id) return;
    loadSoulData();
  }, [id, loadSoulData]);

  async function handleDie() {
    if (!soul) return;
    setConfirmMessage(t("souls.detail.mark_dead_confirm", { name: soul.name }));
    setConfirmCallback(() => async () => {
      setActionLoading("die");
      try {
        await soulsApi.die(soul.id, {});
        await loadSoulData();
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        showToast(err?.response?.data?.error || "Failed", "error");
      } finally {
        setActionLoading("");
      }
    });
    setIsConfirmOpen(true);
  }

  async function handleJudgment(verdict: string) {
    if (!soul) return;
    setActionLoading(`judge-${verdict}`);
    try {
      const jRes = await judgmentApi.create({ soul: soul.id, civilization: soul.civilization });
      await judgmentApi.conclude(jRes.data.id, { verdict, notes: `Auto-judged. Karma: ${karma?.karmic_balance}` });
      await loadSoulData();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showToast(err?.response?.data?.error || err?.message || "Failed", "error");
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
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showToast(err?.response?.data?.error || err?.message || "Failed", "error");
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

  // Error state - only show when we have actual data fetch error, not during initial load
  if (error && !soul) {
    return (
      <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))] flex flex-col items-center justify-center gap-4">
        <div className="text-[hsl(var(--color-status-error))]">{error || t("souls.detail.not_found")}</div>
        <a href="/souls/" className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent))]">{t("souls.detail.back_to_list")}</a>
      </div>
    );
  }

  const verdictOptions = [
    { key: "PASSED", color: "bg-[hsl(var(--color-verdict-passed))] hover:bg-[hsl(var(--color-verdict-passed)/0.8)]" },
    { key: "FAILED", color: "bg-[hsl(var(--color-verdict-failed))] hover:bg-[hsl(var(--color-verdict-failed)/0.8)]" },
    { key: "PURGATORY", color: "bg-[hsl(var(--color-verdict-purgatory))] hover:bg-[hsl(var(--color-verdict-purgatory)/0.8)]" },
  ];

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Header - always render, show skeleton if loading */}
      <div className="border-b border-[hsl(var(--color-hairline))] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/souls" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">← {t("souls.detail.back_to_list")}</a>
          {loading ? (
            <Skeleton className="h-6 w-32" />
          ) : (
            <>
              <h1 className="text-xl font-bold text-[hsl(var(--color-accent))]">{soul?.name}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul?.current_state || "ALIVE"]}`}>
                {soul?.current_state} — {t(`souls.states.${soul?.current_state}`) || soul?.current_state}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[hsl(var(--color-ink-muted))] text-sm">
            {loading ? <Skeleton className="h-4 w-40" /> : `${soul?.civilization} · ${soul?.birth_date || "?"} — ${soul?.death_date || "—"}`}
          </span>
          {!loading && soul && (
            <>
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] rounded-md text-sm transition-colors"
              >
                {t("souls.detail.edit")}
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-3 py-1.5 bg-[hsl(var(--color-status-error)/0.2)] border border-[hsl(var(--color-status-error)/0.3)] hover:bg-[hsl(var(--color-status-error)/0.3)] text-[hsl(var(--color-status-error))] rounded-md text-sm transition-colors"
              >
                {t("souls.detail.delete")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Soul info + Karma */}
        <div className="lg:col-span-1 space-y-6">
          {/* Soul Card */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{t("souls.detail.soul_info")}</h2>
            {loading ? (
              <div className="space-y-2 text-sm">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.id")}</dt>
                  <dd className="text-[hsl(var(--color-ink))] font-mono text-xs">{soul?.id?.slice(0, 8)}...</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.civilization")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{soul?.civilization}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.birth")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{soul?.birth_date || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.death")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{soul?.death_date || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.location_label")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{soul?.origin_location || "—"}</dd>
                </div>
              </dl>
            )}
          </div>

          {/* Karma Card */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{t("souls.karma")}</h2>
            {loading ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-6 w-12" />
                </div>
                <div className="flex justify-between items-center">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-6 w-12" />
                </div>
                <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-6 w-12" />
                </div>
                <Skeleton className="h-3 w-full" />
              </div>
            ) : karma ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[hsl(var(--color-karma-merit))]">{t("souls.detail.merit")}</span>
                  <span className="text-lg font-bold text-[hsl(var(--color-karma-merit))]">+{karma.merit_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.demerit")}</span>
                  <span className="text-lg font-bold text-[hsl(var(--color-karma-demerit))]">-{karma.demerit_score}</span>
                </div>
                <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
                  <span className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
                  <span className={`text-xl font-bold ${karma.karmic_balance >= 0 ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"}`}>
                    {karma.karmic_balance >= 0 ? "+" : ""}{karma.karmic_balance}
                  </span>
                </div>
                <div className="text-xs text-[hsl(var(--color-ink-subtle))] text-right">{karma.record_count} {t("souls.detail.records")}</div>

                {/* Karma Timeline Chart */}
                {karma.records && karma.records.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-[hsl(var(--color-ink-muted))] mb-2">{t("karma.timeline")} ({t("karma.time_decay")})</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={getKarmaChartData(karma.records)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--color-hairline))" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "hsl(var(--color-ink-muted))", fontSize: 9 }}
                          tickFormatter={(v) => v.slice(5, 10)}
                        />
                        <YAxis tick={{ fill: "hsl(var(--color-ink-muted))", fontSize: 9 }} width={30} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--color-surface-2))", border: "1px solid hsl(var(--color-hairline))", borderRadius: "6px", fontSize: 11 }}
                          labelStyle={{ color: "hsl(var(--color-ink-muted))" }}
                        />
                        <ReferenceLine x={0} stroke="hsl(var(--color-hairline))" />
                        <Line
                          type="monotone"
                          dataKey="cumulative"
                          stroke="hsl(var(--color-accent))"
                          strokeWidth={2}
                          dot={false}
                          name="Balance"
                        />
                      </LineChart>
                    </ResponsiveContainer>

                    {/* Reincarnation Inheritance Preview */}
                    {karma.karmic_balance !== 0 && (
                      <div className="mt-3 pt-2 border-t border-[hsl(var(--color-hairline))]">
                        <p className="text-xs text-[hsl(var(--color-ink-muted))] mb-1">{t("karma.next_life_inheritance")}</p>
                        <div className="flex justify-between text-xs">
                          <span className="text-[hsl(var(--color-karma-merit))]">{t("souls.detail.merit")}: +{Math.round(karma.merit_score * 0.2)}</span>
                          <span className="text-[hsl(var(--color-karma-demerit))]">{t("souls.detail.demerit")}: -{Math.round(karma.demerit_score * 0.2)}</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-[hsl(var(--color-ink-subtle))]">{t("souls.detail.balance")}: </span>
                          <span className={karma.karmic_balance >= 0 ? "text-[hsl(var(--color-karma-merit))]" : "text-[hsl(var(--color-karma-demerit))]"}>
                            {karma.karmic_balance >= 0 ? "+" : ""}{Math.round(karma.karmic_balance * 0.2)}
                          </span>
                        </div>
                        <p className="text-[10px] text-[hsl(var(--color-ink-subtle))] mt-1">{t("karma.inheritance_note")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.no_karma")}</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{t("souls.detail.actions")}</h2>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                {soul?.current_state === "ALIVE" && (
                  <button
                    onClick={handleDie}
                    disabled={!!actionLoading}
                    className="w-full py-2 px-4 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
                  >
                    {actionLoading === "die" ? t("souls.detail.processing") : t("souls.detail.mark_dead")}
                  </button>
                )}
                {soul?.current_state === "JUDGING" && (
                  <div className="space-y-2">
                    <p className="text-xs text-[hsl(var(--color-ink-muted))] text-center">{t("souls.detail.render_judgment")}</p>
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
                {soul?.current_state === "DISPOSED" && dispositions.filter(d => !d.is_executed).map((disp) => (
                  <button
                    key={disp.id}
                    onClick={() => handleReincarnate(disp.id)}
                    disabled={!!actionLoading}
                    className="w-full py-2 px-4 bg-[hsl(var(--color-status-info))] hover:bg-[hsl(var(--color-status-info)/0.8)] disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
                  >
                    {actionLoading === "reincarnate" ? t("souls.detail.processing") : `${t("souls.detail.reincarnate")} ${disp.destination_realm || t("souls.detail.destination")}`}
                  </button>
                ))}
                {soul?.current_state === "REINCARNATING" && (
                  <div className="text-center text-[hsl(var(--color-status-info))] text-sm py-2">
                    {t("souls.detail.being_reborn")}
                  </div>
                )}
                {soul?.current_state === "ALIVE" && reincarnations.length > 0 && (
                  <div className="text-center text-[hsl(var(--color-ink-subtle))] text-xs pt-2">
                    {reincarnations.length} {t("souls.detail.previous_reincarnations")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Judgment Records */}
          <Section title={t("souls.detail.judgments")} count={loading ? 0 : judgments.length}>
            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : judgments.length === 0 ? (
              <EmptyState>{t("souls.detail.no_judgments")}</EmptyState>
            ) : (
              judgments.map((j) => (
                <div key={j.id} className="bg-[hsl(var(--color-surface-2))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-sm font-medium text-[hsl(var(--color-ink))]">{j.court || t("souls.detail.court")}</div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))]">{j.created_at?.slice(0, 19).replace("T", " ")}</div>
                    </div>
                    {j.verdict && (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        j.verdict === "PASSED" ? "bg-[hsl(var(--color-verdict-passed)/0.2)] text-[hsl(var(--color-verdict-passed))]" :
                        j.verdict === "FAILED" ? "bg-[hsl(var(--color-verdict-failed)/0.2)] text-[hsl(var(--color-verdict-failed))]" :
                        "bg-[hsl(var(--color-verdict-purgatory)/0.2)] text-[hsl(var(--color-verdict-purgatory))]"
                      }`}>
                        {t(`souls.detail.verdict_${j.verdict.toLowerCase()}`) || j.verdict}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[hsl(var(--color-ink-muted))]">
                    {j.is_final ? t("souls.detail.final") : t("souls.detail.pending")} · {j.civilization}
                  </div>
                </div>
              ))
            )}
          </Section>

          {/* Disposition Records */}
          <Section title={t("souls.detail.dispositions")} count={loading ? 0 : dispositions.length}>
            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : dispositions.length === 0 ? (
              <EmptyState>{t("souls.detail.no_dispositions")}</EmptyState>
            ) : (
              dispositions.map((d) => (
                <div key={d.id} className="bg-[hsl(var(--color-surface-2))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-[hsl(var(--color-ink))]">
                        → {d.destination_realm || t("souls.detail.destination")}
                      </div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                        {t("souls.detail.memory_reset")}: {d.memory_reset} · {d.is_eternal ? t("souls.detail.eternal") : `${d.memory_reset} ${t("souls.detail.memory_reset")}`}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      d.is_executed ? "bg-[hsl(var(--color-status-info)/0.2)] text-[hsl(var(--color-status-info))]" : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"
                    }`}>
                      {d.is_executed ? t("souls.detail.executed") : t("souls.detail.pending")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Section>

          {/* Reincarnation Records */}
          <Section title={t("souls.detail.reincarnations")} count={loading ? 0 : reincarnations.length}>
            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : reincarnations.length === 0 ? (
              <EmptyState>{t("souls.detail.no_reincarnations")}</EmptyState>
            ) : (
              reincarnations.map((r) => (
                <div key={r.id} className="bg-[hsl(var(--color-surface-2))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-[hsl(var(--color-ink))]">
                        → {r.new_identity} ({r.rebirth_form})
                      </div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                        {t("souls.detail.cycle")} {r.cycle_count} · {r.target_realm}
                      </div>
                    </div>
                    <span className="text-xs text-[hsl(var(--color-ink-subtle))]">
                      {r.reincarnated_at?.slice(0, 19).replace("T", " ")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Section>

          {/* Event Log */}
          <Section title={t("souls.detail.event_log")} count={loading ? 0 : events.length}>
            {loading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : events.length === 0 ? (
              <EmptyState>{t("souls.detail.no_events")}</EmptyState>
            ) : (
              events.map((e) => (
                <div key={e.id} className="bg-[hsl(var(--color-surface-2))] rounded-lg p-3 border border-[hsl(var(--color-hairline))] text-xs">
                  <div className="flex justify-between">
                    <span className="text-[hsl(var(--color-ink))] font-mono">{e.event_type}</span>
                    <span className="text-[hsl(var(--color-ink-subtle))]">{e.create_time?.slice(0, 19).replace("T", " ")}</span>
                  </div>
                  {e.actor && e.actor !== "system" && (
                    <div className="text-[hsl(var(--color-ink-subtle))] mt-0.5">Actor: {e.actor}</div>
                  )}
                </div>
              ))
            )}
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
              className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 rounded text-sm transition-colors"
            >
              {t("souls.detail.cancel_delete")}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteSoulMutation.isPending}
              className="flex-1 px-4 py-2 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
            >
              {deleteSoulMutation.isPending ? t("souls.detail.deleting") : t("souls.detail.confirm_delete_action")}
            </button>
          </div>
        }
      >
        <p className="text-[hsl(var(--color-ink))] text-sm">{t("souls.detail.delete_confirm_message")}</p>
      </BaseModal>

      {/* Custom Confirm Dialog */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={t("common.confirm")}
        message={confirmMessage}
        onConfirm={() => {
          setIsConfirmOpen(false);
          confirmCallback?.();
        }}
        onCancel={() => setIsConfirmOpen(false)}
        variant="warning"
      />
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
    <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase">{title}</h2>
        <span className="bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink))] text-xs px-1.5 py-0.5 rounded">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <div className="text-[hsl(var(--color-ink-subtle))] text-sm text-center py-4">{children}</div>;
}
