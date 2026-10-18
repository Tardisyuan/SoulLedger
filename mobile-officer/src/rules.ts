/**
 * The officer app's rules that are not pixels: what a decision sends, why one failed, where a
 * push lands, where "continue on desktop" points. Pure functions so a test can pin each.
 */
import { NOTIFICATION_CATEGORIES, NOTIFICATION_LOCKED, passwordReasonKeys, type NotificationCategory } from "@soulledger/core/api/auth";
import { dispatchApi, type DispatchRecord } from "@soulledger/core/api/dispatch";
import {
  decisionFailureOf,
  type DecisionFailureCode,
  type Todo,
  type TodoFacts,
  type TodoItemDetail,
  type TodoKind,
} from "@soulledger/core/api/officer-app";
import { soulAccountsApi } from "@soulledger/core/api/soul-accounts";
import { INBOX_REPLY_MAX, renderTemplate } from "@soulledger/core/api/soul-inbox";
import { workflowApi } from "@soulledger/core/api/workflow";
import { TENANT_CODE_TO_CIVILIZATION, realmLabel } from "@soulledger/core/config/civilizations";
import { pickHall } from "@soulledger/core/domain/workflowSegments";

export const TODO_KINDS: readonly TodoKind[] = ["pick", "approval", "reassignment", "cooldown", "rebirth", "letter", "sentence_change"];

/** Kinds that are only read on the phone (Design 第四十批 O-f): no detail, the group's bar says 「在电脑上处理」. */
export const VIEW_ONLY_KINDS: readonly TodoKind[] = ["sentence_change"];

/**
 * 转生申请的标题:后端给的是灵魂名,「转生申请 · 名」(申诉:「转生申请申诉 · 名」)在这里按语言包拼。
 * 其他种类的 `title` 原样。
 */
export function todoTitle(item: { kind: string; title: string; is_appeal?: boolean; total?: number }, t: (key: string, vars?: Record<string, string>) => string): string {
  // 待我选站:「{灵魂} · 本域 N 站」,N 是本域这一段的站数(默认流程)。
  if (item.kind === "pick") return t("workflow.pick_group.row_title", { soul: item.title, n: String(item.total ?? 0) });
  if (item.kind !== "rebirth" || !item.title) return item.title;
  return t(item.is_appeal ? "soul_accounts.rebirth.appeal_title" : "soul_accounts.rebirth.detail_title", { name: item.title });
}

/**
 * The lists in `GET todo/`, in the order the screen draws them (Design batch 15): 审批节点, 移交,
 * 缩短冷却申请, 转生申请, 待回书信. 移交 is the dispatch proposals aimed at this hall (the field and kind are
 * still called `reassignment`; it is the same queue as the desk's 移交 inbox, `DispatchRecordViewSet.
 * proposed`), and it is counted with the rest everywhere the to-do total is read.
 * 待回书信 (`letters`): letters assigned to me that the soul wrote last -- the desk inbox's 待回复 and
 * 交给我的 together. It is counted with the rest, and drawn only when it has something.
 * 受刑计划变更 (`sentence_changes`, Design 第四十批 O-f): requests awaiting this hall's original judge. Read-only
 * here and never pushed, but counted with the rest (the server's `total()` counts it too).
 * 待我选站 (`pick_nodes`, Design 第四十三批 O-1): first, above 审批节点 -- an unpicked realm holds up another hall's
 * flow. Its rows open the pick page (`screens/pick.tsx`), keyed by the workflow.
 */
export const TODO_GROUPS: readonly { field: keyof Todo; kind: TodoKind; label: string }[] = [
  { field: "pick_nodes", kind: "pick", label: "officer_app.todo.groups.pick_nodes" },
  { field: "approvals", kind: "approval", label: "officer_app.todo.groups.approvals" },
  { field: "reassignments", kind: "reassignment", label: "officer_app.todo.groups.reassignments" },
  { field: "cooldowns", kind: "cooldown", label: "officer_app.todo.groups.cooldowns" },
  { field: "rebirths", kind: "rebirth", label: "officer_app.todo.groups.rebirths" },
  { field: "letters", kind: "letter", label: "officer_app.todo.groups.letters" },
  { field: "sentence_changes", kind: "sentence_change", label: "officer_app.todo.group_sentence_change" },
];

/**
 * 「待我选站」一行标题下的两行(O-1):「{发起域} · {殿}发起 · 本域排第 N」,再一行「流程已在门口等 · N 天」或
 * 「前面还有 N 站」。`realm` 是发起殿的租户代码,读成文明名(「中国」);认不得时留空,不印代码(同官员台)。
 * 殿名是冥界名接审判所在的殿(`pickHall`:「酆都第十殿」),不是库里的英文展示名。
 */
export function pickRowLines(
  row: { realm?: string; hall?: string; court?: string; segment_order?: number; gate_days?: number | null; stations_ahead?: number | null },
  t: (key: string, vars?: Record<string, string>) => string,
  civilization: (code: string | undefined) => string,
): { meta: string; wait: string; atGate: boolean } {
  const atGate = row.gate_days != null;
  return {
    meta: t("workflow.pick_group.row_meta", { realm: civilization(TENANT_CODE_TO_CIVILIZATION[row.realm ?? ""]), hall: pickHall(t, row), order: String(row.segment_order ?? "") }),
    wait: atGate ? t("workflow.pick_group.at_gate", { n: String(row.gate_days) }) : t("workflow.pick_group.ahead", { n: String(row.stations_ahead ?? 0) }),
    atGate,
  };
}

export function isTodoKind(value: unknown): value is TodoKind {
  return typeof value === "string" && (TODO_KINDS as readonly string[]).includes(value);
}

/**
 * What a link, push or notice can name: a waiting item, or a dispatch record (`dispatch`). A dispatch
 * notice does not say which side of the record this hall is on, so it names the record and the screen
 * reads the record to decide (`dispatchView`); `reassignment` is the receiver's actionable detail.
 */
export type ItemKind = TodoKind | "dispatch";
export function isItemKind(value: unknown): value is ItemKind {
  return value === "dispatch" || isTodoKind(value);
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

/**
 * 转生初审的批准底页(Design 第四十批 O-b),不加开关:
 * `no` = 初审(第一步、不是申诉)且没定成跨 —— 底页写「跨文明：不跨，批准后不能改」,按钮「批准 · 不跨」;
 * `desk` = 已定为跨文明 —— 手机上不给批准,只有「在电脑上继续」;`null` = 不是这件事(别的种类或后面的步骤)。
 * The application carries no wished-for civilization of its own (only `desired_form`), so "the wish is another
 * civilization" is read as the flag already set to cross.
 */
export function rebirthCross(detail: Pick<TodoItemDetail, "kind" | "facts" | "is_appeal">): "no" | "desk" | null {
  if (detail.kind !== "rebirth") return null;
  const facts = detail.facts as TodoFacts | undefined;
  if (facts?.cross_civilization === true) return "desk";
  return !detail.is_appeal && (facts?.node?.index ?? 1) === 1 ? "no" : null;
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
  item?: { kind: ItemKind; id: string };
  /** A notice about a judgment / a soul opens that read-only detail (not a to-do item). */
  judgment?: string;
  soul?: string;
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
  if (target && isItemKind(target.kind) && typeof target.id === "string" && target.id !== "") {
    return { tab: "todo", item: { kind: target.kind, id: target.id } };
  }
  return category === "officer_todo" ? { tab: "todo" } : null;
}

/**
 * Where a tapped row in 通知 goes: the same landing as a tapped push, built from the row's own
 * `related_resource` / `related_id`. A workflow notification (`WORKFLOW_ASSIGNED`) names the
 * workflow an approval todo is keyed by. Anything else -- no target, an unknown resource -- is `null`.
 */
export function noticeLanding(n: { related_resource?: string | null; related_id?: string | null }): Landing | null {
  // `SOUL_INBOX_ASSIGNED` (a letter was handed to me) names the inbox conversation.
  // The four dispatch notices (`DISPATCH_PROPOSED` / `APPROVED` / `REJECTED` / `CANCELLED`) name the record.
  // `judgment` (a reassign request to ADMINs, 判决完成) and `soul` (灵魂账号没开成, 退回受阻) name a Judgment / Soul id.
  if (n.related_id && n.related_resource === "judgment") return { tab: "todo", judgment: n.related_id };
  if (n.related_id && n.related_resource === "soul") return { tab: "todo", soul: n.related_id };
  // A rebirth application's workflow notice names the application (`rebirth_application`): the rebirth item's own id.
  const map: Record<string, string> = { workflow: "approval", rebirth_application: "rebirth", soul_inbox: "letter", DispatchRecord: "dispatch" };
  const kind = (n.related_resource && map[n.related_resource]) || n.related_resource;
  return landingOf({ target: { kind, id: n.related_id } });
}

/**
 * What a detail and the list row that opened it both answer to, so a detail found gone (Design 第四十批 O-c)
 * can grey that row out once the officer is back: a to-do row, a notice that lands there, a queue row.
 */
export type GoneTarget = { type: "todo"; kind: string; id: string } | { type: "judgment" | "soul"; id: string };
export function goneKey(target: GoneTarget): string {
  return target.type === "todo" ? `${target.kind}:${target.id}` : `${target.type}:${target.id}`;
}
export function landingGoneKey(landing: Landing | null): string | null {
  if (!landing) return null;
  if (landing.judgment) return goneKey({ type: "judgment", id: landing.judgment });
  if (landing.soul) return goneKey({ type: "soul", id: landing.soul });
  return landing.item ? goneKey({ type: "todo", ...landing.item }) : null;
}

/**
 * Notices whose subject has no phone screen: 联审 (`CrossTenantJudgment`: its id is not a Judgment's), 受刑计划 nodes
 * (`SentencePlan`), scheduler jobs, 代看 / 忘记密码求助 (`user`), assistant config, 死亡登记重试失败 (`death_sync`). Their row says 「在电脑上查看」
 * instead of being a tap that does nothing.
 */
const DESK_ONLY_NOTICES: readonly string[] = ["CrossTenantJudgment", "SentencePlan", "scheduler", "user", "assistant_config", "death_sync"];
export const noticeIsDeskOnly = (n: { related_resource?: string | null }): boolean => !!n.related_resource && DESK_ONLY_NOTICES.includes(n.related_resource);

// ── dispatch records (what a dispatch notice lands on) ─────────────────

/**
 * Which screen a dispatch record gets from THIS hall, decided by the record and not by the notice's type:
 * the receiving hall with the proposal still open acts on it (the `reassignment` detail, 批准 / 驳回);
 * everything else reads it. `side` is "sender" only when this hall proposed it -- that side is told about the
 * other hall's answer ("对方…"); any other reader gets the plain status word.
 */
export function dispatchView(
  record: Pick<DispatchRecord, "status" | "source_tenant_code" | "target_tenant_code">,
  ownHall: string | null | undefined
): { mode: "act" } | { mode: "read"; side: "sender" | "other" } {
  if (ownHall && record.target_tenant_code === ownHall && record.status === "PROPOSED") return { mode: "act" };
  return { mode: "read", side: ownHall && record.source_tenant_code === ownHall ? "sender" : "other" };
}

/**
 * The reason a record was rejected / cancelled: the server keeps it apart in `decision_reason` (`reason` stays the
 * proposer's own words). Blank is `null`, and the screen then draws no 理由 line. Only REJECTED / CANCELLED have one.
 */
export function dispatchReasonOf(record: Pick<DispatchRecord, "status" | "decision_reason">): string | null {
  if (record.status !== "REJECTED" && record.status !== "CANCELLED") return null;
  return (record.decision_reason ?? "").trim() || null;
}

/** The status line of a read-only dispatch: glyph + i18n key (+ the reason line's text when there is one). */
export function dispatchStatusLine(
  record: Pick<DispatchRecord, "status" | "decision_reason">,
  side: "sender" | "other"
): { glyph: string; key: string; reason: string | null } {
  const reason = dispatchReasonOf(record);
  if (side === "sender") {
    if (record.status === "PROPOSED") return { glyph: "◐", key: "officer_app.dispatch_status.waiting", reason };
    if (record.status === "APPROVED") return { glyph: "✓", key: "officer_app.dispatch_status.approved", reason };
    if (record.status === "REJECTED") return { glyph: "✕", key: "officer_app.dispatch_status.rejected", reason };
  }
  // Approved is not done: the receiving hall still executes it on the desk (Design 第四十批 O-f). The words carry their own ◐.
  if (record.status === "APPROVED") return { glyph: "", key: "officer_app.dispatch.awaiting_receiver", reason };
  // The same glyphs as the desk's detail (`app/dispatch/[id]/page.tsx`); 已取消 is its own word either way.
  const glyph = { PROPOSED: "◐", APPROVED: "✓", REJECTED: "✕", EXECUTED: "→", RETURNED: "↩", CANCELLED: "○" }[record.status as string] ?? "?";
  return { glyph, key: `dispatch.states.${record.status}`, reason };
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

// ── letters (待回书信) ─────────────────────────────────────────────────

/** Can this text go out as a reply: not blank, not longer than the server takes (`INBOX_REPLY_MAX`). */
export function replyReady(text: string): boolean {
  const body = text.trim();
  return body !== "" && body.length <= INBOX_REPLY_MAX;
}

/**
 * A chosen template goes INTO the box as plain text (the two known placeholders filled, nothing
 * rendered, nothing sent). An empty box takes it whole; text already typed keeps going, the template
 * after a blank line. Never longer than a reply may be.
 */
export function withTemplate(current: string, template: string, values: { soul_name: string; hall_name: string }): string {
  const filled = renderTemplate(template, values);
  return (current.trim() === "" ? filled : `${current}\n\n${filled}`).slice(0, INBOX_REPLY_MAX);
}

/** 503: the letters service is off or down. Not the officer's doing and nothing to retry at once: said quietly. */
export function lettersUnavailable(error: unknown): boolean {
  return statusOf(error) === 503;
}

/** Why a reply (or the thread) failed, as an i18n key. */
export function replyFailureKey(error: unknown): string {
  if (lettersUnavailable(error)) return "officer_app.letter.unavailable";
  if (statusOf(error) === 409) return "soul_inbox.errors.closed";
  return "officer_app.letter.failed";
}

// ── continue on desktop ────────────────────────────────────────────────

/** The desk's origin. A store build sets `EXPO_PUBLIC_DESK_URL`; the fallback is the local dev desk. */
export function deskBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_DESK_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * 忘记密码: the reset link in the e-mail lands on the DESK (`/reset-password`), so the new password is
 * chosen in the browser -- the app only sends the request. This is the way out for an address that
 * is not verified: the desk's 「通知管理员」 form.
 */
export function adminHelpUrl(): string {
  return deskBaseUrl() + "/login?help=1";
}

// ── account: forgot / change password, two-step verification ───────────

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } })?.response?.status;

/** Why the e-mail reset request failed: only 429 is told apart; no answer at all is the network. */
export function forgotFailureKey(error: unknown): string {
  if (!(error as { response?: unknown })?.response) return "officer_app.login.reasons.network";
  return statusOf(error) === 429 ? "auth.rate_limited" : "auth.forgot_failed";
}

/**
 * What a refused change-password says, by field, as i18n KEYS (`old`, `next`: one per reason --
 * the server's `new_password: [{code, message}]` is read by code, Django's English sentence is
 * never shown) -- never the password itself. `other` is a plain `detail` / `error` sentence.
 * `network` when there was no answer at all.
 */
export function passwordFailure(error: unknown): { network: boolean; old: string[]; next: string[]; other: string[] } {
  const response = (error as { response?: { data?: unknown } })?.response;
  if (!response) return { network: true, old: [], next: [], other: [] };
  const lines = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
  const body = (response.data && typeof response.data === "object" ? response.data : {}) as Record<string, unknown>;
  return {
    network: false,
    old: lines(body.old_password).length ? ["profile.password_old_wrong"] : [],
    next: passwordReasonKeys(body),
    other: [...lines(body.detail), ...lines(body.error)],
  };
}

/**
 * "Too common" and "too like your name" are the two refusals only the server can make; the password checklist says them
 * as one block (Design 第二十三批 §三), so they are split off the reasons that are shown one line each.
 */
export function splitCommonReasons(keys: string[]): { common: boolean; rest: string[] } {
  const isCommon = (key: string) => key === "profile.password_reason_common" || key === "profile.password_reason_similar";
  return { common: keys.some(isCommon), rest: keys.filter((key) => !isCommon(key)) };
}

/**
 * What a refused `officer-reset/confirm/` is, by its `code` (the server's sentence is never shown): `invalid`
 * (`reset_link_invalid` -- the server does not say whether the link expired, was used, or never existed),
 * `weak` with one i18n key per validator that refused, `rate` (429), `network` (no answer), else `other`.
 */
export type ResetFailure = { kind: "network" | "invalid" | "rate" | "other" } | { kind: "weak"; reasons: string[] };

export function resetFailure(error: unknown): ResetFailure {
  const response = (error as { response?: { status?: number; data?: { code?: unknown } } })?.response;
  if (!response) return { kind: "network" };
  if (response.data?.code === "reset_link_invalid") return { kind: "invalid" };
  if (response.data?.code === "weak_password") return { kind: "weak", reasons: passwordReasonKeys(response.data) };
  return { kind: response.status === 429 ? "rate" : "other" };
}

/** Why a two-step confirm / disable was refused, as an i18n key; `fallback` is the key for a plain refusal. */
export function mfaManageFailureKey(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { code?: string } } })?.response;
  if (!response) return "officer_app.mfa.reasons.network";
  if (statusOf(error) === 429 || response.data?.code === "locked") return "officer_app.mfa.reasons.locked";
  if (response.data?.code === "expired") return "mfa.verify.error_expired";
  return fallback;
}

/** The desk page for the same item. Pages that are lists (cooldown, rebirth) are the list itself. */
export function deskPath(target: { kind: ItemKind | "judgment" | "soul"; id: string }): string {
  switch (target.kind) {
    case "dispatch":
    case "approval":
    case "pick":
      return `/workflow/${target.id}`;
    case "reassignment":
      return `/dispatch/${target.id}`;
    case "cooldown":
    case "rebirth":
      return "/rebirth-applications";
    case "letter":
      return "/soul-inbox";
    case "sentence_change":
      return "/sentence-requests";
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
  return realmLabel(t, tenant?.code, tenant?.display_name ?? "") || undefined;
}

// ── 审判详情的操作区(Design 第三十四批 O-09) ─────────────────────────────

/**
 * 六种状态,主按钮一次只有一个。`closed`(已结案)不画操作区。
 * `reassignAsked`:已请求改派 —— 主要读服务端的 `reassign_requested_at`(认领人变了服务端就清);`reassignAsked` 只补撞到 429 而标记已清的那种情形。
 * 「待宣判」按此处原有的口径:案子还不是 `is_final`,手机上只能到电脑上继续。
 */
export type JudgmentActionState = "unclaimed" | "mine" | "deferred" | "reassign" | "other" | "desk" | "closed";

export function judgmentActionState(
  j: {
    claimed_by?: number | null;
    deferred_at?: string | null;
    concluded_at?: string | null;
    is_final?: boolean;
    reassign_requested_at?: string | null;
  },
  me: number | null,
  reassignAsked: boolean,
): JudgmentActionState {
  if (j.concluded_at) return "closed";
  if (j.claimed_by == null) return "unclaimed";
  if (j.claimed_by !== me) return "other";
  if (j.deferred_at) return "deferred";
  if (reassignAsked || j.reassign_requested_at) return "reassign";
  return j.is_final ? "mine" : "desk";
}

/** ⋯ 里有什么,按顺序(放回永远最后)。 */
export function judgmentMoreItems(state: JudgmentActionState): ("defer" | "request_reassign" | "release")[] {
  if (state === "mine" || state === "desk") return ["defer", "request_reassign", "release"];
  if (state === "deferred" || state === "reassign") return ["release"];
  return [];
}

/**
 * 别人手上的案子,本殿管理员(持 `judgment.assign`)的 ⋯(Design 第四十批 O-a),按顺序:
 * 改派给… · 替{name}放回 · 暂缓 / (已暂缓时)取消暂缓。四项都要理由,原经办人收到通知(服务端发)。
 */
export type AdminAction = "reassign_to" | "release_for" | "defer" | "undefer";

export function judgmentAdminItems(
  j: { claimed_by?: number | null; deferred_at?: string | null; concluded_at?: string | null },
  me: number | null,
  canAssign: boolean,
): AdminAction[] {
  if (!canAssign || j.concluded_at || j.claimed_by == null || j.claimed_by === me) return [];
  return ["reassign_to", "release_for", j.deferred_at ? "undefer" : "defer"];
}

/**
 * 改派的选人名单:现经办人不在里面;按手上件数从少到多(同数按名字);`q` 按名字筛。
 * `counts`:每一行都有件数才显示那一列 —— 取不到就整列不显示,不写 0。
 */
export function reassignCandidates<T extends { id: number; display_name: string; username: string; in_hand?: number | null }>(
  officers: readonly T[],
  holder: number | null | undefined,
  q: string,
): { rows: T[]; counts: boolean } {
  const needle = q.trim().toLowerCase();
  const name = (o: T) => o.display_name || o.username;
  const rows = officers
    .filter((o) => o.id !== holder && (needle === "" || name(o).toLowerCase().includes(needle) || o.username.toLowerCase().includes(needle)))
    .sort((a, b) => (a.in_hand ?? 0) - (b.in_hand ?? 0) || name(a).localeCompare(name(b)));
  return { rows, counts: officers.length > 0 && officers.every((o) => typeof o.in_hand === "number") };
}

/**
 * 查询框里像一个完整案号(`CN-2026-0042`:前缀 1–8 位字母数字、年份、至少四位序号,同 `format_case_number`)时,
 * 结果顶上多一组「案件」(Design 第四十批 O-d)。不自动跳转。
 */
export function looksLikeCaseNumber(q: string): boolean {
  return /^[A-Za-z0-9]{1,8}-\d{4}-\d{4,}$/.test(q.trim());
}

/** 理由必填:只有空白也算没写。 */
export function reasonBlank(reason: string): boolean {
  return reason.trim() === "";
}

// ── 通知类别(Design 第三十四批 O-06) ────────────────────────────────────

/** 这个角色看得到的类别(密码求助只有管理员收),顺序同网页。 */
export function visibleNotificationCategories(role: string | undefined): readonly NotificationCategory[] {
  return NOTIFICATION_CATEGORIES.filter((c) => c !== "password_help" || role === "ADMIN");
}

/** 手机上的开关 = 网页的「站内」一列;「静音 N 类」数的是站内关着的类别。必收的永远不算。 */
export function mutedCount(prefs: Partial<Record<NotificationCategory, { site?: boolean }>> | undefined, role: string | undefined): number {
  return visibleNotificationCategories(role).filter((c) => !NOTIFICATION_LOCKED[c]?.includes("site") && prefs?.[c]?.site === false).length;
}
