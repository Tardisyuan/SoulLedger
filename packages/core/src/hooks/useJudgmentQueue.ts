"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, type JudgmentClaimRefusal, type JudgmentQueueCursor } from "../api/index";
import { judgmentKeys } from "../query_keys";
import { notify } from "../platform/index";

/**
 * The judgment triage queue's session state (BRIEF §4.2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A verdict is POSTed the moment it is given. There is no undo window.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 2026-09-25, the user's decision: 「落判即提交,不可撤回」, the same rule the
 * desk (`app/judgment/[id]/page.tsx`) already follows. This hook used to hold a
 * verdict client-side for eight seconds before sending it, so U could take it
 * back; that window, its on-disk copy, the cross-tab lease, the terminal
 * `keepalive` delivery and the restore-on-launch path all existed only for it
 * and went with it. `POST /judgment/{id}/conclude/` creates the disposition in
 * the same transaction as the verdict (backend/apps/judgment/services.py), so a
 * verdict that has been sent is changed only through the ADMIN-only audited
 * correction — which is now true from the keystroke on.
 *
 * What stayed:
 *  - The operator advances at once. The case goes into `holding` (part of the
 *    `next/` skip list) while its request is in flight, so the next fetch does
 *    not hand it straight back; it leaves `holding` when the request settles.
 *  - A refusal is never silent. A failed POST puts the case back in the queue
 *    and says so (`commit_error`). A 409 `claimed_by_other` — somebody else
 *    has claimed the case, and only they, a MODERATOR or an ADMIN may conclude
 *    it — defers the case for the sitting instead, since handing it back would
 *    only invite the same refusal, and is handed to the screen as
 *    `claimRefusal` (a standing warning with the claimant's name, 第三类 F 组
 *    2.2), not a toast that is gone before it is read.
 *  - One verdict per case: a second press on the card still on screen (auto-
 *    repeat, a double click, the next case not yet arrived) is dropped while the
 *    first request for that case is in flight.
 */

/** The four verdicts, as a value and not only as a type. */
export const VERDICT_CODES = ["PASSED", "FAILED", "PURGATORY", "RETRY"] as const;

export type VerdictCode = (typeof VERDICT_CODES)[number];

export interface QueueProgress {
  /** 1-based ordinal of the card on screen within this sitting. */
  position: number;
  /** Denominator: pending count latched when the session opened. */
  total: number;
  /** Verdicts that landed this session. */
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

/** The refusal body, if `err` is the conclude endpoint's 409 `claimed_by_other`. */
function claimedByOther(err: unknown): JudgmentClaimRefusal | null {
  const response = (err as { response?: { status?: number; data?: JudgmentClaimRefusal } })?.response;
  return response?.status === 409 && response.data?.code === "claimed_by_other" ? response.data : null;
}

export function useJudgmentQueue(options?: { at?: string }) {
  const at = options?.at;
  const qc = useQueryClient();

  /** Deliberately deferred by the operator. Session-only; never sent as state. */
  const [deferred, setDeferred] = useState<string[]>([]);
  /**
   * Cases whose verdict request is in flight. Still pending server-side until
   * it lands, so without this the very next fetch would hand the operator the
   * case they just ruled on.
   */
  const [holding, setHolding] = useState<string[]>([]);
  const [decided, setDecided] = useState<string[]>([]);
  const [sessionTotal, setSessionTotal] = useState<number | null>(null);
  /** The last verdict refused because someone else holds the case: who, and which case. */
  const [claimRefusal, setClaimRefusal] = useState<{ id: string; name: string } | null>(null);
  /** Same ids as `holding`, readable synchronously by a second press in the same tick. */
  const inFlight = useRef(new Set<string>());

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

  const submitVerdict = useCallback(
    async (input: { verdict: VerdictCode; notes?: string; createWorkflow?: boolean }) => {
      const judgment = cursor.judgment;
      if (!judgment || inFlight.current.has(judgment.id)) return;
      const id = judgment.id;
      setClaimRefusal(null); // a new verdict: the last refusal has been read
      inFlight.current.add(id);
      setHolding((prev) => [...prev, id]);
      try {
        await judgmentApi.conclude(id, {
          verdict: input.verdict,
          notes: input.notes ?? "",
          create_workflow: input.createWorkflow ?? false,
        });
        setDecided((prev) => [...prev, id]); // once per case: the in-flight guard, then the server refuses a re-conclude
        qc.invalidateQueries({ queryKey: judgmentKeys.all });
      } catch (err) {
        const refusal = claimedByOther(err);
        if (refusal) {
          setDeferred((prev) => [...prev, id]); // it was on screen, so it was not deferred
          setClaimRefusal({ id, name: refusal.claimed_by_name ?? "" });
        } else {
          // Nothing landed (or we cannot tell). The case goes back in the queue —
          // it is still pending, and the operator must see it again.
          notify("judgment.queue.commit_error", "error");
        }
      } finally {
        inFlight.current.delete(id);
        setHolding((prev) => prev.filter((held) => held !== id));
      }
    },
    [cursor.judgment, qc]
  );

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
  const restoreDeferred = useCallback(() => {
    setDeferred([]);
    setClaimRefusal(null);
  }, []);
  const dismissClaimRefusal = useCallback(() => setClaimRefusal(null), []);

  const total = sessionTotal ?? cursor.total;
  // A verdict counts as progress the moment it is given, not when it lands —
  // the operator has moved on. `holding` carries the ids in flight and
  // `decided` the ones that landed; the union covers the one-render gap in
  // which an id belongs to neither. A claimed-by-other refusal moves its id to
  // `deferred`, so it is counted once, there.
  const processed = new Set([...deferred, ...decided, ...holding]).size;
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
    /** True once the queue has nothing left to hand out. */
    isExhausted: query.isSuccess && cursor.judgment === null,
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
    defer,
    restoreDeferred,
    deferredCount: deferred.length,
    claimRefusal,
    dismissClaimRefusal,
  };
}
