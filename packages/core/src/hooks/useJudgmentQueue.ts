"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, type JudgmentQueueCursor } from "../api/index";
import { judgmentKeys } from "../query_keys";
import {
  clearPendingVerdict,
  getPendingVerdict,
  notify,
  onSessionResume,
  onSessionSuspend,
  setPendingVerdict,
} from "../platform/index";

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
 *  - The verdict is not durable for up to UNDO_WINDOW_MS. `flush()` runs on
 *    unmount and on a **terminal** suspend (web: `beforeunload`) to shrink that
 *    window to the smallest honest size, but it cannot be zero, and the UI says
 *    the verdict is "pending" rather than showing it as done.
 *  - Only one verdict is ever in flight. Giving a second one flushes the
 *    first — the undo bar is never a stack, so "undo" can only ever mean the
 *    one thing on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE HELD VERDICT IS WRITTEN TO DISK, AND IS NEVER REPLAYED.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A held verdict is copied to the platform's `persistent` store the moment it
 * is given, so that a process which dies without a terminal suspend — an OS
 * killing a backgrounded app, a tab discarded, a crash — does not take a
 * decision the operator made with it. That copy is the reason a *transient*
 * suspend (React Native's `AppState → background`, which fires on every app
 * switch) can now do nothing at all instead of committing early: the verdict is
 * safe on disk, the undo window is still open, and the undo bar on screen still
 * means what it says.
 *
 * WHAT MUST NEVER HAPPEN, and what the rules below exist for: a stale verdict
 * committed silently on a later launch. Replaying a judicial decision after a
 * crash or an upgrade is worse than losing it — a lost verdict leaves the case
 * pending and hands it back to the operator, while a replayed one creates a
 * disposition that only an ADMIN correction can unwind. So:
 *
 *  - **A persisted verdict is never sent on the strength of the record alone.**
 *    On mount the record is read, and it is either *restored* — put back on
 *    screen as a held verdict with the undo bar and whatever is genuinely left
 *    of its window — or discarded. There is no path from storage to a POST that
 *    does not go through the operator's undo window running out in front of
 *    them.
 *  - **The window is wall-clock.** `dueAt` is a `Date.now()` stamp; a monotonic
 *    timer does not survive a suspend, let alone a launch. `dueAt - Date.now()`
 *    is therefore what decides, and it is treated as untrustworthy in both
 *    directions: `<= 0` means the window is gone, and `> UNDO_WINDOW_MS` means
 *    the clock moved backwards (NTP, a manual change, a device with no RTC
 *    booting at the epoch) and the record cannot be reasoned about at all.
 *    Both discard.
 *  - **A record is restored at most once.** It is removed from storage as it is
 *    read, before anything is decided, and a restored verdict is not written
 *    back. Two processes reading the same record — two tabs, a relaunch loop —
 *    would otherwise both commit it.
 *  - **Every terminating path clears it**: commit (at the moment the request is
 *    made, not when it returns — a record that outlives an in-flight POST is a
 *    replay waiting for the next launch), undo, and restore.
 *
 * The discard is reported rather than silent (`judgment.queue.commit_error`,
 * whose words — the verdict did not land, the case is back in the queue — are
 * exactly true here). Silence would be the failure this whole file is written
 * against: an operator who ruled on a case, saw it leave the screen, and is
 * never told that nothing was recorded.
 */

/** How long the operator has to take a verdict back. */
export const UNDO_WINDOW_MS = 8000;

/**
 * The four verdicts, as a value and not only as a type.
 *
 * A held verdict comes back off disk as `unknown` — written by a previous
 * process, possibly by a previous version of this app — so `verdict` has to be
 * checked at run time, and a type alias cannot do that. Derived from this array
 * rather than declared beside it, so the two cannot disagree.
 */
export const VERDICT_CODES = ["PASSED", "FAILED", "PURGATORY", "RETRY"] as const;

export type VerdictCode = (typeof VERDICT_CODES)[number];

/**
 * A verdict given and not yet sent — on screen, and on disk.
 *
 * `judgmentId` rather than the whole `Judgment`, and the change is not
 * cosmetic: this object is serialised to the platform's persistent store, and a
 * `Judgment` carries `confession` and `evidence_json` — the case file. Nothing
 * ever read the object except for its id (the console renders `soulName` and
 * `verdict`, which are here), so keeping it would have written a soul's
 * confession to disk for eight seconds to serve a field nobody read.
 */
export interface PendingVerdict {
  judgmentId: string;
  soulName: string;
  verdict: VerdictCode;
  notes: string;
  createWorkflow: boolean;
  /**
   * Wall-clock ms at which this will be sent, for the countdown — and, after a
   * suspend or a relaunch, for deciding whether it may still be sent at all.
   * `Date.now()`, deliberately: `setTimeout` measures an interval this process
   * spends awake, which is the wrong quantity the moment the process sleeps.
   */
  dueAt: number;
}

/**
 * A stored record, if it is one we are willing to act on. Otherwise null.
 *
 * Field by field, because "we wrote it" is not a property of anything read back
 * from a store that survives restarts: the writer may have been last month's
 * build with a different shape, and on web `localStorage` is editable by hand.
 * A `JSON.parse` cast would make every one of those a crash or, worse, a POST
 * built out of `undefined`.
 *
 * The window is NOT checked here — this answers "is this a verdict", and the
 * caller answers "may it still be acted on", which needs the clock and has two
 * different answers (restore, discard) rather than one.
 */
export function parsePersistedVerdict(raw: string | null): PendingVerdict | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { judgmentId, soulName, verdict, notes, createWorkflow, dueAt } = record;
  if (typeof judgmentId !== "string" || judgmentId === "") return null;
  if (typeof soulName !== "string") return null;
  if (typeof notes !== "string") return null;
  if (typeof createWorkflow !== "boolean") return null;
  if (typeof dueAt !== "number" || !Number.isFinite(dueAt)) return null;
  if (!VERDICT_CODES.includes(verdict as VerdictCode)) return null;
  return {
    judgmentId,
    soulName,
    verdict: verdict as VerdictCode,
    notes,
    createWorkflow,
    dueAt,
  };
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
        await judgmentApi.conclude(verdictToSend.judgmentId, {
          verdict: verdictToSend.verdict,
          notes: verdictToSend.notes,
          create_workflow: verdictToSend.createWorkflow,
        });
        setDecided((prev) =>
          prev.includes(verdictToSend.judgmentId) ? prev : [...prev, verdictToSend.judgmentId]
        );
        // It is no longer pending server-side, so it no longer needs holding
        // back — leaving it in `skip` would keep growing a list that filters
        // nothing.
        setHolding((prev) => prev.filter((id) => id !== verdictToSend.judgmentId));
        qc.invalidateQueries({ queryKey: judgmentKeys.all });
      } catch {
        // The verdict did not land. Put the case back in the queue rather than
        // silently dropping it — it is still pending, and the operator must
        // see it again.
        //
        // The persisted copy is NOT restored here, and that is the deliberate
        // half of this branch. A request that threw may still have been served
        // — a response lost on the way back looks exactly like a request that
        // never arrived — so putting the record back would make "retry" mean
        // "possibly conclude the same judgment twice". The case is pending or
        // it is not; the operator is told, and the queue's next fetch is what
        // says which. (The server refuses the second conclude with a 400
        // "Judgment already concluded", so the duplicate is contained even if
        // it is attempted. Containment is not a reason to attempt it.)
        setHolding((prev) => prev.filter((id) => id !== verdictToSend.judgmentId));
        notify("judgment.queue.commit_error", "error");
      }
    },
    [qc]
  );

  /**
   * Hold `held` and send it in `ms`, replacing any timer already running.
   *
   * `ms` is a parameter rather than `UNDO_WINDOW_MS` because a restored verdict
   * gets what is *left* of its window, not a fresh one. A fresh one would be a
   * second undo window for a decision already made — and, worse, would let a
   * record whose window had nearly elapsed come back as good as new after every
   * suspend.
   */
  const arm = useCallback(
    (held: PendingVerdict, ms: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const current = pendingRef.current;
        if (!current || current.judgmentId !== held.judgmentId) return;
        pendingRef.current = null;
        setPending(null);
        clearPendingVerdict();
        void send(current);
      }, ms);
    },
    [clearTimer, send]
  );

  /**
   * Commit whatever is held, immediately. Unmount, leaving the console, a
   * second verdict — and a **terminal** suspend, which is now the only kind
   * that reaches it.
   *
   * IDEMPOTENT, AND STILL NOT DEFERRABLE. Two different properties, and only
   * the first one holds here. Calling this twice sends once: the second call
   * finds `pendingRef.current` already null and returns before `send`. Repeated
   * suspends therefore cannot duplicate a verdict, and the test that pins this
   * fires both events inside one `act` — separate ones let a re-render clear
   * the ref, so the assertion would be measuring React rather than this guard.
   *
   * What it still is not is deferrable: every call commits immediately, however
   * much of the undo window is left. That is correct on `beforeunload`, where
   * the alternative is losing the verdict, and it is wrong on a suspend that is
   * not terminal — which is why `kind` exists and why the subscription below
   * calls this only for `"terminal"`. The RN defect recorded here in `c8863fb`
   * ("sends the held verdict on the first app switch, and undo then silently
   * does nothing") is fixed by that line and by the persisted copy, not by any
   * change to this function.
   *
   * The stored copy goes at the moment the request is *made*, not when it
   * returns. A record that outlives an in-flight POST is a verdict the next
   * launch could send a second time; a record dropped alongside a POST that
   * then fails is a case left pending, which the queue hands straight back.
   */
  const flush = useCallback(() => {
    clearTimer();
    const held = pendingRef.current;
    if (!held) return;
    pendingRef.current = null;
    setPending(null);
    clearPendingVerdict();
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
        judgmentId: judgment.id,
        soulName: judgment.soul_name || judgment.soul,
        verdict: input.verdict,
        notes: input.notes ?? "",
        createWorkflow: input.createWorkflow ?? false,
        dueAt: Date.now() + UNDO_WINDOW_MS,
      };
      pendingRef.current = next;
      setPending(next);
      setHolding((prev) => (prev.includes(judgment.id) ? prev : [...prev, judgment.id]));
      // On disk before the timer starts, not on suspend. A process can end
      // without any suspend event at all — an OS reclaiming a backgrounded app,
      // a tab discarded under memory pressure, a crash — and the window between
      // "the operator decided" and "we were told we are dying" is where a
      // decision would be lost.
      setPendingVerdict(JSON.stringify(next));
      arm(next, UNDO_WINDOW_MS);
    },
    [cursor.judgment, flush, arm]
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
    // A taken-back verdict must not outlive the taking-back. Left on disk it
    // would be the one thing this design refuses: a decision the operator
    // withdrew, sent by the next launch.
    clearPendingVerdict();
    setHolding((prev) => prev.filter((id) => id !== held.judgmentId));
    notify("judgment.queue.undo_done", "info");
  }, [clearTimer]);

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

  /**
   * Re-check a held verdict against the wall clock after a suspend.
   *
   * React Native freezes JS timers while the app is backgrounded, so the
   * `setTimeout` armed before the switch is late by however long the user was
   * away, and the countdown the console renders from `dueAt` is wrong by the
   * same amount. `Date.now()` is the only thing that kept running.
   *
   * A window that expired while the app was away is committed here rather than
   * discarded, and that is not the launch case wearing a disguise: this process
   * never stopped existing, the operator's eight seconds genuinely elapsed, and
   * this is what the timer would have done had it not been frozen. The record
   * being *in memory* is what makes it trustworthy — nothing was reconstructed
   * from a store somebody else could have written.
   *
   * A remaining window larger than the whole window means the clock moved
   * backwards under us. In memory that is not a replay hazard (the operator is
   * right here, looking at the undo bar), so it is clamped rather than
   * discarded — the opposite of what the restore path does with the same
   * reading, for the opposite reason.
   */
  const resync = useCallback(() => {
    const held = pendingRef.current;
    if (!held) return;
    const remaining = held.dueAt - Date.now();
    if (remaining <= 0) {
      flush();
      return;
    }
    arm(held, Math.min(remaining, UNDO_WINDOW_MS));
  }, [arm, flush]);

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
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  useEffect(() => {
    // Through the platform port, not `window.addEventListener("beforeunload")`.
    // What this effect states is a rule about verdicts — commit on the way out
    // — and `beforeunload` is one platform's spelling of "on the way out". The
    // spelling lives in `lib/platform/web.ts`; React Native's is `AppState`
    // reaching `background`.
    //
    // `"terminal"` ONLY. This one condition is the whole of the RN fix. A
    // transient suspend does nothing here on purpose: the verdict was written
    // to disk when it was given, the undo window is still open, and the undo
    // bar on screen still means what it says. Deleting the condition sends the
    // verdict on the first app switch — which is precisely the shipped defect
    // `c8863fb` documented and declined to fix.
    const stopSuspend = onSessionSuspend((kind) => {
      if (kind === "terminal") flushRef.current();
    });
    const stopResume = onSessionResume(() => resyncRef.current());
    return () => {
      stopSuspend();
      stopResume();
      flushRef.current();
    };
  }, []);

  /**
   * Adopt or discard a verdict left behind by a process that did not come back.
   *
   * Runs once, on mount, and is the only path from the store into this hook.
   * The rules it enforces are stated in the header; what is worth having here
   * is the order, because each step depends on the one before it:
   *
   *  1. Read, then **remove immediately** — before parsing, before any
   *     decision. A record is restored at most once, and the removal must not
   *     be conditional on the branch taken, or a record we refused stays behind
   *     to be refused again on every launch.
   *  2. Parse defensively. Unreadable, or written by a shape this build does
   *     not recognise, is dropped without a word: there is nothing truthful to
   *     tell the operator about bytes we cannot read.
   *  3. Only then consult the clock. `remaining <= 0` is the ordinary case — an
   *     app relaunched minutes or days later — and `remaining > UNDO_WINDOW_MS`
   *     is a clock that moved backwards. Both discard, and both say so.
   *  4. What is left is a window that genuinely has time in it, which can only
   *     mean this process started within eight seconds of the last one dying.
   *     That verdict goes back on screen with the time it actually has left,
   *     under the operator's eye and their undo key. It is not re-persisted;
   *     see the header.
   */
  const armRef = useRef(arm);
  armRef.current = arm;
  useEffect(() => {
    const raw = getPendingVerdict();
    if (raw === null) return;
    clearPendingVerdict();
    const held = parsePersistedVerdict(raw);
    if (held === null) return;
    const remaining = held.dueAt - Date.now();
    if (remaining <= 0 || remaining > UNDO_WINDOW_MS) {
      notify("judgment.queue.commit_error", "error");
      return;
    }
    pendingRef.current = held;
    setPending(held);
    setHolding((prev) => (prev.includes(held.judgmentId) ? prev : [...prev, held.judgmentId]));
    armRef.current(held, remaining);
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
