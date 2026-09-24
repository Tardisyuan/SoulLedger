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
  handleSchedulerEvent,
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
  SchedulerEventPayload,
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
    // The daily expiry check (backend apps/disposition/expiry.py).
    DISPOSITION_EXPIRED: handleSoulEvent,
    REINCARNATION_TRIGGERED: handleSoulEvent,
    KARMA_RECALCULATED: handleSoulEvent,
    // `Soul.correct_settlement` writes this. Without a handler it fell to
    // `handleUnknownEvent`, which shows a bare English toast and **invalidates
    // nothing** -- so a corrected settlement left the timeline showing the
    // superseded state, which is precisely what the event was added to
    // prevent (see the docstring on that method).
    SETTLEMENT_CORRECTED: handleSoulStateChanged,
    // Soul accounts & rebirth applications (apps/soul_accounts). They land on
    // the soul's timeline, so they invalidate what handleSoulEvent invalidates.
    SOUL_ACCOUNT_CREATED: handleSoulEvent,
    SOUL_ACCOUNT_RETIRED: handleSoulEvent,
    REBIRTH_APPLICATION_SUBMITTED: handleSoulEvent,
    REBIRTH_STATUS_CHANGED: handleSoulEvent,
    REBIRTH_CROSS_CIV_DECIDED: handleSoulEvent,
    // 受刑计划(docs/ARCHITECTURE-sentence-plan.md,Q9)。阶段 1 只声明,后端没有路径写入;
    // 落在灵魂时间线上,与上面几种同样处理。
    SENTENCE_PLAN_CREATED: handleSoulEvent,
    SENTENCE_NODE_ACTIVATED: handleSoulEvent,
    SENTENCE_NODE_WAITING: handleSoulEvent,
    SENTENCE_NODE_COMPLETED: handleSoulEvent,
    SENTENCE_NODE_REFUSED: handleSoulEvent,
    SENTENCE_PLAN_AMENDED: handleSoulEvent,
    SENTENCE_REQUEST_CREATED: handleSoulEvent,
    SENTENCE_REQUEST_DECIDED: handleSoulEvent,
    SENTENCE_PLAN_COMPLETED: handleSoulEvent,
    SENTENCE_PLAN_CANCELLED: handleSoulEvent,
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

  // Scheduler domain (backend/apps/scheduler/realtime.py)
  scheduler: {
    SCHEDULER_RUN_UPDATED: handleSchedulerEvent,
    SCHEDULER_JOB_UPDATED: handleSchedulerEvent,
    SCHEDULER_JOBS_REBUILT: handleSchedulerEvent,
    // The EventType member (tenant runs that reached FAILURE / LOST); on the
    // socket it arrives next to the RUN_UPDATED frame for the same save, so it
    // only refreshes — the scheduler page toasts off RUN_UPDATED.
    SCHEDULER_RUN_FAILED: handleSchedulerEvent,
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
  "SOUL_CREATED",
  // Emitted by Soul.correct_settlement (apps/souls/models.py). It was
  // missing from this list, from EVENT_REGISTRY.soul and from all three
  // bundles -- and `detectEventDrift()` uses THIS list as its picture of the
  // backend, so the detector was structurally unable to see its own gap.
  "SETTLEMENT_CORRECTED", "STATE_CHANGED", "RECORD_ADDED",
  "JUDGMENT_INITIATED", "JUDGMENT_CONCLUDED",
  "DISPOSITION_CREATED", "DISPOSITION_EXPIRED", "REINCARNATION_TRIGGERED", "KARMA_RECALCULATED",
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
  // Soul accounts
  "SOUL_ACCOUNT_CREATED", "SOUL_ACCOUNT_RETIRED",
  "REBIRTH_APPLICATION_SUBMITTED", "REBIRTH_STATUS_CHANGED",
  "REBIRTH_CROSS_CIV_DECIDED",
  // Sentence plans (受刑计划)
  "SENTENCE_PLAN_CREATED",
  "SENTENCE_NODE_ACTIVATED",
  "SENTENCE_NODE_WAITING",
  "SENTENCE_NODE_COMPLETED",
  "SENTENCE_NODE_REFUSED",
  "SENTENCE_PLAN_AMENDED",
  "SENTENCE_REQUEST_CREATED",
  "SENTENCE_REQUEST_DECIDED",
  "SENTENCE_PLAN_COMPLETED",
  "SENTENCE_PLAN_CANCELLED",
  // Scheduler (only the failure is an EventType; see REALTIME_ONLY below)
  "SCHEDULER_RUN_FAILED",
] as const;

/**
 * Events the backend publishes on the realtime bus by string, which are NOT
 * members of `apps.events.models.EventType` — so they cannot go in the array
 * above, whose backend contract test (`test_frontend_event_types_track_the_
 * backend.py`) rejects anything the enum lacks.
 *
 * Not an exemption list: the authority for these is
 * `backend/apps/scheduler/realtime.py`'s module constants, and
 * `eventRegistry.test.ts` reads that file and requires this array to equal
 * them. Whether they should also become EventType members (the route
 * NOTIFICATION_CREATED took) is a backend decision, raised in the 2026-09-17
 * scheduler frontend report.
 */
export const REALTIME_ONLY_EVENT_TYPES = [
  "SCHEDULER_RUN_UPDATED",
  "SCHEDULER_JOB_UPDATED",
  "SCHEDULER_JOBS_REBUILT",
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

  const backendEvents: readonly string[] = [...BACKEND_EVENT_TYPES, ...REALTIME_ONLY_EVENT_TYPES];
  const backendSet = new Set<string>(backendEvents);

  return {
    missingInFrontend: backendEvents.filter((e) => !registeredEvents.has(e)),
    extraInFrontend: [...registeredEvents].filter((e) => !backendSet.has(e)),
  };
}
