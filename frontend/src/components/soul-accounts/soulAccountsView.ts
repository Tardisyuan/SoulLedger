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

export const credentialTone = (status: string): BadgeTone => CREDENTIAL_TONE[status] ?? "neutral";
export const rebirthTone = (status: string): BadgeTone => REBIRTH_TONE[status] ?? "neutral";
export const rebirthBadgeClass = (status: string) => badgeVariants({ tone: rebirthTone(status) });

/** The filter buttons on the pending-delivery page, in the order an officer works through them. */
export const CREDENTIAL_FILTERS = ["PENDING", "REVEALED", "DELIVERED", "VOID", ""] as const;

/** 缩短冷却申请的筛选签:待决定在前(默认),「全部」殿后。 */
export const COOLDOWN_FILTERS = ["PENDING", "APPROVED", "REJECTED", ""] as const;

export const REBIRTH_FILTERS = ["", "UNDER_REVIEW", "REJECTED", "APPEALING", "APPEAL_REJECTED", "APPROVED"] as const;

/** Status → tone for 缩短冷却申请 (StatusBadge turns the tone into ◐ / ✓ / ✕). */
const COOLDOWN_TONE: Record<string, BadgeTone> = { PENDING: "warning", APPROVED: "success", REJECTED: "error" };
export const cooldownTone = (status: string): BadgeTone => COOLDOWN_TONE[status] ?? "neutral";

/** The cooldown behind a shortening request is over (the server sends no `cooldown_until` then). */
export const cooldownEnded = (r: { cooldown_until: string | null }) => r.cooldown_until === null;

/**
 * A11 默认排序:待决定在前,按剩余冷却从少到多,冷却已结束的排最后;已决定的保持服务端顺序
 * (最近提交在前)排在待决定之后。稳定排序。
 * ponytail: sorts the page it is handed (PAGE_SIZE rows) — a server-side `ordering` if pending ever pages.
 */
export function sortCooldownRows<T extends { status: string; cooldown_until: string | null; remaining_days: number }>(rows: T[]): T[] {
  const key = (r: T) => (r.status !== "PENDING" ? [1, 0, 0] : [0, cooldownEnded(r) ? 1 : 0, r.remaining_days]);
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.r);
}

/** `2026-10-13` in the viewer's zone (the detail's 「冷却截止」); `-` shape, not locale-dependent. */
export const isoDay = (value: string) => new Date(value).toLocaleDateString("sv-SE");

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
  // 缩短冷却申请(OfficerCooldownShorteningViewSet approve/ reject/)
  already_decided: "soul_accounts.cooldown.already_decided",
  cooldown_over: "soul_accounts.cooldown.cooldown_over",
  invalid_days: "soul_accounts.cooldown.invalid_days",
  note_required: "soul_accounts.cooldown.note_required",
};

export function failureKey(failure: SoulAccountFailure, fallback: string): string {
  return (failure.code && FAILURE_KEYS[failure.code]) || fallback;
}
