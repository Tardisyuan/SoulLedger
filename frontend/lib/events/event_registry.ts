/**
 * Event-to-UI Mapping Layer — deterministic event → handler registry.
 *
 * Maps ALL backend EventBus events to pure UI handler functions.
 * Rules:
 *   - No event may be unhandled
 *   - All handlers are pure functions (no side effects beyond cache/toast)
 *   - Replay-safe: idempotent execution produces same result
 *   - Event drift detection: unknown events logged and tracked
 */

import type { QueryClient } from "@tanstack/react-query";

// ── Event Payload Types ────────────────────────────────────────────────

export interface BaseEventPayload {
  domain: string;
  event: string;
  tenant_code?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface SoulEventPayload extends BaseEventPayload {
  domain: "soul";
  soul_id: string;
  soul_name?: string;
}

export interface WorkflowEventPayload extends BaseEventPayload {
  domain: "workflow";
  workflow_id: string;
  workflow_name?: string;
  soul_name?: string;
  soul_id?: string;
  status?: string;
  verdict?: string;
  node_name?: string;
}

export interface NotificationEventPayload extends BaseEventPayload {
  domain: "notification";
  notification?: {
    id: number;
    title: string;
    message: string;
    notification_type: string;
    is_read: boolean;
    created_at: string;
    user_id: number;
  };
}

export interface DispatchEventPayload extends BaseEventPayload {
  domain: "dispatch";
  dispatch_id?: string;
  soul_name?: string;
  source_tenant?: string;
  target_tenant?: string;
  old_status?: string;
  new_status?: string;
}

export interface DeathSyncEventPayload extends BaseEventPayload {
  domain: "deathsync";
  registration_id?: string;
  source_system?: string;
  status?: string;
}

export interface SocialEventPayload extends BaseEventPayload {
  domain: "social";
  post_id?: string;
  comment_id?: string;
  reaction_type?: string;
  user_id?: string;
  author_name?: string;
  content?: string;
  follower_id?: string;
  following_id?: string;
}

export type EventPayload =
  | SoulEventPayload
  | WorkflowEventPayload
  | NotificationEventPayload
  | DispatchEventPayload
  | DeathSyncEventPayload
  | SocialEventPayload;

// ── Handler Type ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler = (
  payload: any,
  context: EventContext,
) => HandlerResult;

export interface EventContext {
  queryClient: QueryClient;
  showToast: (msg: string, type?: "success" | "error" | "info", duration?: number) => void;
}

// ── Handler Result (for replay safety) ─────────────────────────────────

export interface HandlerResult {
  /** Whether the handler executed successfully */
  success: boolean;
  /** Cache keys that were invalidated */
  invalidatedKeys: string[];
  /** Toast message shown (if any) */
  toastMessage?: string;
  /** Error if handler failed */
  error?: string;
}

// ── Event Labels ───────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  // Soul events
  SOUL_CREATED: "Soul created",
  STATE_CHANGED: "Soul state changed",
  RECORD_ADDED: "Record added",
  JUDGMENT_INITIATED: "Judgment initiated",
  JUDGMENT_CONCLUDED: "Judgment concluded",
  DISPOSITION_CREATED: "Disposition created",
  REINCARNATION_TRIGGERED: "Reincarnation triggered",
  KARMA_RECALCULATED: "Karma recalculated",

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

function handleSoulCreated(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
  const msg = `Soul created: ${payload.soul_name || ""}`;
  ctx.showToast(msg, "info", 5000);
  return { success: true, invalidatedKeys: ["souls"], toastMessage: msg };
}

function handleSoulStateChanged(payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
  if (payload.soul_id) {
    ctx.queryClient.invalidateQueries({ queryKey: ["souls", "detail", payload.soul_id] });
  }
  return { success: true, invalidatedKeys: ["souls"] };
}

function handleSoulEvent(_payload: SoulEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["souls"] });
  return { success: true, invalidatedKeys: ["souls"] };
}

function handleWorkflowEvent(payload: WorkflowEventPayload, ctx: EventContext): HandlerResult {
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

function handleNotificationEvent(payload: NotificationEventPayload, ctx: EventContext): HandlerResult {
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

function handleDispatchEvent(payload: DispatchEventPayload, ctx: EventContext): HandlerResult {
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

function handleDeathSyncEvent(payload: DeathSyncEventPayload, ctx: EventContext): HandlerResult {
  ctx.queryClient.invalidateQueries({ queryKey: ["death-sync"] });

  const label = EVENT_LABELS[payload.event] || "Death sync update";
  ctx.showToast(label, "info", 5000);

  return {
    success: true,
    invalidatedKeys: ["death-sync"],
    toastMessage: label,
  };
}

function handleSocialEvent(payload: SocialEventPayload, ctx: EventContext): HandlerResult {
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

function handleUnknownEvent(payload: EventPayload, ctx: EventContext): HandlerResult {
  const msg = `Unhandled event: ${payload.domain}.${payload.event}`;
  console.warn(`[EventRegistry] ${msg}`, payload);
  ctx.showToast(msg, "info", 3000);
  return { success: false, invalidatedKeys: [], error: msg };
}

// ── Event Registry ─────────────────────────────────────────────────────

/**
 * Domain → event_type → handler mapping.
 *
 * Structure:
 *   domain.event_type → handler function
 *
 * Fallback chain:
 *   1. domain.event_type (specific handler)
 *   2. domain.* (domain-wide handler)
 *   3. *.event_type (cross-domain handler)
 *   4. unknown event handler
 */
const EVENT_REGISTRY: Record<string, Record<string, EventHandler>> = {
  // Soul domain
  soul: {
    SOUL_CREATED: handleSoulCreated,
    STATE_CHANGED: handleSoulStateChanged,
    RECORD_ADDED: handleSoulEvent,
    JUDGMENT_INITIATED: handleSoulEvent,
    JUDGMENT_CONCLUDED: handleSoulEvent,
    DISPOSITION_CREATED: handleSoulEvent,
    REINCARNATION_TRIGGERED: handleSoulEvent,
    KARMA_RECALCULATED: handleSoulEvent,
  },

  // Workflow domain
  workflow: {
    WORKFLOW_CREATED: handleWorkflowEvent,
    WORKFLOW_ASSIGNED: handleWorkflowEvent,
    WORKFLOW_APPROVED: handleWorkflowEvent,
    WORKFLOW_REJECTED: handleWorkflowEvent,
  },

  // Notification domain
  notification: {
    NOTIFICATION_CREATED: handleNotificationEvent,
  },

  // Dispatch domain
  dispatch: {
    DISPATCH_CREATED: handleDispatchEvent,
    DISPATCH_APPROVED: handleDispatchEvent,
    DISPATCH_REJECTED: handleDispatchEvent,
    DISPATCH_EXECUTED: handleDispatchEvent,
    DISPATCH_STATUS_CHANGED: handleDispatchEvent,
  },

  // Death sync domain
  deathsync: {
    DEATH_SYNC_RECEIVED: handleDeathSyncEvent,
    DEATH_SYNC_PROCESSED: handleDeathSyncEvent,
  },

  // Social domain
  social: {
    POST_CREATED: handleSocialEvent,
    POST_UPDATED: handleSocialEvent,
    POST_DELETED: handleSocialEvent,
    COMMENT_CREATED: handleSocialEvent,
    COMMENT_DELETED: handleSocialEvent,
    REACTION_ADDED: handleSocialEvent,
    REACTION_REMOVED: handleSocialEvent,
    USER_FOLLOWED: handleSocialEvent,
    USER_UNFOLLOWED: handleSocialEvent,
  },
};

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Dispatch an event to the appropriate handler.
 *
 * @param payload - The event payload from the EventBus
 * @param context - QueryClient and showToast for UI updates
 * @returns HandlerResult with success status and invalidated keys
 */
export function dispatchEvent(
  payload: EventPayload,
  context: EventContext,
): HandlerResult {
  const { domain, event } = payload;

  // 1. Try domain-specific handler
  const domainHandlers = EVENT_REGISTRY[domain];
  if (domainHandlers) {
    const handler = domainHandlers[event];
    if (handler) {
      try {
        return handler(payload, context);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[EventRegistry] Handler error for ${domain}.${event}:`, errorMsg);
        return { success: false, invalidatedKeys: [], error: errorMsg };
      }
    }
  }

  // 2. Unknown event — log and show warning
  return handleUnknownEvent(payload, context);
}

/**
 * Get all registered event types for a domain.
 */
export function getRegisteredEvents(domain: string): string[] {
  return Object.keys(EVENT_REGISTRY[domain] || {});
}

/**
 * Get all registered domains.
 */
export function getRegisteredDomains(): string[] {
  return Object.keys(EVENT_REGISTRY);
}

/**
 * Check if an event type is registered.
 */
export function isEventRegistered(domain: string, event: string): boolean {
  return !!(EVENT_REGISTRY[domain]?.[event]);
}

/**
 * Get event label for display.
 */
export function getEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] || eventType;
}

// ── Event Drift Detection ──────────────────────────────────────────────

/**
 * Known event types from backend EventType enum.
 * Used to detect drift between frontend registry and backend events.
 */
export const BACKEND_EVENT_TYPES = [
  // Soul
  "SOUL_CREATED", "STATE_CHANGED", "RECORD_ADDED",
  "JUDGMENT_INITIATED", "JUDGMENT_CONCLUDED",
  "DISPOSITION_CREATED", "REINCARNATION_TRIGGERED", "KARMA_RECALCULATED",
  // Workflow
  "WORKFLOW_CREATED", "WORKFLOW_ASSIGNED", "WORKFLOW_APPROVED", "WORKFLOW_REJECTED",
  // Dispatch
  "DISPATCH_CREATED", "DISPATCH_APPROVED", "DISPATCH_REJECTED",
  "DISPATCH_EXECUTED", "DISPATCH_STATUS_CHANGED",
  // Death sync
  "DEATH_SYNC_RECEIVED", "DEATH_SYNC_PROCESSED",
  // Social (planned)
  "POST_CREATED", "POST_UPDATED", "POST_DELETED",
  "COMMENT_CREATED", "COMMENT_DELETED",
  "REACTION_ADDED", "REACTION_REMOVED",
  "USER_FOLLOWED", "USER_UNFOLLOWED",
  // Notification
  "NOTIFICATION_CREATED",
] as const;

/**
 * Check for event drift between frontend registry and backend events.
 */
export function detectEventDrift(): {
  missingInFrontend: string[];
  extraInFrontend: string[];
} {
  const registeredEvents = new Set<string>();
  for (const domain of Object.keys(EVENT_REGISTRY)) {
    for (const event of Object.keys(EVENT_REGISTRY[domain])) {
      registeredEvents.add(event);
    }
  }

  const backendSet = new Set<string>(BACKEND_EVENT_TYPES as readonly string[]);

  return {
    missingInFrontend: (BACKEND_EVENT_TYPES as readonly string[]).filter((e) => !registeredEvents.has(e)),
    extraInFrontend: [...registeredEvents].filter((e) => !backendSet.has(e)),
  };
}
