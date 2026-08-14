/**
 * Tests for lib/events/event_registry.ts — the event → UI mapping layer.
 *
 * Every realtime frame the app receives lands here. A handler that stops
 * invalidating a cache key produces a stale screen with no error, so the
 * assertions below pin the exact query keys each event invalidates, the
 * toast severity, and — importantly — the keys each event must *not* touch.
 */
import {
  dispatchEvent,
  detectEventDrift,
  getEventLabel,
  getRegisteredDomains,
  getRegisteredEvents,
  isEventRegistered,
  BACKEND_EVENT_TYPES,
  type EventContext,
  type EventPayload,
} from "@/lib/events/event_registry";
import type { QueryClient } from "@tanstack/react-query";

function makeContext() {
  const invalidateQueries = jest.fn();
  const showToast = jest.fn();
  const ctx = {
    queryClient: { invalidateQueries } as unknown as QueryClient,
    showToast,
  } satisfies EventContext;
  return { ctx, invalidateQueries, showToast };
}

/** All query keys the handler invalidated, as JSON for easy comparison. */
function invalidatedKeys(invalidateQueries: jest.Mock): string[] {
  return invalidateQueries.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));
}

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

// ── Soul domain ──────────────────────────────────────────────────────

describe("soul events", () => {
  it("invalidates the soul list and toasts the name on SOUL_CREATED", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent(
      { domain: "soul", event: "SOUL_CREATED", soul_id: "s1", soul_name: "Meng" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]']);
    expect(showToast).toHaveBeenCalledWith("Soul created: Meng", "info", 5000);
    expect(result).toEqual({
      success: true,
      invalidatedKeys: ["souls"],
      toastMessage: "Soul created: Meng",
    });
  });

  it("invalidates the specific soul detail on STATE_CHANGED", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "soul", event: "STATE_CHANGED", soul_id: "s7" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]', '["souls","detail","s7"]']);
  });

  it("skips the detail invalidation when STATE_CHANGED carries no soul_id", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "soul", event: "STATE_CHANGED" } as unknown as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]']);
  });

  it("does not toast for a silent soul event like RECORD_ADDED", () => {
    const { ctx, showToast } = makeContext();

    const result = dispatchEvent(
      { domain: "soul", event: "RECORD_ADDED", soul_id: "s1" } as EventPayload,
      ctx,
    );

    expect(showToast).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.toastMessage).toBeUndefined();
  });
});

// ── Workflow domain ──────────────────────────────────────────────────

describe("workflow events", () => {
  it("invalidates workflow list, workflow detail and souls when a soul is attached", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      {
        domain: "workflow",
        event: "WORKFLOW_APPROVED",
        workflow_id: "w1",
        soul_id: "s1",
        soul_name: "Li",
      } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["workflows"]',
      '["workflows","detail","w1"]',
      '["souls"]',
    ]);
  });

  it("leaves the soul cache alone when the workflow event has no soul_id", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "workflow", event: "WORKFLOW_CREATED", workflow_id: "w1" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).not.toContain('["souls"]');
  });

  it("raises a rejection as an error toast, not an info toast", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      {
        domain: "workflow",
        event: "WORKFLOW_REJECTED",
        workflow_id: "w1",
        soul_name: "Li",
      } as EventPayload,
      ctx,
    );

    expect(showToast).toHaveBeenCalledWith("Workflow rejected — Li", "error", 6000);
  });

  it("uses info severity for an approval", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      { domain: "workflow", event: "WORKFLOW_APPROVED", workflow_id: "w1" } as EventPayload,
      ctx,
    );

    expect(showToast).toHaveBeenCalledWith("Workflow approved", "info", 6000);
  });

  it("omits the em-dash suffix when no soul name is present", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      { domain: "workflow", event: "WORKFLOW_ASSIGNED", workflow_id: "w1" } as EventPayload,
      ctx,
    );

    expect(showToast).toHaveBeenCalledWith("Workflow assigned to you", "info", 6000);
  });
});

// ── Notification domain ──────────────────────────────────────────────

describe("notification events", () => {
  it("invalidates both the list and the unread badge count", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "notification", event: "NOTIFICATION_CREATED" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["notifications"]',
      '["notifications-unread-count"]',
    ]);
  });

  it("joins title and message into the toast", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      {
        domain: "notification",
        event: "NOTIFICATION_CREATED",
        notification: { id: 1, title: "Judgment", message: "ready", notification_type: "x", is_read: false, created_at: "", user_id: 1 },
      } as EventPayload,
      ctx,
    );

    expect(showToast).toHaveBeenCalledWith("Judgment: ready", "info", 5000);
  });

  it("shows the title alone when the message body is empty", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      {
        domain: "notification",
        event: "NOTIFICATION_CREATED",
        notification: { id: 1, title: "Judgment", message: "", notification_type: "x", is_read: false, created_at: "", user_id: 1 },
      } as EventPayload,
      ctx,
    );

    expect(showToast).toHaveBeenCalledWith("Judgment", "info", 5000);
  });

  it("does not toast at all when the frame carries no notification body", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent({ domain: "notification", event: "NOTIFICATION_CREATED" } as EventPayload, ctx);

    expect(showToast).not.toHaveBeenCalled();
  });
});

// ── Dispatch & death sync ────────────────────────────────────────────

describe("dispatch events", () => {
  it("invalidates the dispatch cache and labels the event", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    dispatchEvent(
      { domain: "dispatch", event: "DISPATCH_EXECUTED", soul_name: "Ka" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["dispatch"]']);
    expect(showToast).toHaveBeenCalledWith("Dispatch executed — Ka", "info", 6000);
  });

  it("uses error severity for a rejected dispatch", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent({ domain: "dispatch", event: "DISPATCH_REJECTED" } as EventPayload, ctx);

    expect(showToast).toHaveBeenCalledWith("Dispatch rejected", "error", 6000);
  });

  it("uses info severity for an approved dispatch", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent({ domain: "dispatch", event: "DISPATCH_APPROVED" } as EventPayload, ctx);

    expect(showToast).toHaveBeenCalledWith("Dispatch approved", "info", 6000);
  });
});

describe("death sync events", () => {
  it("invalidates the death-sync cache", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    dispatchEvent({ domain: "deathsync", event: "DEATH_SYNC_PROCESSED" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["death-sync"]']);
    expect(showToast).toHaveBeenCalledWith("Death registration processed", "info", 5000);
  });
});

// ── Social domain ────────────────────────────────────────────────────

describe("social events", () => {
  it("invalidates only the post list for POST_CREATED", () => {
    const { ctx, invalidateQueries } = makeContext();

    const result = dispatchEvent({ domain: "social", event: "POST_CREATED" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["social","posts"]']);
    expect(result.invalidatedKeys).toEqual(["social.posts"]);
  });

  it("invalidates the thread for the specific post on COMMENT_CREATED", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "social", event: "COMMENT_CREATED", post_id: "p1" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","comments","post","p1"]',
      '["social","posts"]',
    ]);
  });

  it("skips the per-post comment key when the frame has no post_id", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "social", event: "COMMENT_DELETED" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["social","posts"]']);
  });

  it("invalidates reaction and post-detail keys for REACTION_ADDED", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "social", event: "REACTION_ADDED", post_id: "p2" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","reactions","post","p2"]',
      '["social","posts","detail","p2"]',
    ]);
  });

  it("invalidates nothing for a reaction on a comment (no post_id)", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent(
      { domain: "social", event: "REACTION_REMOVED", comment_id: "c1" } as EventPayload,
      ctx,
    );

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(result.invalidatedKeys).toEqual(["social.reactions"]);
    expect(showToast).toHaveBeenCalled();
  });

  it("invalidates both sides of a follow relationship", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      {
        domain: "social",
        event: "USER_FOLLOWED",
        follower_id: "u1",
        following_id: "u2",
      } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","follows","followers","u2"]',
      '["social","profile","u2"]',
      '["social","follows","following","u1"]',
      '["social","profile","u1"]',
    ]);
  });

  it("invalidates only the follower side when following_id is missing", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "social", event: "USER_UNFOLLOWED", follower_id: "u1" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","follows","following","u1"]',
      '["social","profile","u1"]',
    ]);
  });

  it("prefers author_name over soul_name in the toast", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      {
        domain: "social",
        event: "POST_CREATED",
        author_name: "Ann",
        soul_name: "Ignored",
      } as EventPayload,
      ctx,
    );

    expect(showToast).toHaveBeenCalledWith("New post — Ann", "info", 4000);
  });
});

// ── Fallbacks & failure handling ─────────────────────────────────────

describe("unhandled events", () => {
  it("reports failure for an unknown domain instead of silently succeeding", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent({ domain: "aliens", event: "PROBE" } as unknown as EventPayload, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unhandled event: aliens.PROBE");
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Unhandled event: aliens.PROBE", "info", 3000);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("reports failure for an unknown event inside a known domain", () => {
    const { ctx } = makeContext();

    const result = dispatchEvent({ domain: "soul", event: "SOUL_VAPORISED" } as EventPayload, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unhandled event: soul.SOUL_VAPORISED");
  });

  it("catches a throwing handler and returns the error rather than propagating", () => {
    const showToast = jest.fn();
    const ctx = {
      queryClient: {
        invalidateQueries: jest.fn(() => {
          throw new Error("cache exploded");
        }),
      } as unknown as QueryClient,
      showToast,
    };

    const result = dispatchEvent({ domain: "soul", event: "SOUL_CREATED" } as EventPayload, ctx);

    expect(result).toEqual({ success: false, invalidatedKeys: [], error: "cache exploded" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("stringifies a non-Error throw", () => {
    const ctx = {
      queryClient: {
        invalidateQueries: jest.fn(() => {
          throw "plain string failure";
        }),
      } as unknown as QueryClient,
      showToast: jest.fn(),
    };

    const result = dispatchEvent({ domain: "dispatch", event: "DISPATCH_CREATED" } as EventPayload, ctx);

    expect(result.error).toBe("plain string failure");
  });
});

// ── Registry introspection & drift ───────────────────────────────────

describe("registry introspection", () => {
  it("lists the registered domains", () => {
    expect(getRegisteredDomains().sort()).toEqual([
      "deathsync",
      "dispatch",
      "notification",
      "social",
      "soul",
      "workflow",
    ]);
  });

  it("lists the events of a domain and returns empty for an unknown one", () => {
    expect(getRegisteredEvents("notification")).toEqual(["NOTIFICATION_CREATED"]);
    expect(getRegisteredEvents("nope")).toEqual([]);
  });

  it("answers isEventRegistered truthfully in both directions", () => {
    expect(isEventRegistered("soul", "SOUL_CREATED")).toBe(true);
    expect(isEventRegistered("soul", "NOT_A_THING")).toBe(false);
    expect(isEventRegistered("nope", "SOUL_CREATED")).toBe(false);
  });

  it("falls back to the raw event type when no label exists", () => {
    expect(getEventLabel("SOUL_CREATED")).toBe("Soul created");
    expect(getEventLabel("BRAND_NEW_EVENT")).toBe("BRAND_NEW_EVENT");
  });
});

describe("event drift", () => {
  it("has a handler for every backend event type", () => {
    expect(detectEventDrift().missingInFrontend).toEqual([]);
  });

  it("registers no event the backend does not emit", () => {
    expect(detectEventDrift().extraInFrontend).toEqual([]);
  });

  it("dispatches every backend event type to a real handler, never the unknown fallback", () => {
    for (const event of BACKEND_EVENT_TYPES) {
      const domain = getRegisteredDomains().find((d) => isEventRegistered(d, event));
      expect(domain).toBeDefined();

      const { ctx } = makeContext();
      const result = dispatchEvent({ domain, event } as unknown as EventPayload, ctx);
      expect(result.success).toBe(true);
    }
  });
});
