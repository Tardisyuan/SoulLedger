/**
 * The officer app's rules that are not pixels: what a decision sends, why one failed, where a
 * push lands, where "continue on desktop" points. Pure functions so a test can pin each.
 */
import { dispatchApi } from "@soulledger/core/api/dispatch";
import {
  decisionFailureOf,
  type DecisionFailureCode,
  type Todo,
  type TodoItemDetail,
  type TodoKind,
} from "@soulledger/core/api/officer-app";
import { soulAccountsApi } from "@soulledger/core/api/soul-accounts";
import { workflowApi } from "@soulledger/core/api/workflow";
import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

export const TODO_KINDS: readonly TodoKind[] = ["approval", "reassignment", "cooldown", "rebirth"];

/**
 * 转生申请的标题:后端给的是灵魂名,「转生申请 · 名」(申诉:「转生申请申诉 · 名」)在这里按语言包拼。
 * 其他种类的 `title` 原样。
 */
export function todoTitle(item: { kind: string; title: string; is_appeal?: boolean }, t: (key: string, vars?: Record<string, string>) => string): string {
  if (item.kind !== "rebirth" || !item.title) return item.title;
  return t(item.is_appeal ? "soul_accounts.rebirth.appeal_title" : "soul_accounts.rebirth.detail_title", { name: item.title });
}

/** The four lists in `GET todo/`, in the spec's order, with the kind each one holds. */
export const TODO_GROUPS: readonly { field: keyof Todo; kind: TodoKind; label: string }[] = [
  { field: "approvals", kind: "approval", label: "officer_app.todo.groups.approvals" },
  { field: "reassignments", kind: "reassignment", label: "officer_app.todo.groups.reassignments" },
  { field: "cooldowns", kind: "cooldown", label: "officer_app.todo.groups.cooldowns" },
  { field: "rebirths", kind: "rebirth", label: "officer_app.todo.groups.rebirths" },
];

export function isTodoKind(value: unknown): value is TodoKind {
  return typeof value === "string" && (TODO_KINDS as readonly string[]).includes(value);
}

// ── decisions ──────────────────────────────────────────────────────────

export type Verdict = "approve" | "reject";

/** The verdicts that pass a node (`complete_node`: `verdict in [PASSED, CONFIRMED]`). */
const PASSING = ["PASSED", "CONFIRMED"] as const;

/**
 * The passing verdicts this node accepts, from its `required_verdicts` (empty list = no constraint,
 * so plain PASSED). One entry: the approval sends it. Several: the approve sheet lets the officer pick.
 * A node that declares only refusing verdicts has nothing to approve with; PASSED is returned and the
 * server answers 400, rather than the app inventing a verdict the node never listed.
 */
export function passVerdictsOf(detail: Pick<TodoItemDetail, "required_verdicts">): string[] {
  const declared = detail.required_verdicts ?? [];
  if (declared.length === 0) return ["PASSED"];
  const accepted = PASSING.filter((v) => declared.includes(v));
  return accepted.length > 0 ? accepted : ["PASSED"];
}

/** The refusing verdict to send: REJECTED unless the node declares verdicts and only lists FAILED. */
export function refuseVerdictOf(detail: Pick<TodoItemDetail, "required_verdicts">): "REJECTED" | "FAILED" {
  const declared = detail.required_verdicts ?? [];
  return declared.length > 0 && !declared.includes("REJECTED") && declared.includes("FAILED") ? "FAILED" : "REJECTED";
}

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

/** A reject without a reason is refused HERE, before any request; the screen marks it on confirm. */
export function reasonMissing(verdict: Verdict, reason: string): boolean {
  return verdict === "reject" && reason.trim() === "";
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

/** Why a submit failed (the words are under officer_app confirm reasons), plus who handled it if known. */
export type FailureReason = DecisionFailureCode | "network" | "other";

export function decisionFailure(error: unknown): { reason: FailureReason; handledBy: string | null } {
  const known = decisionFailureOf(error);
  if (known) return { reason: known.code, handledBy: known.handledBy?.name ?? null };
  const response = (error as { response?: unknown })?.response;
  return { reason: response ? "other" : "network", handledBy: null };
}

export function failureReasonKey(reason: FailureReason): string {
  switch (reason) {
    case "already_handled":
    case "deadline_passed":
    case "permission_changed":
    case "network":
      return `officer_app.confirm.reasons.${reason}`;
    case "reason_required":
      return "officer_app.confirm.reason_required";
    default:
      return "officer_app.confirm.reasons.other";
  }
}

/** The 409 `hall_required` body of `officer-login/`, or null. */
export function hallChoiceOf(error: unknown): { halls: { code: string; display_name: string }[] } | null {
  const response = (error as { response?: { status?: number; data?: { code?: string; halls?: unknown } } })?.response;
  if (response?.status !== 409 || response.data?.code !== "hall_required" || !Array.isArray(response.data.halls)) return null;
  return { halls: response.data.halls as { code: string; display_name: string }[] };
}

/** Why a login or a two-step verification was refused, as an i18n key under `officer_app`. */
export function loginFailureKey(error: unknown, step: "login" | "mfa"): string {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  if (!response) return `officer_app.${step}.reasons.network`;
  const code = response.data?.code;
  if (response.status === 429 || code === "login_locked" || code === "locked") return `officer_app.${step}.reasons.locked`;
  if (step === "mfa" && code === "expired") return "officer_app.mfa.reasons.expired";
  if (step === "mfa" && code === "wrong") return "officer_app.mfa.reasons.wrong";
  if (response.status === 401 || response.status === 400) return `officer_app.${step}.reasons.${step === "login" ? "bad_credentials" : "wrong"}`;
  return `officer_app.${step}.reasons.other`;
}

// ── push landing ───────────────────────────────────────────────────────

export interface Landing {
  tab: "todo";
  item?: { kind: TodoKind; id: string };
}

/**
 * Where a tapped push goes. The server today sends only `{category: "officer_todo"}` (the lock
 * screen carries a count and nothing identifying), which lands on the to-do list. A payload that
 * also names `target: {kind, id}` -- the shape `GET todo/` rows carry -- lands on that item's detail.
 * Anything else is `null`: just open the app.
 */
export function landingOf(data: unknown): Landing | null {
  if (!data || typeof data !== "object") return null;
  const { category, target } = data as { category?: unknown; target?: { kind?: unknown; id?: unknown } };
  if (target && isTodoKind(target.kind) && typeof target.id === "string" && target.id !== "") {
    return { tab: "todo", item: { kind: target.kind, id: target.id } };
  }
  return category === "officer_todo" ? { tab: "todo" } : null;
}

/** The note on a detail whose item someone else already settled; `null` when it is still ours. */
export function handledNotice(detail: Pick<TodoItemDetail, "actionable" | "state" | "handled_by">):
  | { kind: "handled"; name: string | null }
  | { kind: "deadline_passed" | "permission_changed" }
  | null {
  if (detail.actionable) return null;
  if (detail.state === "deadline_passed" || detail.state === "permission_changed") return { kind: detail.state };
  return { kind: "handled", name: detail.handled_by?.name ?? null };
}

// ── continue on desktop ────────────────────────────────────────────────

/** The desk's origin. A store build sets `EXPO_PUBLIC_DESK_URL`; the fallback is the local dev desk. */
export function deskBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_DESK_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** 忘记密码: the desk's e-mail reset request page. The app only opens it; the reset happens in the browser. */
export function forgotPasswordUrl(): string {
  return deskBaseUrl() + "/forgot-password";
}

/** The desk page for the same item. Pages that are lists (cooldown, rebirth) are the list itself. */
export function deskPath(target: { kind: TodoKind | "judgment" | "soul"; id: string }): string {
  switch (target.kind) {
    case "approval":
      return `/workflow/${target.id}`;
    case "reassignment":
      return `/dispatch/${target.id}`;
    case "cooldown":
    case "rebirth":
      return "/rebirth-applications";
    case "judgment":
      return `/judgment/${target.id}`;
    case "soul":
      return `/souls/${target.id}`;
  }
}

export function deskUrl(target: Parameters<typeof deskPath>[0]): string {
  return deskBaseUrl() + deskPath(target);
}

// ── small helpers ──────────────────────────────────────────────────────

/** 403 means the role cannot see the area: the "denied" state, not an error. */
export function isDenied(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 403;
}

/** How long the pushed row's highlight takes to go (spec §五). */
export const HIGHLIGHT_MS = 1200;
/** Its peak: `ink / .07`. */
export const HIGHLIGHT_ALPHA = 0.07;

/**
 * The hall's name for the identity band and Me: the civilization's underworld name
 * (`plaque.realm.<civ>`, e.g. 酆都), as the web console does (`useRealm`). The tenant's
 * `display_name` is the database's English ("Chinese Afterlife") and showed through on a
 * Chinese screen; it stays only as the fallback for a code no civilization claims.
 */
export function hallLabel(
  t: (key: string) => string,
  tenant: { code?: string | null; display_name?: string | null } | null | undefined,
): string | undefined {
  const civ = tenant?.code?.split("_")[0].toLowerCase();
  if (civ && Object.values(CIVILIZATION_SHORT_CODES).includes(civ)) return t(`plaque.realm.${civ}`);
  return tenant?.display_name ?? undefined;
}
