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
 */
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
  ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
  const msg = `Soul created: ${payload.soul_name || ""}`;
  ctx.showToast(msg, "info", 5000);
  return { success: true, invalidatedKeys: ["souls"], toastMessage: msg };
}

export function handleSoulStateChanged(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
  if (payload.soul_id) {
    ctx.queryClient.invalidateQueries({ queryKey: ["souls", "detail", payload.soul_id] });
  }
  return { success: true, invalidatedKeys: ["souls"] };
}

export function handleSoulEvent(_payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
  return { success: true, invalidatedKeys: ["souls"] };
}

export function handleWorkflowEvent(payload: WorkflowEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["workflows"] });
  if (payload.workflow_id) {
    ctx.queryClient.invalidateQueries({
      queryKey: ["workflows", "detail", payload.workflow_id],
    });
  }
  if (payload.soul_id) {
    ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
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
  ctx.queryClient.invalidateQueries({ queryKey: ["notifications"] });
  ctx.queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });

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
    ctx.queryClient.invalidateQueries({ queryKey: ["social", "posts"] });
    invalidated.push("social.posts");
  }

  // Invalidate comment queries
  if (["COMMENT_CREATED", "COMMENT_DELETED"].includes(payload.event)) {
    if (payload.post_id) {
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "comments", "post", payload.post_id],
      });
    }
    ctx.queryClient.invalidateQueries({ queryKey: ["social", "posts"] });
    invalidated.push("social.comments", "social.posts");
  }

  // Invalidate reaction queries
  if (["REACTION_ADDED", "REACTION_REMOVED"].includes(payload.event)) {
    if (payload.post_id) {
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "reactions", "post", payload.post_id],
      });
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "posts", "detail", payload.post_id],
      });
    }
    invalidated.push("social.reactions");
  }

  // Invalidate follow queries
  if (["USER_FOLLOWED", "USER_UNFOLLOWED"].includes(payload.event)) {
    if (payload.following_id) {
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "follows", "followers", payload.following_id],
      });
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "profile", payload.following_id],
      });
    }
    if (payload.follower_id) {
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "follows", "following", payload.follower_id],
      });
      ctx.queryClient.invalidateQueries({
        queryKey: ["social", "profile", payload.follower_id],
      });
    }
    invalidated.push("social.follows", "social.profile");
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
