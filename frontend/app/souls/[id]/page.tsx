"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import type { ToastType } from "@/src/components/ui/Toast";
import { LazySoulLineChart } from "@/src/components/charts/LazyDashboardCharts";
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
  LedgerSummary,
  LedgerRecord,
  SoulRecord,
} from "@/lib/api";
import { ledgerApi, type LedgerInheritance } from "@/lib/api/ledger";
import { useUpdateSoul, useDeleteSoul } from "@/src/hooks/useSouls";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { Skeleton, SkeletonCard } from "@/src/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

const STATE_COLORS: Record<string, string> = {
  ALIVE: "bg-[hsl(var(--color-status-alive)/0.2)] text-[hsl(var(--color-status-alive))]",
  JUDGING: "bg-[hsl(var(--color-status-judging)/0.2)] text-[hsl(var(--color-status-judging))]",
  DISPOSED: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  REINCARNATING: "bg-[hsl(var(--color-status-reincarnating)/0.2)] text-[hsl(var(--color-status-reincarnating))]",
  LOST: "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]",
  SETTLED: "bg-[hsl(var(--color-status-settled)/0.2)] text-[hsl(var(--color-status-settled))]",
};

export default function SoulDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { t, formatDate } = useI18n();
  const { showToast } = useToast();
  // messages/*.json is out of scope for this change (see task boundary) — new
  // copy ships as a code-level fallback until an i18n pass adds the real keys.
  // t() returns the key itself (a truthy string) when a key is missing, so
  // `t(key) || fallback` never falls through; compare against the key instead.
  const tf = useCallback(
    (key: string, fallback: string, params?: Record<string, string>) => {
      if (t(key) === key) {
        return params
          ? Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), fallback)
          : fallback;
      }
      return t(key, params);
    },
    [t]
  );
  const [soul, setSoul] = useState<Soul | null>(null);
  const [ledger, setLedger] = useState<LedgerSummary | null>(null);
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

  // The three cosmologies do not share a mechanic, so this card cannot share a
  // name: CHINESE nets merit against demerit in a standing account, EGYPTIAN
  // weighs the heart once against a threshold, EUROPEAN judges then absolves.
  // `civilization` is UNKNOWN for a misconfigured tenant and undefined until
  // the soul loads; both land on the neutral label.
  const ledgerLabel = tf(`ledger.civ.${soul?.civilization}`, t("ledger.civ.UNKNOWN"));

  // 409 REBIRTH_NOT_APPLICABLE means this soul's cosmology is terminal
  // (Egyptian judgment ending at Aaru/Ammit, European ending at
  // Heaven/Hell/Purgatory-then-Heaven) — there is no next life, so that's
  // treated as a normal "no data" result (null) rather than a query error.
  // That keeps it out of retry and error-toast paths entirely.
  const inheritanceQuery = useQuery({
    queryKey: ["souls", "inheritance", id],
    queryFn: async (): Promise<LedgerInheritance | null> => {
      try {
        const res = await ledgerApi.inheritance(id);
        return res.data;
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
        if (err?.response?.status === 409) {
          return null;
        }
        throw e;
      }
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  const loadSoulData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [soulRes, ledgerRes, recordsRes, judgmentRes, dispRes, reincRes, evtsRes] =
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
      setLedger(ledgerRes.data);
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

  async function handleStartJudgment() {
    if (!soul) return;
    setActionLoading("judge");
    try {
      // Soul.die() already opens a judgment when it moves the soul to JUDGING
      // (apps/souls/models.py), so creating one here unconditionally left every
      // soul with a duplicate pending judgment alongside the real one. Reuse
      // the open judgment if there is one.
      const open = judgments.find((j) => !j.is_final);
      const id = open
        ? open.id
        : (await judgmentApi.create({ soul: soul.id, civilization: soul.civilization })).data.id;
      router.push(`/judgment/${id}`);
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

  // Generation badge: cycle_count on a reincarnation record is "how many
  // times this soul has already been reborn" (0-indexed relative to the
  // original life), so the soul's current life number is the highest one
  // plus one. A soul that has never reincarnated has no reincarnation
  // records at all — showing "Life 1" on every never-reincarnated soul
  // (the overwhelming majority) would just be noise, so the badge is
  // omitted rather than defaulting to 1.
  const generation = reincarnations.length > 0
    ? Math.max(...reincarnations.map((r) => r.cycle_count)) + 1
    : null;

  // birth_date is the soul's original birth (the identity in birth_name),
  // not the current life's — a reincarnated soul has no recorded birth date
  // for its current identity. death_date is the most recent life's death
  // (null while alive), so a single trailing "—" reads as "ongoing" rather
  // than as a second empty placeholder.
  const birthDisplay = soul?.birth_date ? formatDate(soul.birth_date) : null;
  const deathDisplay = soul?.death_date ? formatDate(soul.death_date) : null;
  const dateRangeText = birthDisplay
    ? deathDisplay
      ? `${birthDisplay} — ${deathDisplay}`
      : `${birthDisplay} —`
    : null;

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      {/* Header - always render, show skeleton if loading */}
      <div className="border-b border-[hsl(var(--color-hairline))] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/souls" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">← {t("souls.detail.back_to_list")}</a>
          {loading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {/* Title line: current-life name is what the soul is called
                  today, so it stays the headline. State and generation are
                  both translated badges — no raw enum text next to them. */}
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[hsl(var(--color-accent))]">{soul?.name}</h1>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_COLORS[soul?.current_state || "ALIVE"]}`}>
                  {t(`souls.states.${soul?.current_state}`)}
                </span>
                {generation !== null && (
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-[hsl(var(--color-status-reincarnating)/0.2)] text-[hsl(var(--color-status-reincarnating))]">
                    {tf("souls.detail.generation", "Life {{n}}", { n: String(generation) })}
                  </span>
                )}
              </div>
              {/* Subtitle: civilization, the prior-life name this soul was
                  born under (only when it differs from the headline — same
                  name would just be noise), the birth/death span that
                  belongs to that same origin identity, and a copyable ID. */}
              <div className="flex items-center gap-2 text-xs text-[hsl(var(--color-ink-muted))] flex-wrap">
                <span>{t(`souls.civilizations.${soul?.civilization}`)}</span>
                {soul?.birth_name && soul.birth_name !== soul.name && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{tf("souls.detail.previous_identity", "Formerly {{name}}", { name: soul.birth_name })}</span>
                  </>
                )}
                {dateRangeText && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{dateRangeText}</span>
                  </>
                )}
                {soul?.id && (
                  <>
                    <span aria-hidden="true">·</span>
                    <IdChip id={soul.id} tf={tf} showToast={showToast} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!loading && soul && (
            <>
              <RequirePermission permissions="soul.update">
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="px-3 py-1.5 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] rounded-md text-sm transition-colors"
                >
                  {t("souls.detail.edit")}
                </button>
              </RequirePermission>
              <RequirePermission permissions="soul.delete">
                <button
                  onClick={handleDeleteConfirm}
                  className="px-3 py-1.5 bg-[hsl(var(--color-status-error)/0.2)] border border-[hsl(var(--color-status-error)/0.3)] hover:bg-[hsl(var(--color-status-error)/0.3)] text-[hsl(var(--color-status-error))] rounded-md text-sm transition-colors"
                >
                  {t("souls.detail.delete")}
                </button>
              </RequirePermission>
            </>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Soul info + ledger */}
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
                {/* Soul ID now lives in the header as a copyable chip —
                    a second, non-interactive, truncated copy here was
                    redundant and couldn't be pasted into anything. */}
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.civilization")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{t(`souls.civilizations.${soul?.civilization}`)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--color-ink-muted))] shrink-0">
                    {/* birth_date belongs to the soul's original identity
                        (birth_name), not necessarily the name in the header
                        above — label it explicitly whenever the two differ
                        so the date isn't misread as the current life's. */}
                    {soul?.birth_name && soul.birth_name !== soul.name
                      ? tf("souls.detail.birth_of", "Birth ({{name}})", { name: soul.birth_name })
                      : t("souls.detail.birth")}
                  </dt>
                  <dd className="text-[hsl(var(--color-ink))] text-right">{birthDisplay || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.death")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{deathDisplay || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[hsl(var(--color-ink-muted))]">{t("souls.detail.location_label")}</dt>
                  <dd className="text-[hsl(var(--color-ink))]">{soul?.origin_location || "—"}</dd>
                </div>
              </dl>
            )}
          </div>

          {/* Ledger Card */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{ledgerLabel}</h2>
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
            ) : ledger ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[hsl(var(--color-merit))]">{t("souls.detail.merit")}</span>
                  <span className="text-lg font-bold text-[hsl(var(--color-merit))]">+{ledger.merit_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[hsl(var(--color-demerit))]">{t("souls.detail.demerit")}</span>
                  <span className="text-lg font-bold text-[hsl(var(--color-demerit))]">-{ledger.demerit_score}</span>
                </div>
                <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
                  <span className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.balance")}</span>
                  <span className={`text-xl font-bold ${ledger.karmic_balance >= 0 ? "text-[hsl(var(--color-merit))]" : "text-[hsl(var(--color-demerit))]"}`}>
                    {ledger.karmic_balance >= 0 ? "+" : ""}{ledger.karmic_balance}
                  </span>
                </div>
                <div className="text-xs text-[hsl(var(--color-ink-subtle))] text-right">{ledger.record_count} {t("souls.detail.records")}</div>

                {/* Ledger Timeline Chart */}
                {ledger.records && ledger.records.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-[hsl(var(--color-ink-muted))] mb-2">{t("ledger.timeline")} ({t("ledger.time_decay")})</p>
                    <LazySoulLineChart data={getLedgerChartData(ledger.records)} />

                    {/* Reincarnation Inheritance Preview — sourced from
                        GET /ledger/inheritance/{soul_id}/, never recomputed
                        client-side. A 409 (terminal cosmology, no next life)
                        resolves the query to null, so this simply renders
                        nothing rather than an error or empty state. */}
                    {inheritanceQuery.data && <InheritancePanel data={inheritanceQuery.data} t={t} />}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[hsl(var(--color-ink-muted))]">{t("souls.detail.no_ledger")}</p>
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
                  <RequirePermission permissions="soul.die">
                    {/* Accent, not status-error. Recording a death is the
                        central verb of this product, not a failure — and the
                        error token is what genuinely destructive actions
                        (删除, below) use, so spending it here drains the
                        signal from both. */}
                    <button
                      onClick={handleDie}
                      disabled={!!actionLoading}
                      className="w-full py-2 px-4 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
                    >
                      {actionLoading === "die" ? t("souls.detail.processing") : t("souls.detail.mark_dead")}
                    </button>
                  </RequirePermission>
                )}
                {soul?.current_state === "JUDGING" && (
                  <div className="space-y-2">
                    <p className="text-xs text-[hsl(var(--color-ink-muted))] text-center">{t("souls.detail.render_judgment")}</p>
                    <RequirePermission permissions="judgment.create">
                      <button
                        onClick={handleStartJudgment}
                        disabled={!!actionLoading}
                        className="w-full py-2 px-4 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent)/0.8)] disabled:opacity-50 text-black text-sm font-medium rounded-md transition-colors"
                      >
                        {actionLoading === "judge" ? t("souls.detail.processing") : t("souls.detail.start_judgment")}
                      </button>
                    </RequirePermission>
                  </div>
                )}
                {soul?.current_state === "DISPOSED" && (
                  <RequirePermission permissions="reincarnation.reborn">
                    {dispositions.filter(d => !d.is_executed).map((disp) => (
                      <button
                        key={disp.id}
                        onClick={() => handleReincarnate(disp.id)}
                        disabled={!!actionLoading}
                        className="w-full py-2 px-4 bg-[hsl(var(--color-status-info))] hover:bg-[hsl(var(--color-status-info)/0.8)] disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
                      >
                        {actionLoading === "reincarnate" ? t("souls.detail.processing") : `${t("souls.detail.reincarnate")} ${disp.realm_name || disp.realm_code || t("souls.detail.destination")}`}
                      </button>
                    ))}
                  </RequirePermission>
                )}
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
                        {tf(`souls.detail.verdict_${j.verdict.toLowerCase()}`, j.verdict)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[hsl(var(--color-ink-muted))]">
                    {j.is_final ? t("souls.detail.final") : t("souls.detail.pending")}
                    {j.civilization ? ` · ${tf(`souls.civilizations.${j.civilization}`, j.civilization)}` : ""}
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
                        {/* realm_name/realm_code come from the serializer;
                            destination_realm is the raw FK, so leading with it
                            put a UUID where the destination should be. */}
                        → {d.realm_name || d.realm_code || t("souls.detail.destination")}
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

function getLedgerChartData(records: LedgerRecord[]) {
  if (!records || records.length === 0) return [];

  // Sort by when the deed happened, not when the row was written. Ordering by
  // recorded_at puts a life in data-entry order, which for an imported life is
  // arbitrary — and the labels below already use event_date, so the two
  // disagreed.
  const when = (r: { event_date?: string | null; recorded_at: string }) =>
    new Date(r.event_date || r.recorded_at).getTime();
  const sorted = [...records].sort((a, b) => when(a) - when(b));

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

// Balance is derived here, inside the branch where `data` is already known
// non-null (the caller only renders this when inheritanceQuery.data is
// truthy) — that lets TypeScript narrow it via the parameter type instead of
// through a nullable variable carried in from outside, which would need a
// `?? 0` that can never actually fire.
function InheritancePanel({ data, t }: { data: LedgerInheritance; t: (key: string) => string }) {
  const balance = data.inherited_merit - data.inherited_demerit;
  return (
    <div className="mt-3 pt-2 border-t border-[hsl(var(--color-hairline))]">
      <p className="text-xs text-[hsl(var(--color-ink-muted))] mb-1">{t("ledger.next_life_inheritance")}</p>
      <div className="flex justify-between text-xs">
        <span className="text-[hsl(var(--color-merit))]">{t("souls.detail.merit")}: +{data.inherited_merit}</span>
        <span className="text-[hsl(var(--color-demerit))]">{t("souls.detail.demerit")}: -{data.inherited_demerit}</span>
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span className="text-[hsl(var(--color-ink-subtle))]">{t("souls.detail.balance")}: </span>
        <span className={balance >= 0 ? "text-[hsl(var(--color-merit))]" : "text-[hsl(var(--color-demerit))]"}>
          {balance >= 0 ? "+" : ""}{balance}
        </span>
      </div>
      <p className="text-[10px] text-[hsl(var(--color-ink-subtle))] mt-1">{t("ledger.inheritance_note")}</p>
    </div>
  );
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

interface IdChipProps {
  id: string;
  tf: (key: string, fallback: string, params?: Record<string, string>) => string;
  showToast: (msg: string, type?: ToastType, dur?: number) => string;
}

// Truncated-and-unselectable IDs are useless to anyone who needs to paste one
// into a ticket. This renders the short form but copies the full UUID, with
// on-click feedback so it doesn't look like a no-op.
function IdChip({ id, tf, showToast }: IdChipProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      showToast(tf("souls.detail.id_copied", "ID copied to clipboard"), "success");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast(tf("souls.detail.id_copy_failed", "Copy failed"), "error");
    }
  }, [id, showToast, tf]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={id}
      aria-label={tf("souls.detail.copy_id_aria", "Copy soul ID")}
      className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
    >
      {copied ? tf("souls.detail.copied", "Copied ✓") : `${id.slice(0, 8)} ⧉`}
    </button>
  );
}
