/**
 * Sending a decision -- the officer app's one write that is a verdict. Out of `rules.ts` (cq-apps 2026-10-30 #9),
 * which is otherwise pure: the low-level approve / reject calls live only here (`decisionsAreChecked.test.ts`),
 * and every screen reaches this through `confirmedDecision` (deviceCheck.ts).
 */
import { dispatchApi } from "@soulledger/core/api/dispatch";
import type { TodoFacts, TodoItemDetail } from "@soulledger/core/api/officer-app";
import { soulAccountsApi } from "@soulledger/core/api/soul-accounts";
import { workflowApi } from "@soulledger/core/api/workflow";

import { passVerdictsOf, rebirthCross, refuseVerdictOf, type Verdict } from "./rules";

export interface DecisionInput {
  detail: TodoItemDetail;
  verdict: Verdict;
  /** An approval of a workflow node: which passing verdict (when the node accepts several). */
  passVerdict?: string;
  /** The reject reason (required to reject); an approval's optional note. */
  reason: string;
  /** Cooldown shortening only: the days to approve. */
  days?: number;
}

/**
 * Sends one decision to the endpoint the desk already uses for that kind. `require_reason: true`
 * asks the server to enforce the same rule (400 `reason_required`). Rejects with the axios error;
 * `decisionFailure` reads it.
 */
export async function submitDecision({ detail, verdict, reason, days, passVerdict }: DecisionInput): Promise<void> {
  const note = reason.trim();
  if (verdict === "reject" && note === "") throw new Error("reason_required");
  if (detail.kind === "approval" || detail.kind === "rebirth") {
    if (!detail.workflow_id || !detail.node_id) throw new Error("no_node");
    // O-b: approving the first review on the phone settles 跨文明 as 「不跨」 -- written first, so the record says so.
    // 409 = the first review is already past (the flag is no longer this step's to set): approve as before.
    if (verdict === "approve" && rebirthCross(detail) === "no" && (detail.facts as TodoFacts | undefined)?.cross_civilization == null) {
      await soulAccountsApi.decideCrossCivilization(detail.id, false).catch((e: unknown) => {
        if ((e as { response?: { status?: number } })?.response?.status !== 409) throw e;
      });
    }
    await workflowApi.approveNode(detail.workflow_id, detail.node_id, {
      verdict: verdict === "approve" ? (passVerdict ?? passVerdictsOf(detail)[0]) : refuseVerdictOf(detail),
      notes: note,
      require_reason: true,
      // A rebirth rejection is read by the soul; the same words, since the officer wrote one reason.
      ...(detail.kind === "rebirth" && verdict === "reject" ? { rejection_reason_for_soul: note } : {}),
    });
    return;
  }
  if (detail.kind === "cooldown") {
    if (verdict === "approve") await soulAccountsApi.approveCooldownShortening(detail.id, days ?? 0, note);
    else await soulAccountsApi.rejectCooldownShortening(detail.id, note);
    return;
  }
  if (detail.kind === "reassignment") {
    if (verdict === "approve") await dispatchApi.approve(detail.id);
    else await dispatchApi.reject(detail.id, note);
    return;
  }
  throw new Error("unknown_kind");
}
