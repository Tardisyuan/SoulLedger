import type { InitialCredential } from "@soulledger/core/api";
import type { SoulAccountFailure } from "@soulledger/core/hooks/useSoulAccounts";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";

/** Status → badge tone (Badge.tsx owns the tokens). Unlisted or unknown → neutral. */
const CREDENTIAL_TONE: Record<string, BadgeTone> = {
  PENDING: "warning",
  REVEALED: "info",
  DELIVERED: "success",
  SENT: "success",
  QUEUED: "info",
  VOID: "neutral",
};

const REBIRTH_TONE: Record<string, BadgeTone> = {
  UNDER_REVIEW: "info",
  APPEALING: "info",
  REJECTED: "error",
  APPEAL_REJECTED: "error",
  APPROVED: "success",
};

export const credentialBadgeClass = (status: string) => badgeVariants({ tone: CREDENTIAL_TONE[status] ?? "neutral" });
export const rebirthBadgeClass = (status: string) => badgeVariants({ tone: REBIRTH_TONE[status] ?? "neutral" });

/** The filter buttons on the pending-delivery page, in the order an officer works through them. */
export const CREDENTIAL_FILTERS = ["PENDING", "REVEALED", "DELIVERED", "VOID", ""] as const;

export const REBIRTH_FILTERS = ["", "UNDER_REVIEW", "REJECTED", "APPEALING", "APPEAL_REJECTED", "APPROVED"] as const;

/** 0-based `cycle` → the "第 N 世" number, same convention as SoulKarmaLedgerCard's `life.index + 1`. */
export const lifeNumber = (cycle: number) => String(cycle + 1);

export function isExpired(credential: Pick<InitialCredential, "expires_at">, now: number = Date.now()): boolean {
  return new Date(credential.expires_at).getTime() <= now;
}

/**
 * Why this credential is in front of an officer, as a copy key plus params.
 * A VOID row is split by time: the backend voids on expiry AND on reset /
 * soul password change / rebirth, and only the first one means "go reset".
 */
export function credentialReason(c: InitialCredential, now: number = Date.now()): { key: string; params?: Record<string, string> } {
  if (c.status === "VOID") {
    return isExpired(c, now) ? { key: "soul_accounts.credentials.reason.expired" } : { key: "soul_accounts.credentials.reason.voided" };
  }
  if (c.last_error) {
    return {
      key: "soul_accounts.credentials.reason.send_failed",
      params: { error: c.last_error, attempts: String(c.attempts) },
    };
  }
  if (!c.channel) return { key: "soul_accounts.credentials.reason.no_contact" };
  return { key: "soul_accounts.credentials.reason.channel", params: { channel: c.channel } };
}

/**
 * The toast copy for a failed soul-account write, by the backend's stable
 * `code`. An unlisted code falls back to the caller's generic key — a code this
 * build does not know is not guessed at.
 */
const FAILURE_KEYS: Record<string, string> = {
  credential_not_revealable: "soul_accounts.reveal.already_revealed",
  credential_expired: "soul_accounts.credentials.expired_go_reset",
  credential_not_revealed: "soul_accounts.credentials.deliver_not_revealed",
  credential_not_pending: "soul_accounts.credentials.retry_not_pending",
  account_retired: "soul_accounts.account.retired_cannot_reset",
  soul_alive: "soul_accounts.account.soul_alive",
  not_found: "soul_accounts.account.soul_not_found",
  not_the_approver: "soul_accounts.rebirth.cross_not_approver",
  not_in_initial_review: "soul_accounts.rebirth.cross_not_in_initial",
};

export function failureKey(failure: SoulAccountFailure, fallback: string): string {
  return (failure.code && FAILURE_KEYS[failure.code]) || fallback;
}
