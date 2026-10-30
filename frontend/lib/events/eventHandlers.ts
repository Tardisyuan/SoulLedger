/**
 * The pure handlers the registry dispatches to, and the label table they read.
 *
 * Split out of `event_registry.ts`: that file is now the TABLE — which event
 * reaches which handler — and this one is what the handlers DO. Keeping the two
 * apart is the point, because the failure this registry exists to catch is an
 * event with no row in the table, and a table is easier to read against the
 * backend's enum when it is not interleaved with two hundred lines of cache
 * invalidation.
 *
 * Nothing here is exported to the app at large: `event_registry` is still the
 * only public door, and `dispatchEvent` is still the only way in.
 *
 * KEYS THAT HAVE A FACTORY COME FROM `lib/query_keys.ts`. They used to be
 * retyped as literals here, and four of them did not match the key the cache
 * actually used:
 *
 *   handler asked for                        cache was actually at
 *   ["social","comments","post",id]          ["social","comments","list",{post:id}]
 *   ["social","reactions","post",id]         ["social","reactions",{post:id}]
 *   ["social","follows","followers",id]      ["social","follows","followers"]
 *   ["social","profile",id]                  ["social","profiles","detail",id]
 *
 * `invalidateQueries` matches by PREFIX, so a key that diverges at any segment
 * — or that is merely LONGER than the cached one, as the follows pair was —
 * matches nothing and fails silently. Comment threads, reaction counts, follow
 * lists and profile pages did not update on a push. The registry's contract
 * says no event may go unhandled; these were handled into a void, which is
 * worse, because the unhandled path at least warns.
 *
 * The social keys now mirror what the local mutations in `useSocial.ts` do —
 * `comments.all`, `reactions.all`, `follows.all`, `profiles.all`. That is not
 * a coincidence to preserve but the point: the optimistic path and the realtime
 * path should invalidate the same thing, and the local one is known to work.
 *
 * TWO KEYS ARE STILL LITERALS: `["dispatch"]` and `["death-sync"]`, because
 * neither family has a factory yet. Both are correct today — every dispatch
 * and death-sync page keys under the same first segment, so the one-segment
 * key prefix-matches all of them — but correct by coincidence of spelling,
 * which is precisely how the four above went wrong. They are the next two to
 * convert, not an exception to the rule.
 */
import { getLocale } from "@soulledger/core/platform";
import { translate } from "@/lib/i18n/activeTranslator";
import {
  dispositionKeys,
  notificationKeys,
  schedulerKeys,
  socialKeys,
  soulKeys,
  workflowKeys,
} from "@soulledger/core/query_keys";

import type {
  DeathSyncEventPayload,
  DispatchEventPayload,
  EventContext,
  EventPayload,
  HandlerResult,
  NotificationEventPayload,
  SchedulerEventPayload,
  SocialEventPayload,
  SoulEventPayload,
  WorkflowEventPayload,
} from "./eventTypes";

// ── Event Labels ───────────────────────────────────────────────────────

/**
 * Event type → message KEY, not copy (2026-10-29). The values used to be English strings shown as
 * they were in every locale. Backend event types reuse the soul timeline's `souls.events.<TYPE>`
 * (one word per event across the app); the realtime-only ones live in `events.realtime.<TYPE>`.
 * `tests/test_frontend_event_types_track_the_backend.py` still reads the keys of this table.
 */
export const EVENT_LABELS: Record<string, string> = {
  // Soul events
  SOUL_CREATED: "souls.events.SOUL_CREATED",
  SETTLEMENT_CORRECTED: "souls.events.SETTLEMENT_CORRECTED",
  STATE_CHANGED: "souls.events.STATE_CHANGED",
  RECORD_ADDED: "souls.events.RECORD_ADDED",
  JUDGMENT_INITIATED: "souls.events.JUDGMENT_INITIATED",
  JUDGMENT_CONCLUDED: "souls.events.JUDGMENT_CONCLUDED",
  DISPOSITION_CREATED: "souls.events.DISPOSITION_CREATED",
  DISPOSITION_EXPIRED: "souls.events.DISPOSITION_EXPIRED",
  REINCARNATION_TRIGGERED: "souls.events.REINCARNATION_TRIGGERED",
  REINCARNATION_COMPLETED: "souls.events.REINCARNATION_COMPLETED",
  KARMA_RECALCULATED: "souls.events.KARMA_RECALCULATED",

  // Workflow events
  WORKFLOW_CREATED: "souls.events.WORKFLOW_CREATED",
  WORKFLOW_ASSIGNED: "souls.events.WORKFLOW_ASSIGNED",
  WORKFLOW_APPROVED: "souls.events.WORKFLOW_APPROVED",
  WORKFLOW_REJECTED: "souls.events.WORKFLOW_REJECTED",

  // Dispatch events
  DISPATCH_CREATED: "souls.events.DISPATCH_CREATED",
  DISPATCH_APPROVED: "souls.events.DISPATCH_APPROVED",
  DISPATCH_REJECTED: "souls.events.DISPATCH_REJECTED",
  DISPATCH_EXECUTED: "souls.events.DISPATCH_EXECUTED",
  DISPATCH_STATUS_CHANGED: "souls.events.DISPATCH_STATUS_CHANGED",

  // Death sync events
  DEATH_SYNC_RECEIVED: "souls.events.DEATH_SYNC_RECEIVED",
  DEATH_SYNC_PROCESSED: "souls.events.DEATH_SYNC_PROCESSED",

  // Notification events
  NOTIFICATION_CREATED: "events.realtime.NOTIFICATION_CREATED",

  // Social events
  POST_CREATED: "events.realtime.POST_CREATED",
  POST_UPDATED: "events.realtime.POST_UPDATED",
  POST_DELETED: "events.realtime.POST_DELETED",
  COMMENT_CREATED: "events.realtime.COMMENT_CREATED",
  COMMENT_DELETED: "events.realtime.COMMENT_DELETED",
  REACTION_ADDED: "events.realtime.REACTION_ADDED",
  REACTION_REMOVED: "events.realtime.REACTION_REMOVED",
  USER_FOLLOWED: "events.realtime.USER_FOLLOWED",
  USER_UNFOLLOWED: "events.realtime.USER_UNFOLLOWED",

  // Soul account events
  SOUL_ACCOUNT_CREATED: "souls.events.SOUL_ACCOUNT_CREATED",
  SOUL_ACCOUNT_RETIRED: "souls.events.SOUL_ACCOUNT_RETIRED",
  REBIRTH_APPLICATION_SUBMITTED: "souls.events.REBIRTH_APPLICATION_SUBMITTED",
  REBIRTH_STATUS_CHANGED: "souls.events.REBIRTH_STATUS_CHANGED",
  REBIRTH_CROSS_CIV_DECIDED: "souls.events.REBIRTH_CROSS_CIV_DECIDED",
  COOLDOWN_SHORTENING_DECIDED: "souls.events.COOLDOWN_SHORTENING_DECIDED",

  // Sentence plan events (受刑计划)
  SENTENCE_PLAN_CREATED: "souls.events.SENTENCE_PLAN_CREATED",
  SENTENCE_NODE_ACTIVATED: "souls.events.SENTENCE_NODE_ACTIVATED",
  SENTENCE_NODE_WAITING: "souls.events.SENTENCE_NODE_WAITING",
  SENTENCE_NODE_COMPLETED: "souls.events.SENTENCE_NODE_COMPLETED",
  SENTENCE_NODE_REFUSED: "souls.events.SENTENCE_NODE_REFUSED",
  SENTENCE_NODE_REDISPATCHED: "souls.events.SENTENCE_NODE_REDISPATCHED",
  SENTENCE_PLAN_AMENDED: "souls.events.SENTENCE_PLAN_AMENDED",
  SENTENCE_REQUEST_CREATED: "souls.events.SENTENCE_REQUEST_CREATED",
  SENTENCE_REQUEST_DECIDED: "souls.events.SENTENCE_REQUEST_DECIDED",
  SENTENCE_PLAN_COMPLETED: "souls.events.SENTENCE_PLAN_COMPLETED",
  SENTENCE_PLAN_CANCELLED: "souls.events.SENTENCE_PLAN_CANCELLED",

  // Judgment appeal events (申诉)
  JUDGMENT_APPEAL_FILED: "souls.events.JUDGMENT_APPEAL_FILED",
  JUDGMENT_APPEAL_WITHDRAWN: "souls.events.JUDGMENT_APPEAL_WITHDRAWN",
  JUDGMENT_APPEAL_DECIDED: "souls.events.JUDGMENT_APPEAL_DECIDED",

  // City god events (城隍初审)
  CITY_GOD_RECEIVED: "souls.events.CITY_GOD_RECEIVED",
  CITY_GOD_SENT_ON: "souls.events.CITY_GOD_SENT_ON",
  CITY_GOD_RETURNED: "souls.events.CITY_GOD_RETURNED",

  // Mengpo soup (孟婆汤)
  MENGPO_SOUP_TAKEN: "souls.events.MENGPO_SOUP_TAKEN",

  // Purgatory → heaven (欧洲, 2026-10-27)
  PURGATORY_ASCENDED: "souls.events.PURGATORY_ASCENDED",

  // Officer handover / Duat passage (2026-10-27)
  OFFICER_HANDOVER: "souls.events.OFFICER_HANDOVER",
  DUAT_PASSAGE_CHANGED: "souls.events.DUAT_PASSAGE_CHANGED",

  // Diyu thirteen stations / capture warrants (2026-10-28)
  DIYU_STATION_CHANGED: "souls.events.DIYU_STATION_CHANGED",
  CAPTURE_WARRANT_ISSUED: "souls.events.CAPTURE_WARRANT_ISSUED",
  SOUL_CAPTURED: "souls.events.SOUL_CAPTURED",
  CAPTURE_HANDED_OVER: "souls.events.CAPTURE_HANDED_OVER",
  CAPTURE_WARRANT_CANCELLED: "souls.events.CAPTURE_WARRANT_CANCELLED",

  // 枉死城 grievances (2026-10-28)
  WANGSI_GRIEVANCE_FILED: "souls.events.WANGSI_GRIEVANCE_FILED",
  WANGSI_GRIEVANCE_UPHELD: "souls.events.WANGSI_GRIEVANCE_UPHELD",
  WANGSI_GRIEVANCE_REJECTED: "souls.events.WANGSI_GRIEVANCE_REJECTED",
  WANGSI_GRIEVANCE_DELIVERED: "souls.events.WANGSI_GRIEVANCE_DELIVERED",

  // Egyptian negative confession: one summary per full round (2026-10-29)
  NEGATIVE_CONFESSION_HEARD: "souls.events.NEGATIVE_CONFESSION_HEARD",

  // Scheduler events
  SCHEDULER_RUN_FAILED: "events.realtime.SCHEDULER_RUN_FAILED",
};

/** The event's label in the current locale; `fallbackKey` (or null) for a type with no row. */
export function eventLabel(event: string, fallbackKey: string): string;
export function eventLabel(event: string): string | null;
export function eventLabel(event: string, fallbackKey?: string): string | null {
  const key = EVENT_LABELS[event] ?? fallbackKey;
  return key ? translate(key) : null;
}

/** `label — name`, or the label alone when the frame carried no name. */
const withName = (label: string, name?: unknown) => (name ? `${label} — ${String(name)}` : label);

// ── Pure Handler Functions ─────────────────────────────────────────────

export function handleSoulCreated(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  const msg = withName(eventLabel("SOUL_CREATED", "souls.events.SOUL_CREATED"), payload.soul_name);
  ctx.showToast(msg, "info", 5000);
  return { success: true, invalidatedKeys: ["souls"], toastMessage: msg };
}

export function handleSoulStateChanged(_payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  // `soulKeys.detail(id)` is `[...soulKeys.all, "detail", id]` — a prefix
  // extension of `soulKeys.all`. `invalidateQueries` matches by prefix (default
  // `exact: false`), so invalidating `all` already covers every `detail(id)`;
  // a separate call for `payload.soul_id` was redundant.
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  return { success: true, invalidatedKeys: ["souls"] };
}

export function handleSoulEvent(_payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  return { success: true, invalidatedKeys: ["souls"] };
}

/** 处置生成 / 期满:灵魂的时间线之外,处置列表(/disposition 的三段)也变了 —— 它在另一个键族下。 */
export function handleDispositionEvent(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  handleSoulEvent(payload, ctx);
  ctx.queryClient.invalidateQueries({ queryKey: dispositionKeys.all });
  return { success: true, invalidatedKeys: ["souls", "dispositions"] };
}

export function handleWorkflowEvent(payload: WorkflowEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: workflowKeys.all });
  if (payload.workflow_id) {
    ctx.queryClient.invalidateQueries({
      queryKey: workflowKeys.detail(payload.workflow_id),
    });
  }
  if (payload.soul_id) {
    ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  }

  const toastMsg = withName(eventLabel(payload.event, "events.realtime.fallback_workflow"), payload.soul_name);
  const toastType: "success" | "error" | "info" = payload.event === "WORKFLOW_REJECTED" ? "error" : "info";
  ctx.showToast(toastMsg, toastType, 6000);

  return {
    success: true,
    invalidatedKeys: ["workflows", "souls"],
    toastMessage: toastMsg,
  };
}

export function handleNotificationEvent(payload: NotificationEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  ctx.queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });

  // 个人通知只弹给收件人本人。后端已只发收件人的用户组(2026-10-29 之前同殿每个官员都收到),
  // 这里再按 user_id 对一次:不知道当前用户或对不上就不弹。
  // 两种格式:`{notification: {...}}`(`publish_notification`)与扁平的(`EventService.notify_user`,站内多数通知走它)。
  const body = payload.notification ?? (payload.user_id !== undefined ? payload : undefined);
  if (body && String(body.user_id) === ctx.currentUserId) {
    // 后端把各语言的渲染一起推来(`i18n`),按当前语言取;没有(旧通知、未分语言的类型)就用存下来的原文。
    const text = body.i18n?.[getLocale()];
    const title = text?.title || body.title || translate("events.realtime.NOTIFICATION_CREATED");
    const message = text?.message ?? body.message ?? "";
    ctx.showToast(message ? `${title}: ${message}` : title, "info", 5000);
  }

  return {
    success: true,
    invalidatedKeys: ["notifications", "notifications-unread-count"],
  };
}

export function handleDispatchEvent(payload: DispatchEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["dispatch"] });

  const toastMsg = withName(eventLabel(payload.event, "events.realtime.fallback_dispatch"), payload.soul_name);
  // `DISPATCH_CANCELLED` is not a registered event (see `event_registry.ts` —
  // the table has CREATED/APPROVED/REJECTED/EXECUTED/STATUS_CHANGED only, and
  // the backend never emits it either), so checking for it here was dead.
  const toastType: "success" | "error" | "info" =
    payload.event === "DISPATCH_REJECTED" ? "error" : "info";
  ctx.showToast(toastMsg, toastType, 6000);

  return {
    success: true,
    invalidatedKeys: ["dispatch"],
    toastMessage: toastMsg,
  };
}

/**
 * A dispatch's own timeline event (backend `DispatchService`, domain "dispatch", event `STATE_CHANGED` with
 * `action` = DISPATCH_PROPOSED / APPROVED / REJECTED / EXECUTED / CANCELLED / RETURNED / RETURN_BLOCKED; on the
 * bus since 2026-10-30). Silent: the dispatch list and the soul's timeline refresh; the people it concerns
 * already get an in-app notification, so a toast here would say it twice.
 */
export function handleDispatchStateChanged(_payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["dispatch"] });
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  return { success: true, invalidatedKeys: ["dispatch", "souls"] };
}

export function handleDeathSyncEvent(payload: DeathSyncEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["death-sync"] });

  const label = eventLabel(payload.event, "events.realtime.fallback_death_sync");
  ctx.showToast(label, "info", 5000);

  return {
    success: true,
    invalidatedKeys: ["death-sync"],
    toastMessage: label,
  };
}

export function handleSocialEvent(payload: SocialEventPayload, ctx: EventContext): HandlerResult {
  const invalidated: string[] = [];

  // Invalidate post queries
  if (["POST_CREATED", "POST_UPDATED", "POST_DELETED"].includes(payload.event)) {
    ctx.queryClient.invalidateQueries({ queryKey: socialKeys.posts.all });
    invalidated.push("social.posts");
  }

  // Invalidate comment queries
  if (["COMMENT_CREATED", "COMMENT_DELETED"].includes(payload.event)) {
    // `comments.all`, not a per-post key. Threads cache under
    // `comments.list({ post })`, so the id lives inside an object in the
    // fourth segment, not as a segment of its own — the per-post key this
    // used to build could never match one. Invalidating the family is what
    // `useCreateComment` does locally, and at most a couple of threads are
    // ever cached.
    ctx.queryClient.invalidateQueries({ queryKey: socialKeys.comments.all });
    ctx.queryClient.invalidateQueries({ queryKey: socialKeys.posts.all });
    invalidated.push("social.comments", "social.posts");
  }

  // Invalidate reaction queries
  if (["REACTION_ADDED", "REACTION_REMOVED"].includes(payload.event)) {
    // Same shape as comments: reaction lists cache under
    // `[...reactions.all, params]` with the post id inside `params`.
    ctx.queryClient.invalidateQueries({ queryKey: socialKeys.reactions.all });
    if (payload.post_id) {
      ctx.queryClient.invalidateQueries({
        queryKey: socialKeys.posts.detail(payload.post_id),
      });
    }
    invalidated.push("social.reactions");
  }

  // Invalidate follow queries
  if (["USER_FOLLOWED", "USER_UNFOLLOWED"].includes(payload.event)) {
    // The follows caches are the CURRENT USER's two lists and carry no id
    // (`follows.following` / `follows.followers`), so there is no per-side key
    // to build: the old code appended the id and produced keys LONGER than the
    // cached ones, which prefix-matching can never reach. Both sides of the
    // relationship land on the same family.
    ctx.queryClient.invalidateQueries({ queryKey: socialKeys.follows.all });
    for (const userId of [payload.following_id, payload.follower_id]) {
      if (userId) {
        ctx.queryClient.invalidateQueries({ queryKey: socialKeys.profiles.detail(userId) });
      }
    }
    invalidated.push("social.follows", "social.profiles");
  }

  // Toast only what is about the person looking at the screen.
  //
  // This used to fire on every social frame, so a busy tenant meant a banner
  // per post, comment and reaction, for every signed-in user. The only social
  // event whose payload identifies its target is a follow — `following_id` is
  // the person BEING followed — so that is the only one that can be aimed.
  // See EventContext.currentUserId for why the rest cannot be, and note that
  // the cache invalidation above is unconditional either way: the feed still
  // updates in real time, it just stops interrupting.
  const aimedAtViewer =
    ["USER_FOLLOWED", "USER_UNFOLLOWED"].includes(payload.event) &&
    ctx.currentUserId !== undefined &&
    payload.following_id === ctx.currentUserId;

  if (!aimedAtViewer) {
    return { success: true, invalidatedKeys: invalidated };
  }

  const toastMsg = withName(
    eventLabel(payload.event, "events.realtime.fallback_social"),
    payload.author_name || payload.soul_name
  );
  ctx.showToast(toastMsg, "info", 4000);

  return {
    success: true,
    invalidatedKeys: invalidated,
    toastMessage: toastMsg,
  };
}

/**
 * All four scheduler events invalidate the whole scheduler root, silently.
 * (The failure toast is the scheduler page's, off RUN_UPDATED — see
 * app/scheduler/page.tsx — so it shows only where the rows are.)
 *
 * Silently: a 5-minutely job emits a RUNNING and a SUCCESS every 5 minutes for
 * every ADMIN; a toast per frame would bury the page. The page's rows are the
 * notification. The whole root rather than per-event keys: a run changes both
 * the job row's `last_run` and the runs list, and the drawer's list is keyed by
 * filters the handler cannot know. At most a jobs array and a few run pages are
 * ever cached, and nothing is cached at all unless /scheduler is open.
 */
export function handleSchedulerEvent(_payload: SchedulerEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: schedulerKeys.all });
  return { success: true, invalidatedKeys: ["scheduler"] };
}

export function handleUnknownEvent(payload: EventPayload, _ctx: EventContext): HandlerResult {
  // Logged, not toasted. "Unhandled event: social.SOMETHING_NEW" is a message
  // to whoever forgot the registry row; to an operator it is untranslated
  // debug text appearing over their work, about a fault they cannot act on.
  // The `error` in the return value is how the caller — and the drift
  // detector — still learn about it.
  const msg = `Unhandled event: ${payload.domain}.${payload.event}`;
  console.warn(`[EventRegistry] ${msg}`, payload);
  return { success: false, invalidatedKeys: [], error: msg };
}
