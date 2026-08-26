/**
 * Event-to-UI Mapping Layer — deterministic event → handler registry.
 *
 * Maps ALL backend EventBus events to pure UI handler functions.
 * Rules:
 *   - No event may be unhandled
 *   - All handlers are pure functions (no side effects beyond cache/toast)
 *   - Replay-safe: idempotent execution produces same result
 *   - Event drift detection: unknown events logged and tracked
 *
 * The payload/handler types live in `./eventTypes` and the handler bodies in
 * `./eventHandlers`. Both are re-exported below, so this module is still the
 * single import path every caller uses and no consumer had to change.
 */

import {
  EVENT_LABELS,
  handleDeathSyncEvent,
  handleDispatchEvent,
  handleNotificationEvent,
  handleSocialEvent,
  handleSoulCreated,
  handleSoulEvent,
  handleSoulStateChanged,
  handleUnknownEvent,
  handleWorkflowEvent,
} from "./eventHandlers";
import type { EventContext, EventHandler, EventPayload, HandlerResult } from "./eventTypes";

export type {
  BaseEventPayload,
  DeathSyncEventPayload,
  DispatchEventPayload,
  EventContext,
  EventHandler,
  EventPayload,
  HandlerResult,
  NotificationEventPayload,
  SocialEventPayload,
  SoulEventPayload,
  WorkflowEventPayload,
} from "./eventTypes";


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
