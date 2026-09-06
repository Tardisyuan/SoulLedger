"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, type JudgmentQueueCursor } from "../api/index";
import { judgmentKeys } from "../query_keys";
import {
  clearPendingVerdict,
  clearVerdictLease,
  deliverOnExit,
  getPendingVerdict,
  getVerdictLease,
  markVerdictLease,
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
 *    read — before it is parsed, before anything is decided — and a restored
 *    verdict is not written back. Two processes reading the same record — two
 *    tabs, a relaunch loop — would otherwise both commit it.
 *  - **Every terminating path clears it**: commit (at the moment the request is
 *    made, not when it returns — a record that outlives an in-flight POST is a
 *    replay waiting for the next launch), undo, and restore.
 *
 * EGY: `stale_discarded` is transliterated, `skew_discarded` is not. Measured
 * 2026-09-04: of the 64 `judgment.queue.*` keys, egy renders 62 in the
 * bundle's pseudo-Egyptian; the two English ones are `key_notes` and
 * `skew_discarded`. So English here is a visible gap in this block, not the
 * file's convention — the whole-file average (63 of 1328 identical to `en`)
 * would have said the opposite, and that average is the wrong subject list.
 *
 * `stale_discarded` is built entirely from attested words — `sheemtet`
 * verdict, `tepy` earlier, `nen hab` not sent, `sep aq er set khery` case
 * back into the queue — every one lifted from `commit_error` and
 * `common.prev`, so nothing was invented.
 *
 * `skew_discarded` stays English deliberately: the bundle has no Egyptian
 * rendering of "clock" anywhere in its 1328 keys (the only occurrence of the
 * word is the English sentence itself, i.e. this gap), so writing one would
 * be inventing vocabulary rather than reusing it — the fabricated-citation
 * failure this repo already has a note about. It is a translation debt, and
 * naming it here is the point: it will not be found by reading egy.json,
 * where it looks like an ordinary entry.
 *
 * The discard is reported rather than silent — `judgment.queue.stale_discarded`
 * for a window that ran out, `judgment.queue.skew_discarded` for a clock that
 * cannot be reasoned about. Neither is `commit_error`, and the difference is
 * the point: that key says the verdict "did not land", which implies a request
 * was made, and on these two paths none was. Silence would be the failure this
 * whole file is written against — an operator who ruled on a case, saw it leave
 * the screen, and is never told that nothing was recorded — but a sentence that
 * describes a request nobody sent is the failure the rest of this repository is
 * written against.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE STORE IS SHARED, SO "IS THERE A RECORD" IS NOT "MAY I HAVE IT".
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `persistent` is per device, not per session: two browser tabs are two
 * sessions over one `localStorage`. So a record found on mount has two
 * completely different meanings, and the rules above only serve one of them:
 *
 *   a **dead** writer cannot send anything, and its verdict must be adopted if
 *   any of its window is left — this is the case the record exists for;
 *
 *   a **live** writer is still holding that verdict, still counting down, and
 *   still showing its operator an undo bar. Adopting it means two sessions
 *   commit the same judgment — the second is refused with a 400 "Judgment
 *   already concluded" (`backend/apps/judgment/views.py:429`), so no second
 *   disposition is created, but the operator is shown an error about something
 *   that did not go wrong — and it means the *second* tab shows an undo bar for
 *   a case its operator never ruled on, whose undo key stops nothing.
 *
 * The question is therefore not who wrote the record — a relaunch after a crash
 * is a different session than the one that wrote it, and refusing there would
 * break the only case this design exists for. It is **whether the writer is
 * still running**, which nothing about the record itself can answer.
 *
 * So the writer keeps a **lease** beside the record (`PENDING_VERDICT_LEASE_KEY`)
 * and re-stamps it every `LEASE_HEARTBEAT_MS` for as long as the record is on
 * disk. A session that finds a record it did not write reads that stamp:
 *
 *  - **Stamped within `LEASE_STALE_MS`** — the writer is running. Touch
 *    nothing: not the record, not the lease, no toast. This is the one path on
 *    which the record is deliberately *not* removed, because it is not ours to
 *    remove; the live writer will remove it itself on commit or undo.
 *  - **Older than that, or missing, or unreadable** — nothing is keeping it
 *    warm, so the writer is gone. Take the record by the rules above.
 *  - **Neither yet** — i.e. the stamp is fresh but might merely be recent. The
 *    session does not guess. It re-reads every `LEASE_POLL_MS` and decides when
 *    the answer is no longer ambiguous: the lease goes stale (adopt) or the
 *    record disappears (the writer was alive and has finished; stop).
 *
 * Waiting rather than refusing is what keeps the crash case working. A process
 * that dies is not distinguishable from a slow one *at that instant*, and a
 * relaunch is fast — a tab reload, a warm app start — so a session that decided
 * once, on mount, would refuse its own predecessor's verdict for being too
 * recently alive. That is the naive fix, and it breaks exactly what persistence
 * is for.
 *
 * WHAT THIS COSTS, stated rather than discovered. Adoption now happens up to
 * `LEASE_STALE_MS + LEASE_POLL_MS` after the writer's last breath, so a crash
 * in the last ~3.5s of an eight-second window is no longer recoverable: the
 * window runs out while the new session is still establishing that the old one
 * is gone, and the record is discarded with `stale_discarded` instead of
 * restored. The case goes back to the operator, which is the failure this file
 * has always chosen over the alternative.
 *
 * WHAT IT DOES NOT CLOSE. Two sessions that are *both* watching the same dead
 * writer will both adopt. `KeyValueStore` (`../platform/types.ts`) is
 * get/set/remove with no compare-and-swap, so there is no way to claim a record
 * that another watcher cannot also claim in the same instant; and the one
 * primitive that would settle it directly, `BroadcastChannel`, is a browser
 * global this package is compiled without on purpose — `tsconfig.json` drops
 * `lib: dom` and `platform/host-globals.d.ts` is the allowlist that did not
 * name it. So the hazard is narrowed, from "any second tab that mounts inside
 * the window" to "two spectators of one crash", and not removed. Nor does the
 * lease help a writer whose timers are *frozen* rather than gone — a browser
 * freezing a tab hidden for minutes — though an eight-second window opened by a
 * foreground click does not reach the five minutes Chrome's policy requires.
 */

/** How long the operator has to take a verdict back. */
export const UNDO_WINDOW_MS = 8000;

/**
 * How often the session holding the record re-stamps its lease.
 *
 * 1000ms because that is the floor anyway. The operator can give a verdict and
 * switch tabs in the same second, and a browser clamps `setInterval` in a
 * hidden tab to a **one-second minimum** — so a shorter interval would be
 * rounded up in silence and buy nothing, while advertising a precision the
 * platform does not deliver. (Chrome's harsher "intensive throttling", one
 * timer a minute, needs five minutes of hiding; a window opened by a foreground
 * click and closed eight seconds later cannot reach it.)
 *
 * At eight beats per verdict this is also the whole write cost of the lease.
 */
export const LEASE_HEARTBEAT_MS = 1000;

/**
 * How much silence means the writer is gone.
 *
 * Three beats. The beat is a 1000ms `setInterval` that a hidden tab may already
 * be stretching to the clamp, so one skipped beat is an ordinary event and two
 * is a busy main thread, not a corpse. Declaring a *live* writer dead is the
 * error that produces the duplicate commit this lease exists to prevent, so the
 * margin is spent on that side; the price is paid in `LEASE_POLL_MS`'s note.
 *
 * The comparison is `age > LEASE_STALE_MS`, so exactly three seconds of silence
 * still reads as alive: the tie goes to "someone else has it", which costs one
 * more poll, rather than to "take it", which costs a spurious error toast in
 * another operator's console.
 *
 * A stamp in the *future* — a clock moved backwards — has a negative age and
 * therefore also reads as alive, deliberately. It cannot be reasoned about, and
 * the safe reading of an unreasonable lease is "not mine". It is not a
 * permanent silence: the age grows as the clock is corrected, and the record's
 * own skew check (`remaining > UNDO_WINDOW_MS`) is what finally reports it.
 */
export const LEASE_STALE_MS = 3000;

/**
 * How often a session that found someone else's record looks again.
 *
 * Only ever runs while there is a record on disk this session did not write, so
 * for the overwhelmingly common mount — nothing on disk — no timer is created
 * at all. 500ms bounds the detection latency at `LEASE_STALE_MS + 500`; a
 * hidden tab's 1000ms clamp stretches that to 4000ms, which matters only for a
 * spectator tab and never for the relaunch that is the case worth serving.
 */
export const LEASE_POLL_MS = 500;

/**
 * Is some other session still holding the record on disk?
 *
 * Absent, unreadable, or older than `LEASE_STALE_MS` all mean no. Only a stamp
 * that parses as a finite number and is recent enough means yes — the same
 * "validate what came off the store rather than trust it" rule
 * `parsePersistedVerdict` is written to, for the same reason: a previous build
 * wrote it, or a person did.
 */
export function verdictLeaseIsLive(raw: string | null, now: number): boolean {
  if (raw === null || raw === "") return false;
  const seenAt = Number(raw);
  if (!Number.isFinite(seenAt)) return false;
  return now - seenAt <= LEASE_STALE_MS;
}

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
  /**
   * Wall-clock ms at which a **terminal delivery was accepted** for this
   * verdict, if one ever was. Absent on every record that has not been through
   * a terminal suspend, which is almost all of them.
   *
   * WHAT IT MEANS, PRECISELY: the host handed this conclude to the platform
   * while the session was being torn down, and nothing was ever able to read
   * the response. So it means *may have landed* — never *did*. The whole point
   * of the stamp is to mark this record as one whose fate cannot be decided
   * from the record alone, so the next session asks the server instead of
   * guessing. See `TerminalDelivery` and `flushTerminal` below.
   *
   * OPTIONAL, AND IT HAS TO BE. Records written by a build before this field
   * existed are still on operators' disks; `parsePersistedVerdict` must go on
   * accepting them, and the absence then reads as the truth — no delivery was
   * attempted, because no code could attempt one.
   */
  deliveredAt?: number;
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
  const { judgmentId, soulName, verdict, notes, createWorkflow, dueAt, deliveredAt } = record;
  if (typeof judgmentId !== "string" || judgmentId === "") return null;
  if (typeof soulName !== "string") return null;
  if (typeof notes !== "string") return null;
  if (typeof createWorkflow !== "boolean") return null;
  if (typeof dueAt !== "number" || !Number.isFinite(dueAt)) return null;
  if (!VERDICT_CODES.includes(verdict as VerdictCode)) return null;
  // `deliveredAt` is the one optional field, so it gets the one three-way
  // check: absent is valid and means no delivery was attempted; a finite
  // number is valid and means one was; anything else — a string, NaN, null
  // from a hand-edited store — DROPS THE WHOLE RECORD rather than being
  // ignored. Ignoring it would silently downgrade "may already be on the
  // server" to "definitely is not", which is the one reading that can produce
  // a duplicate disposition.
  const delivered =
    deliveredAt === undefined
      ? undefined
      : typeof deliveredAt === "number" && Number.isFinite(deliveredAt)
        ? deliveredAt
        : null;
  if (delivered === null) return null;
  return {
    judgmentId,
    soulName,
    verdict: verdict as VerdictCode,
    notes,
    createWorkflow,
    dueAt,
    ...(delivered === undefined ? {} : { deliveredAt: delivered }),
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

  /**
   * The lease heartbeat, running only while THIS session has a record on disk.
   *
   * Which is narrower than "while a verdict is held", and the narrowing is the
   * design rather than an omission. A session that *adopted* a record removed
   * it as it read it and never writes it back, so there is nothing left on disk
   * for anyone to find and nothing for a lease to protect. Only
   * `submitVerdict`, which writes the record, starts this.
   */
  const leaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopLease = useCallback(() => {
    if (leaseTimerRef.current !== null) {
      clearInterval(leaseTimerRef.current);
      leaseTimerRef.current = null;
    }
  }, []);

  const startLease = useCallback(() => {
    stopLease();
    markVerdictLease(String(Date.now()));
    leaseTimerRef.current = setInterval(() => {
      markVerdictLease(String(Date.now()));
    }, LEASE_HEARTBEAT_MS);
  }, [stopLease]);

  /**
   * Let go of the record: off disk, lease dropped, heartbeat stopped.
   *
   * One function rather than three calls at each of the four sites that end a
   * held verdict (commit on timer, flush, undo, adopt), because a site that
   * cleared the record and left the lease behind would leave a *stale* claim on
   * a record that no longer exists — harmless today, and exactly the kind of
   * pair that drifts apart. Safe when nothing is held or nothing is running.
   */
  const releaseHeld = useCallback(() => {
    stopLease();
    clearPendingVerdict();
    clearVerdictLease();
  }, [stopLease]);

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
        releaseHeld();
        void send(current);
      }, ms);
    },
    [clearTimer, releaseHeld, send]
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
    releaseHeld();
    void send(held);
  }, [clearTimer, releaseHeld, send]);

  /**
   * The way out when the client itself is being torn down.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT `flush`. `flush` LOST THE VERDICT TWICE OVER HERE.
   * ─────────────────────────────────────────────────────────────────────────
   *
   * `flush` does `releaseHeld()` and then `void send(held)`, in that order, and
   * both halves fail on this one path:
   *
   *  - `send` is `judgmentApi.conclude`, which is axios, which is **XHR**. A
   *    document that unloads aborts its in-flight XHRs. So the request was
   *    cancelled by the very event that started it.
   *  - `releaseHeld()` had already taken the record and the lease off disk, so
   *    the next session found nothing to adopt.
   *
   * The operator closed a tab inside the undo window and the verdict was gone,
   * with no toast (the page was already going) and nothing on disk. This was
   * strictly worse than doing nothing at all: leaving the record would have let
   * the next launch restore it under the operator's eye, which is the mechanism
   * the whole header is about. Nothing could see it — jsdom has no unload, and
   * the mocked `conclude` resolved.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * SO: DELIVER *AND* KEEP. Both, because neither alone is enough.
   * ─────────────────────────────────────────────────────────────────────────
   *
   * `deliverOnExit` uses `fetch(..., { keepalive: true })`, which survives the
   * document — see `TerminalDelivery` for why it cannot be `sendBeacon`. But
   * **no response is ever readable**, so "accepted by the platform" is the most
   * that can be known, and a record dropped on the strength of that would be a
   * verdict lost whenever the network was down at the wrong instant.
   *
   * So the record stays on disk, re-stamped with `deliveredAt`. The lease is
   * NOT re-stamped and NOT cleared: this session is dying, so letting the lease
   * go stale by itself is exactly the signal the next session's adoption check
   * reads as "the writer is gone, take it".
   *
   * The stamp is what makes keeping it safe. Without it the next session would
   * apply the ordinary window rules, find the window long gone, and report
   * `stale_discarded` — "your verdict was not sent, the case is back in the
   * queue" — which would be a **false sentence** whenever the keepalive
   * request did arrive. With it, the next session asks the server.
   *
   * IDEMPOTENT, like `flush`: `pendingRef` is cleared first, so a second
   * `beforeunload` (a navigation another listener cancelled, then retried)
   * returns before delivering anything.
   *
   * If the host cannot deliver at all — no adapter, no `fetch`, no token — the
   * record still stays, un-stamped. That is the honest record of what happened,
   * and the next session's ordinary window rules are then the right ones.
   */
  const flushTerminal = useCallback(() => {
    clearTimer();
    stopLease();
    const held = pendingRef.current;
    if (!held) return;
    pendingRef.current = null;
    setPending(null);
    const accepted = deliverOnExit(`/judgment/${held.judgmentId}/conclude/`, {
      verdict: held.verdict,
      notes: held.notes,
      create_workflow: held.createWorkflow,
    });
    // Re-written rather than left as it was, so the next session can tell the
    // two cases apart. This is the one write-back to a record already on disk,
    // and it does not breach the "a restored verdict is never written back"
    // rule in the header: that rule is about a record this session took OFF
    // disk and put on screen. This one never left.
    setPendingVerdict(
      JSON.stringify(accepted ? { ...held, deliveredAt: Date.now() } : held)
    );
  }, [clearTimer, stopLease]);

  const submitVerdict = useCallback(
    (input: { verdict: VerdictCode; notes?: string; createWorkflow?: boolean }) => {
      const judgment = cursor.judgment;
      if (!judgment) return;
      // ONE VERDICT PER CASE, and this guard is the whole of it.
      //
      // The card on screen does not change until the refetch lands, so every
      // way of pressing twice quickly lands here with the same `judgment.id`:
      // holding `1` down (the key handler now drops auto-repeat, but a real
      // second press is indistinguishable from one), double-clicking a verdict
      // button, or pressing again because the next case has not arrived yet.
      //
      // Without this, the second call reaches `flush()` below, which commits
      // verdict #1 **immediately** — the undo window vanishes with no undo bar
      // and no word to the operator — and then arms #2 for the same judgment.
      // Eight seconds later that POST comes back 400 "Judgment already
      // concluded" and is reported as `commit_error`: "the verdict did not
      // land; the case is back in the queue", about a verdict that landed and
      // a case that did not come back. Two false sentences from one keypress.
      //
      // Returning silently is deliberate. A second press on a case already
      // ruled on is not an error the operator needs told about — the undo bar
      // is already on screen saying what was decided, which is the true answer
      // to what they just asked.
      if (pendingRef.current?.judgmentId === judgment.id) return;
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
      // The record first, then the claim on it, and never the other way round.
      // A process that dies between these two writes leaves either a record
      // with no lease — which the next session adopts at once, correctly, since
      // nothing is keeping it warm — or a lease with no record, which reads as
      // "nothing to take" and loses a verdict that was never on disk. Only one
      // of those two orders has a survivable gap.
      startLease();
      arm(next, UNDO_WINDOW_MS);
    },
    [cursor.judgment, flush, arm, startLease]
  );

  /**
   * Take the held verdict back. Nothing was sent, so nothing is unwound: the
   * case leaves `holding` and the queue hands it straight back.
   */
  const undo = useCallback(() => {
    clearTimer();
    const held = pendingRef.current;
    if (!held) {
      // NOT A SILENT RETURN. The operator misses the countdown by a second,
      // presses U, and gets **nothing** — no toast, no flash — which is
      // indistinguishable from "the key is not working". They then press it
      // again, and again.
      //
      // The message says why rather than only that: once a verdict has been
      // sent there is a disposition, and changing it goes through the
      // ADMIN-only audited correction. That is the same sentence
      // `undo_scope_note` already puts on screen while the window is open —
      // this is the moment it stops being advice and becomes the answer.
      //
      // `info`, not `error`: the operator did nothing wrong. They asked a
      // question and this is the answer.
      notify("judgment.queue.undo_unavailable", "info");
      return;
    }
    pendingRef.current = null;
    setPending(null);
    // A taken-back verdict must not outlive the taking-back. Left on disk it
    // would be the one thing this design refuses: a decision the operator
    // withdrew, sent by the next launch.
    releaseHeld();
    setHolding((prev) => prev.filter((id) => id !== held.judgmentId));
    notify("judgment.queue.undo_done", "info");
  }, [clearTimer, releaseHeld]);

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
    // The heartbeat was frozen alongside the commit timer, so the lease on disk
    // is as stale as the countdown was. Re-stamp it in the same breath as
    // re-arming: the interval will pick up again by itself, but its next beat
    // is up to `LEASE_HEARTBEAT_MS` away, and this session is demonstrably
    // alive right now. (Nothing on React Native can read it — one process — but
    // a bfcache restore on web comes back into a browser where other tabs are
    // running, and this is the same event.)
    if (leaseTimerRef.current !== null) markVerdictLease(String(Date.now()));
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
  const flushTerminalRef = useRef(flushTerminal);
  flushTerminalRef.current = flushTerminal;
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  const stopLeaseRef = useRef(stopLease);
  stopLeaseRef.current = stopLease;
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
      if (kind === "terminal") flushTerminalRef.current();
    });
    const stopResume = onSessionResume(() => resyncRef.current());
    return () => {
      stopSuspend();
      stopResume();
      flushRef.current();
      // `flush` already stops the heartbeat on the path that had one running —
      // it returns early when nothing is held, and nothing can be running then.
      // This is the same statement made unconditionally, because an interval
      // that outlives its component writes to storage forever and nothing goes
      // red when it does.
      stopLeaseRef.current();
    };
  }, []);

  /**
   * Adopt or discard a verdict left behind by a session that did not come back.
   *
   * Starts on mount and is the only path from the store into this hook. The
   * rules are stated in the header; what is worth having here is the order,
   * because each step depends on the one before it:
   *
   *  0. **Is anything still holding it?** Asked first, before the record is
   *     even read, because the answer "yes" means every step below is the wrong
   *     thing to do — including the removal in step 1, which would take a live
   *     session's verdict off disk and leave that session with no copy at all.
   *     "Yes" is not a refusal, it is a "not yet": the check repeats every
   *     `LEASE_POLL_MS` until the lease goes stale (the writer died — adopt) or
   *     the record disappears (the writer finished — stop, silently, because
   *     nothing happened to this session).
   *  1. Read, then **remove immediately** — before parsing, before any further
   *     decision. A record is restored at most once, and the removal must not
   *     be conditional on the branch taken, or a record we refused stays behind
   *     to be refused again on every launch. The lease goes with it: it is a
   *     claim on a record that no longer exists.
   *  2. Parse defensively. Unreadable, or written by a shape this build does
   *     not recognise, is dropped without a word: there is nothing truthful to
   *     tell the operator about bytes we cannot read.
   *  3. Only then consult the clock. `remaining <= 0` is the ordinary case — an
   *     app relaunched minutes or days later — and `remaining > UNDO_WINDOW_MS`
   *     is a clock that moved backwards. Both discard, and they say different
   *     things, because they are different facts: one window ran out, the other
   *     cannot be measured at all.
   *  4. What is left is a window that genuinely has time in it, from a writer
   *     that is demonstrably not running. That verdict goes back on screen with
   *     the time it actually has left, under the operator's eye and their undo
   *     key. It is not re-persisted and takes no lease of its own; see the
   *     header, and `startLease`.
   */
  const armRef = useRef(arm);
  armRef.current = arm;
  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    let settled = false;
    // The delivery check is asynchronous, so this effect can now be torn down
    // with a request still in flight. Nothing below may touch state after
    // that — and, more to the point, nothing may `notify` after it: a toast
    // about a verdict fired at a console the operator has already navigated
    // away from is a message about a screen that no longer exists.
    let disposed = false;
    const stop = () => {
      settled = true;
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    };

    const attempt = () => {
      // NO PATH REACHES THIS TODAY, and it is here anyway — stated rather than
      // left to look like coverage. If this session gave a verdict of its own
      // while it was watching, the record on disk is now the one
      // `submitVerdict` wrote, under a lease this session is re-stamping every
      // second, so the liveness check below already declines it. What this
      // guards is the day that stops being true: overwriting a verdict the
      // operator is currently looking at, with one off the disk, is silent and
      // unrecoverable, and two lines are cheap against it.
      //
      // (`submitVerdict` overwriting *another* session's record is a separate,
      // pre-existing collision — one storage slot, two consoles — and is not
      // addressed here.)
      if (pendingRef.current !== null) {
        stop();
        return;
      }
      const raw = getPendingVerdict();
      if (raw === null) {
        // Either there never was one, or the session that held it has finished
        // with it. Nothing to say and nothing left to watch.
        stop();
        return;
      }
      if (verdictLeaseIsLive(getVerdictLease(), Date.now())) return;

      stop();
      clearPendingVerdict();
      clearVerdictLease();
      const held = parsePersistedVerdict(raw);
      if (held === null) return;

      // A record whose previous session got a terminal delivery *accepted*
      // cannot be judged by the clock alone, and this is the branch that says
      // so. The keepalive request may have arrived; nothing on that path could
      // read the answer. Applying the ordinary rules below would report
      // `stale_discarded` — "your verdict was not sent" — about a verdict that
      // very possibly was, and that sentence is exactly the kind this file's
      // header is written against.
      //
      // So the server is asked, once, and the answer decides. Everything about
      // the ordinary path stays as it was for records with no stamp, which is
      // all of them until a tab is closed inside an undo window.
      if (held.deliveredAt !== undefined) {
        void reconcileDelivered(held);
        return;
      }
      settleRestored(held);
    };

    /**
     * The clock rules, for a verdict that is known not to have been sent.
     *
     * Extracted so the delivery-check branch reaches the *same* three outcomes
     * rather than a paraphrase of them — two copies of "is this window still
     * open" would be two things to keep in agreement, and this repository has
     * a note about what happens to those.
     */
    function settleRestored(held: PendingVerdict) {
      if (disposed) return;
      const remaining = held.dueAt - Date.now();
      if (remaining <= 0) {
        notify("judgment.queue.stale_discarded", "error");
        return;
      }
      if (remaining > UNDO_WINDOW_MS) {
        notify("judgment.queue.skew_discarded", "error");
        return;
      }
      pendingRef.current = held;
      setPending(held);
      setHolding((prev) => (prev.includes(held.judgmentId) ? prev : [...prev, held.judgmentId]));
      armRef.current(held, remaining);
    }

    /**
     * Ask the server what became of a verdict we handed to the platform on the
     * way out.
     *
     * `judgmentApi.get` rather than a new endpoint: `Judgment.concluded_at` is
     * already on the detail serialiser and is exactly the fact in question —
     * `conclude_judgment` sets it inside the same transaction that creates the
     * disposition, so a non-null value means the whole thing ran.
     *
     * THREE ANSWERS, AND THE THIRD IS THE ONE WORTH ARGUING ABOUT:
     *
     *  - **Concluded.** It landed. Count it as decided and say so with a key of
     *    its own. Not `commit_error` (nothing went wrong) and not silence (the
     *    operator closed a tab mid-window and is owed the outcome).
     *  - **Not concluded.** The delivery did not arrive. Fall through to the
     *    ordinary rules — and note that `stale_discarded` is now a *verified*
     *    statement on this path rather than an assumption.
     *  - **The request itself failed.** We cannot tell. DISCARD, and say we
     *    could not tell. Re-arming would mean a POST for a judgment that may
     *    already be concluded, and the header's own ordering settles it: a lost
     *    verdict leaves the case pending and hands it back, a replayed one
     *    creates a disposition only an ADMIN correction can unwind. The
     *    operator is told to check the case rather than being told a story
     *    about it.
     */
    async function reconcileDelivered(held: PendingVerdict) {
      let concluded: boolean;
      try {
        const res = await judgmentApi.get(held.judgmentId);
        concluded = res.data.concluded_at !== null;
      } catch {
        if (!disposed) notify("judgment.queue.delivery_unverified", "error");
        return;
      }
      if (disposed) return;
      if (concluded) {
        setDecided((prev) =>
          prev.includes(held.judgmentId) ? prev : [...prev, held.judgmentId]
        );
        notify("judgment.queue.delivery_landed", "info");
        return;
      }
      settleRestored(held);
    }

    attempt();
    // Only ever created when the first look was inconclusive — a record on disk
    // with a live claim on it. The ordinary mount finds nothing and starts no
    // timer.
    if (!settled) poll = setInterval(attempt, LEASE_POLL_MS);
    return () => {
      disposed = true;
      if (poll !== null) clearInterval(poll);
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
    /**
     * The card on screen belongs to a query that is no longer the current one.
     *
     * This is the handover window, and it is the honest signal for it —
     * `isFetching` is not. `placeholderData` above keeps the just-ruled case
     * rendered while the next one loads, so between the verdict and the arrival
     * of the next case the console shows a card that is deliberately stale.
     * `isFetching` is also true for a plain background refetch on window focus,
     * where the card on screen is the right one and dimming it would be a lie.
     * `isPlaceholderData` is true for exactly the first case and not the second.
     */
    isPlaceholderData: query.isPlaceholderData,
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
