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
  socialKeys,
  soulKeys,
  workflowKeys,
} from "../query_keys";

import type {
  DeathSyncEventPayload,
  DispatchEventPayload,
  EventContext,
  EventPayload,
  HandlerResult,
  NotificationEventPayload,
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
};

// ── Pure Handler Functions ─────────────────────────────────────────────

export function handleSoulCreated(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  const msg = `Soul created: ${payload.soul_name || ""}`;
  ctx.showToast(msg, "info", 5000);
  return { success: true, invalidatedKeys: ["souls"], toastMessage: msg };
}

export function handleSoulStateChanged(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: soulKeys.all });
  if (payload.soul_id) {
    ctx.queryClient.invalidateQueries({ queryKey: soulKeys.detail(payload.soul_id) });
  }
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
  const toastType: "success" | "error" | "info" = ["DISPATCH_REJECTED", "DISPATCH_CANCELLED"].includes(payload.event)
    ? "error"
    : "info";
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

  // Toast for social events
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

export function handleUnknownEvent(payload: EventPayload, ctx: EventContext): HandlerResult {
  const msg = `Unhandled event: ${payload.domain}.${payload.event}`;
  console.warn(`[EventRegistry] ${msg}`, payload);
  ctx.showToast(msg, "info", 3000);
  return { success: false, invalidatedKeys: [], error: msg };
}
