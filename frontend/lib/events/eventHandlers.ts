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
import {
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

export const EVENT_LABELS: Record<string, string> = {
  // Soul events
  SOUL_CREATED: "Soul created",
  SETTLEMENT_CORRECTED: "Settlement corrected",
  STATE_CHANGED: "Soul state changed",
  RECORD_ADDED: "Record added",
  JUDGMENT_INITIATED: "Judgment initiated",
  JUDGMENT_CONCLUDED: "Judgment concluded",
  DISPOSITION_CREATED: "Disposition created",
  REINCARNATION_TRIGGERED: "Reincarnation triggered",
  KARMA_RECALCULATED: "Balance recalculated",

  // Workflow events
  WORKFLOW_CREATED: "New workflow created",
  WORKFLOW_ASSIGNED: "Workflow assigned to you",
  WORKFLOW_APPROVED: "Workflow approved",
  WORKFLOW_REJECTED: "Workflow rejected",

  // Dispatch events
  DISPATCH_CREATED: "Dispatch proposed",
  DISPATCH_APPROVED: "Dispatch approved",
  DISPATCH_REJECTED: "Dispatch rejected",
  DISPATCH_EXECUTED: "Dispatch executed",
  DISPATCH_STATUS_CHANGED: "Dispatch status updated",

  // Death sync events
  DEATH_SYNC_RECEIVED: "Death registration received",
  DEATH_SYNC_PROCESSED: "Death registration processed",

  // Notification events
  NOTIFICATION_CREATED: "New notification",

  // Social events
  POST_CREATED: "New post",
  POST_UPDATED: "Post updated",
  POST_DELETED: "Post deleted",
  COMMENT_CREATED: "New comment",
  COMMENT_DELETED: "Comment deleted",
  REACTION_ADDED: "Reaction added",
  REACTION_REMOVED: "Reaction removed",
  USER_FOLLOWED: "New follower",
  USER_UNFOLLOWED: "Unfollowed",

  // Soul account events
  SOUL_ACCOUNT_CREATED: "Soul account opened",
  SOUL_ACCOUNT_RETIRED: "Soul account retired",
  REBIRTH_APPLICATION_SUBMITTED: "Rebirth application submitted",
  REBIRTH_STATUS_CHANGED: "Rebirth application updated",
  REBIRTH_CROSS_CIV_DECIDED: "Cross-civilization rebirth decided",

  // Sentence plan events (受刑计划)
  SENTENCE_PLAN_CREATED: "Sentence plan created",
  SENTENCE_NODE_ACTIVATED: "Sentence node started",
  SENTENCE_NODE_WAITING: "Sentence served, waiting for retrial",
  SENTENCE_NODE_COMPLETED: "Sentence node completed",
  SENTENCE_NODE_REFUSED: "Sentence dispatch refused",
  SENTENCE_PLAN_AMENDED: "Sentence plan amended",
  SENTENCE_REQUEST_CREATED: "Sentence plan request submitted",
  SENTENCE_REQUEST_DECIDED: "Sentence plan request decided",
  SENTENCE_PLAN_COMPLETED: "Sentence plan completed",
  SENTENCE_PLAN_CANCELLED: "Sentence plan cancelled",

  // Scheduler events
  SCHEDULER_RUN_FAILED: "Scheduled task run failed",
};

// ── Pure Handler Functions ─────────────────────────────────────────────

export function handleSoulCreated(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  const msg = `Soul created: ${payload.soul_name || ""}`;
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

  const label = EVENT_LABELS[payload.event] || "Workflow update";
  const soulName = payload.soul_name || "";
  const toastMsg = soulName ? `${label} — ${soulName}` : label;
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

  if (payload.notification) {
    const title = payload.notification.title || "New notification";
    const message = payload.notification.message || "";
    ctx.showToast(message ? `${title}: ${message}` : title, "info", 5000);
  }

  return {
    success: true,
    invalidatedKeys: ["notifications", "notifications-unread-count"],
  };
}

export function handleDispatchEvent(payload: DispatchEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["dispatch"] });

  const label = EVENT_LABELS[payload.event] || "Dispatch update";
  const soulName = payload.soul_name || "";
  const toastMsg = soulName ? `${label} — ${soulName}` : label;
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

export function handleDeathSyncEvent(payload: DeathSyncEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["death-sync"] });

  const label = EVENT_LABELS[payload.event] || "Death sync update";
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

  const label = EVENT_LABELS[payload.event] || "Social update";
  const name = payload.author_name || payload.soul_name || "";
  const toastMsg = name ? `${label} — ${name}` : label;
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
