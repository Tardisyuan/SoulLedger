"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, type Judgment, type JudgmentQueueCursor } from "@soulledger/core/api";
import { judgmentKeys } from "@/lib/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";

/**
 * The judgment triage queue's session state (BRIEF §4.2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Undo is a DEFERRED SEND, not an amendment. Read this before changing it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * §4.2 asks for "undo a verdict they just gave". There is exactly one moment
 * at which a verdict can be withdrawn without touching the audit chain: before
 * it has been sent. `POST /judgment/{id}/conclude/` is not a field write — it
 * runs JudgmentConclusionService.conclude_judgment
 * (backend/apps/judgment/services.py), which inside one transaction sets the
 * verdict, CREATES THE DISPOSITION, optionally opens an approval workflow,
 * transitions the soul JUDGING -> DISPOSED, and logs a domain event. There is
 * no branch in which conclude runs and no disposition appears.
 *
 * So "undo while no disposition has been triggered" is not a state we can look
 * up after the fact — it is only ever true *before* the request. This hook
 * therefore holds the verdict client-side for UNDO_WINDOW_MS, advances the
 * operator to the next case immediately, and sends the POST when the window
 * closes. Undo cancels a timer; it does not call any endpoint, because there
 * is nothing to call it about.
 *
 * The alternative — send immediately, then offer a "revert" that unwinds the
 * disposition — would be a second amendment path into a judicial record. The
 * codebase already decided how amendment works, once, and deliberately: an
 * ADMIN-only, reason-required, separately audited correction
 * (Soul.correct_settlement / SoulViewSet.correct_settlement, gated on
 * `soul.correct_settlement`). Anything that has been sent goes through that,
 * not through this hook. `commitState` below is what the UI reads to decide
 * which of the two it is allowed to offer.
 *
 * Consequences worth stating plainly:
 *  - The verdict is not durable for up to UNDO_WINDOW_MS. A closed tab loses
 *    it. `flush()` runs on unmount and on `beforeunload` to shrink that window
 *    to the smallest honest size, but it cannot be zero, and the UI says the
 *    verdict is "pending" rather than showing it as done.
 *  - Only one verdict is ever in flight. Giving a second one flushes the
 *    first — the undo bar is never a stack, so "undo" can only ever mean the
 *    one thing on screen.
 */

/** How long the operator has to take a verdict back. */
export const UNDO_WINDOW_MS = 8000;

export type VerdictCode = "PASSED" | "FAILED" | "PURGATORY" | "RETRY";

export interface PendingVerdict {
  judgment: Judgment;
  soulName: string;
  verdict: VerdictCode;
  notes: string;
  createWorkflow: boolean;
  /** Wall-clock ms at which this will be sent, for the countdown. */
  dueAt: number;
}

export interface QueueProgress {
  /** 1-based ordinal of the card on screen within this sitting. */
  position: number;
  /** Denominator: pending count latched when the session opened. */
  total: number;
  /** Verdicts committed or awaiting commit this session. */
  decided: number;
  /** Items deferred this session. */
  deferred: number;
  /** Live server count of what is still pending and unskipped. */
  remaining: number;
}

const EMPTY_CURSOR: JudgmentQueueCursor = {
  total: 0,
  remaining: 0,
  skipped: 0,
  position: null,
  judgment: null,
  soul: null,
  ledger: null,
  prior_cycles: [],
  realm_options: [],
};

export function useJudgmentQueue(options?: { at?: string }) {
  const at = options?.at;
  const qc = useQueryClient();
  const { t } = useI18n();
  const { showToast } = useToast();

  /** Deliberately deferred by the operator. Session-only; never sent as state. */
  const [deferred, setDeferred] = useState<string[]>([]);
  /**
   * Held back because a verdict for them is waiting out its undo window. They
   * are still pending server-side, so without this the very next fetch would
   * hand the operator the case they just ruled on.
   */
  const [holding, setHolding] = useState<string[]>([]);
  const [decided, setDecided] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingVerdict | null>(null);
  const [sessionTotal, setSessionTotal] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The timer callback and the unmount flush both need the current pending
  // verdict without re-creating the timer every render.
  const pendingRef = useRef<PendingVerdict | null>(null);
  pendingRef.current = pending;

  const skip = useMemo(() => [...deferred, ...holding], [deferred, holding]);

  const query = useQuery({
    queryKey: judgmentKeys.queue(skip, at),
    queryFn: async () => {
      const res = await judgmentApi.next({ skip, at });
      return res.data;
    },
    // The queue is a live worklist; a stale card is a wasted decision.
    staleTime: 0,
    // Keep the previous card rendered while the next one loads, so advancing
    // does not flash an empty console.
    placeholderData: (previous) => previous,
  });

  const cursor = query.data ?? EMPTY_CURSOR;

  // Latch the denominator once. Reading it live would make "共 M 条" tick down
  // as the operator works, so the fraction would never reach the end.
  useEffect(() => {
    if (sessionTotal === null && query.isSuccess) setSessionTotal(cursor.total);
  }, [sessionTotal, query.isSuccess, cursor.total]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Send a held verdict now. Safe to call when nothing is held. */
  const send = useCallback(
    async (verdictToSend: PendingVerdict) => {
      try {
        await judgmentApi.conclude(verdictToSend.judgment.id, {
          verdict: verdictToSend.verdict,
          notes: verdictToSend.notes,
          create_workflow: verdictToSend.createWorkflow,
        });
        setDecided((prev) =>
          prev.includes(verdictToSend.judgment.id) ? prev : [...prev, verdictToSend.judgment.id]
        );
        // It is no longer pending server-side, so it no longer needs holding
        // back — leaving it in `skip` would keep growing a list that filters
        // nothing.
        setHolding((prev) => prev.filter((id) => id !== verdictToSend.judgment.id));
        qc.invalidateQueries({ queryKey: judgmentKeys.all });
      } catch {
        // The verdict did not land. Put the case back in the queue rather than
        // silently dropping it — it is still pending, and the operator must
        // see it again.
        setHolding((prev) => prev.filter((id) => id !== verdictToSend.judgment.id));
        showToast(t("judgment.queue.commit_error"), "error");
      }
    },
    [qc, showToast, t]
  );

  /** Commit whatever is held, immediately. Called on unmount and on unload. */
  const flush = useCallback(() => {
    clearTimer();
    const held = pendingRef.current;
    if (!held) return;
    pendingRef.current = null;
    setPending(null);
    void send(held);
  }, [clearTimer, send]);

  const submitVerdict = useCallback(
    (input: { verdict: VerdictCode; notes?: string; createWorkflow?: boolean }) => {
      const judgment = cursor.judgment;
      if (!judgment) return;
      // One at a time — see the header note. The previous verdict's undo
      // window ends the moment a new decision is made.
      flush();
      const next: PendingVerdict = {
        judgment,
        soulName: judgment.soul_name || judgment.soul,
        verdict: input.verdict,
        notes: input.notes ?? "",
        createWorkflow: input.createWorkflow ?? false,
        dueAt: Date.now() + UNDO_WINDOW_MS,
      };
      pendingRef.current = next;
      setPending(next);
      setHolding((prev) => (prev.includes(judgment.id) ? prev : [...prev, judgment.id]));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const held = pendingRef.current;
        if (!held || held.judgment.id !== next.judgment.id) return;
        pendingRef.current = null;
        setPending(null);
        void send(held);
      }, UNDO_WINDOW_MS);
    },
    [cursor.judgment, flush, send]
  );

  /**
   * Take the held verdict back. Nothing was sent, so nothing is unwound: the
   * case leaves `holding` and the queue hands it straight back.
   */
  const undo = useCallback(() => {
    clearTimer();
    const held = pendingRef.current;
    if (!held) return;
    pendingRef.current = null;
    setPending(null);
    setHolding((prev) => prev.filter((id) => id !== held.judgment.id));
    showToast(t("judgment.queue.undo_done"), "info");
  }, [clearTimer, showToast, t]);

  /**
   * Defer: hide for this sitting only. No request, no state change on the
   * record — §4.2's "skip or defer" must not be a data edit.
   */
  const defer = useCallback(() => {
    const judgment = cursor.judgment;
    if (!judgment) return;
    setDeferred((prev) => (prev.includes(judgment.id) ? prev : [...prev, judgment.id]));
  }, [cursor.judgment]);

  /** Put every deferred case back at the head of the queue. */
  const restoreDeferred = useCallback(() => setDeferred([]), []);

  // Commit on the way out. A verdict the operator gave and then navigated away
  // from is a decision they made; losing it would be worse than sending it.
  //
  // Mounted once, and it has to be: this effect's cleanup IS the commit, so an
  // effect that re-ran whenever `flush` was re-created would send the held
  // verdict early — mid-undo-window, on an unrelated re-render. Reached
  // through a ref rather than listed as a dependency, which is also why
  // exhaustive-deps has nothing to say about it.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onUnload = () => flushRef.current();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flushRef.current();
    };
  }, []);

  const total = sessionTotal ?? cursor.total;
  // A verdict counts as progress the moment it is given, not when it is sent —
  // the operator has moved on, and a counter that waited out the undo window
  // would sit on "1 of 2" while case 2 is on screen. `holding` carries the
  // ids inside their undo window and `decided` the ones already sent; the
  // union covers both and closes the one-render gap between them, during
  // which an id belongs to neither list.
  const processed = deferred.length + new Set([...decided, ...holding]).size;
  const progress: QueueProgress = {
    position: cursor.judgment ? Math.min(processed + 1, Math.max(total, 1)) : processed,
    total,
    decided: decided.length,
    deferred: deferred.length,
    remaining: cursor.remaining,
  };

  return {
    cursor,
    progress,
    pending,
    /** True once the queue has nothing left to hand out. */
    isExhausted: query.isSuccess && cursor.judgment === null && pending === null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    submitVerdict,
    undo,
    flush,
    defer,
    restoreDeferred,
    deferredCount: deferred.length,
  };
}
