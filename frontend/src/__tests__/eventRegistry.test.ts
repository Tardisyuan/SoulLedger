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
  flushEventInvalidations,
  INVALIDATION_BATCH_MS,
  detectEventDrift,
  getEventLabel,
  getRegisteredDomains,
  getRegisteredEvents,
  isEventRegistered,
  BACKEND_EVENT_TYPES,
  REALTIME_ONLY_EVENT_TYPES,
  type EventContext,
  type EventPayload,
} from "@/lib/events/event_registry";
import type { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import en from "@soulledger/core/messages/en.json";
import zhHans from "@soulledger/core/messages/zh-Hans.json";
import { publishTranslator } from "@/lib/i18n/activeTranslator";
import { EVENT_LABELS, handleWorkflowEvent } from "@/lib/events/eventHandlers";
import type { WorkflowEventPayload } from "@/lib/events/eventTypes";
import path from "node:path";

function makeContext(currentUserId?: string) {
  const invalidateQueries = jest.fn();
  const showToast = jest.fn();
  const ctx = {
    queryClient: { invalidateQueries } as unknown as QueryClient,
    showToast,
    currentUserId,
  } satisfies EventContext;
  return { ctx, invalidateQueries, showToast };
}

/**
 * All query keys the handler invalidated, as JSON for easy comparison. Flushes first: `dispatchEvent` coalesces
 * invalidations for `INVALIDATION_BATCH_MS`, so nothing reaches the client synchronously (pinned below).
 */
function invalidatedKeys(invalidateQueries: jest.Mock): string[] {
  flushEventInvalidations();
  return invalidateQueries.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));
}

/** Whether the soul invalidation was narrowed to one soul (has a predicate) or was the whole family. */
function soulCall(invalidateQueries: jest.Mock) {
  flushEventInvalidations();
  return invalidateQueries.mock.calls.map(([arg]) => arg).find((arg) => JSON.stringify(arg.queryKey) === '["souls"]');
}

/**
 * A dot-path lookup over a shipped bundle, answering the key itself when it is missing (as `t` does).
 * The handlers resolve their labels through `translate` (lib/i18n/activeTranslator); publishing this
 * stands in for the mounted `I18nProvider` without a React tree.
 */
function lookup(bundle: object) {
  return (key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), bundle);
    return typeof value === "string" ? value : key;
  };
}

beforeAll(() => publishTranslator(lookup(en)));
afterAll(() => publishTranslator(null));

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
    expect(showToast).toHaveBeenCalledWith("Soul registered — Meng", "info", 5000);
    expect(result).toEqual({
      success: true,
      invalidatedKeys: ["souls"],
      toastMessage: "Soul registered — Meng",
    });
  });

  it("invalidates souls (which prefix-matches the soul detail cache too) on STATE_CHANGED", () => {
    // FL-16 (2026-09-13): this handler used to fire a SECOND, explicit
    // `soulKeys.detail(id)` invalidation here. It was dead weight — that key
    // is `[...soulKeys.all, "detail", id]`, a prefix extension of `souls`,
    // and `invalidateQueries` matches by prefix (default `exact: false`), so
    // the single `souls` call below already invalidates any cached detail
    // query. Two calls and one produced the same real invalidation; only the
    // count of `invalidateQueries` calls changed, which is what this test
    // used to pin.
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "soul", event: "STATE_CHANGED", soul_id: "s7" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]']);
    // 2026-10-30: narrowed to soul s7 by a predicate (which keys it reaches is pinned against a real cache in
    // eventInvalidationReachesCache.test.ts).
    expect(typeof soulCall(invalidateQueries)?.predicate).toBe("function");
  });

  it("falls back to the whole soul family when STATE_CHANGED carries no soul_id", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "soul", event: "STATE_CHANGED" } as unknown as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]']);
    expect(soulCall(invalidateQueries)?.predicate).toBeUndefined();
  });

  it("holds invalidations for the batch window and sends a burst once, merged", () => {
    jest.useFakeTimers();
    try {
      const { ctx, invalidateQueries } = makeContext();
      for (const soul_id of ["s1", "s2", "s1"]) {
        dispatchEvent({ domain: "soul", event: "RECORD_ADDED", soul_id } as EventPayload, ctx);
      }
      dispatchEvent({ domain: "soul", event: "DISPOSITION_CREATED", soul_id: "s3" } as EventPayload, ctx);
      expect(invalidateQueries).not.toHaveBeenCalled();

      jest.advanceTimersByTime(INVALIDATION_BATCH_MS - 1);
      expect(invalidateQueries).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      // One call per distinct key: four soul frames → one `souls` call whose predicate covers s1, s2 and s3.
      expect(invalidateQueries.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))).toEqual([
        '["souls"]',
        '["dispositions"]',
      ]);
      const predicate = invalidateQueries.mock.calls[0][0].predicate as (_q: { queryKey: unknown[] }) => boolean;
      expect(["s1", "s2", "s3", "s4"].map((id) => predicate({ queryKey: ["souls", "detail", id] }))).toEqual([
        true,
        true,
        true,
        false,
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("drops a narrowed soul invalidation when the same burst invalidates the whole family", () => {
    const { ctx, invalidateQueries } = makeContext();
    dispatchEvent({ domain: "soul", event: "RECORD_ADDED", soul_id: "s1" } as EventPayload, ctx);
    dispatchEvent({ domain: "soul", event: "RECORD_ADDED" } as unknown as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]']);
    expect(soulCall(invalidateQueries)?.predicate).toBeUndefined();
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
  it("invalidates the workflow family (detail included) and that soul when a soul is attached", () => {
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

    // The handler still asks for `workflows.detail(w1)` too; the batch drops it because `workflows` (no predicate)
    // is its prefix and already reaches it — the real-cache test shows the detail entry going stale.
    expect(invalidatedKeys(invalidateQueries)).toEqual(['["workflows"]', '["souls"]']);
    expect(typeof soulCall(invalidateQueries)?.predicate).toBe("function");
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

    expect(showToast).toHaveBeenCalledWith("Workflow assigned", "info", 6000);
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
    const { ctx, showToast } = makeContext("1");

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
    const { ctx, showToast } = makeContext("1");

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

  it("toasts in the reader's language when the push carries per-locale text, else the stored text", () => {
    const body = (extra: object) => ({
      domain: "notification",
      event: "NOTIFICATION_CREATED",
      notification: { id: 1, title: "存下来的标题", message: "存下来的正文", notification_type: "SYSTEM", is_read: false, created_at: "", user_id: 1, ...extra },
    }) as EventPayload;
    const i18n = { "zh-Hans": { title: "审批超时", message: "请处理" }, en: { title: "Approval overdue", message: "Please handle it" } };
    const { ctx, showToast } = makeContext("1");

    document.cookie = "soulledger-locale=en; path=/";
    dispatchEvent(body({ i18n }), ctx);
    expect(showToast).toHaveBeenLastCalledWith("Approval overdue: Please handle it", "info", 5000);

    // A locale missing from `i18n`: the stored text, not a blank toast.
    document.cookie = "soulledger-locale=egy; path=/";
    dispatchEvent(body({ i18n }), ctx);
    expect(showToast).toHaveBeenLastCalledWith("存下来的标题: 存下来的正文", "info", 5000);

    // An old notification has no `i18n` at all.
    document.cookie = "soulledger-locale=en; path=/";
    dispatchEvent(body({}), ctx);
    expect(showToast).toHaveBeenLastCalledWith("存下来的标题: 存下来的正文", "info", 5000);
    document.cookie = "soulledger-locale=; path=/; max-age=0";
  });

  it("toasts the flat shape too (`EventService.notify_user`), to the recipient only", () => {
    const flat = {
      domain: "notification",
      event: "NOTIFICATION_CREATED",
      user_id: 7,
      title: "存下来的标题",
      message: "存下来的正文",
      i18n: { en: { title: "Letter handed over", message: "From Meng" } },
    } as EventPayload;

    const other = makeContext("1");
    dispatchEvent(flat, other.ctx);
    expect(other.showToast).not.toHaveBeenCalled();
    expect(invalidatedKeys(other.invalidateQueries).length).toBeGreaterThan(0);

    const recipient = makeContext("7");
    dispatchEvent(flat, recipient.ctx);
    expect(recipient.showToast).toHaveBeenCalledWith("存下来的标题: 存下来的正文", "info", 5000);

    document.cookie = "soulledger-locale=en; path=/";
    const english = makeContext("7");
    dispatchEvent(flat, english.ctx);
    expect(english.showToast).toHaveBeenCalledWith("Letter handed over: From Meng", "info", 5000);
    document.cookie = "soulledger-locale=; path=/; max-age=0";
  });

  it("does not toast at all when the frame carries no notification body", () => {
    const { ctx, showToast } = makeContext("1");

    dispatchEvent({ domain: "notification", event: "NOTIFICATION_CREATED" } as EventPayload, ctx);

    expect(showToast).not.toHaveBeenCalled();
  });

  it("toasts only the recipient: another officer's notification invalidates but does not toast", () => {
    const frame = {
      domain: "notification",
      event: "NOTIFICATION_CREATED",
      notification: { id: 1, title: "密码求助", message: "某人", notification_type: "SYSTEM", is_read: false, created_at: "", user_id: 7 },
    } as EventPayload;

    const other = makeContext("1");
    dispatchEvent(frame, other.ctx);
    expect(other.showToast).not.toHaveBeenCalled();
    expect(invalidatedKeys(other.invalidateQueries).length).toBeGreaterThan(0);

    const unknown = makeContext(undefined);
    dispatchEvent(frame, unknown.ctx);
    expect(unknown.showToast).not.toHaveBeenCalled();

    const recipient = makeContext("7");
    dispatchEvent(frame, recipient.ctx);
    expect(recipient.showToast).toHaveBeenCalledWith("密码求助: 某人", "info", 5000);
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

  it("a dispatch's own STATE_CHANGED (on the bus since 2026-10-30) refreshes dispatch and souls, silently", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent(
      { domain: "dispatch", event: "STATE_CHANGED", action: "DISPATCH_APPROVED", soul_id: "s1" } as unknown as EventPayload,
      ctx,
    );

    expect(result.success).toBe(true);
    expect(invalidatedKeys(invalidateQueries).sort()).toEqual(['["dispatch"]', '["souls"]']);
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("sentence plan events", () => {
  it("arrive in their own domain and refresh the soul's timeline without a toast", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent(
      { domain: "sentence_plan", event: "SENTENCE_NODE_ACTIVATED", soul_id: "s1" } as unknown as EventPayload,
      ctx,
    );

    expect(result.success).toBe(true);
    expect(invalidatedKeys(invalidateQueries)).toEqual(['["souls"]']);
    expect(showToast).not.toHaveBeenCalled();
    // The soul domain no longer carries them: the backend publishes them as sentence_plan only.
    expect(isEventRegistered("soul", "SENTENCE_NODE_ACTIVATED")).toBe(false);
  });
});

describe("death sync events", () => {
  it("invalidates the death-sync cache", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    dispatchEvent({ domain: "deathsync", event: "DEATH_SYNC_PROCESSED" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["death-sync"]']);
    expect(showToast).toHaveBeenCalledWith("Death sync processed", "info", 5000);
  });
});

// ── Scheduler domain ─────────────────────────────────────────────────

describe("scheduler events", () => {
  it.each(["SCHEDULER_RUN_UPDATED", "SCHEDULER_JOB_UPDATED", "SCHEDULER_JOBS_REBUILT", "SCHEDULER_RUN_FAILED"])(
    "%s invalidates the scheduler root, and toasts nothing",
    (event) => {
      const { ctx, invalidateQueries, showToast } = makeContext();

      const result = dispatchEvent(
        { domain: "scheduler", event, job_id: 3, run_id: 9, status: "RUNNING" } as EventPayload,
        ctx
      );

      expect(result.success).toBe(true);
      expect(invalidatedKeys(invalidateQueries)).toEqual(['["scheduler"]']);
      expect(showToast).not.toHaveBeenCalled();
    }
  );

  it("mirrors exactly the event constants backend/apps/scheduler/realtime.py publishes", () => {
    // The authority is the backend module, not this repo's copy of it: an
    // event renamed or added there must turn this red, not fall through to
    // the unknown-event handler (which invalidates nothing) in production.
    const source = readFileSync(
      path.join(__dirname, "..", "..", "..", "backend", "apps", "scheduler", "realtime.py"),
      "utf8"
    );
    expect(/^DOMAIN = "(\w+)"$/m.exec(source)?.[1]).toBe("scheduler");
    const published = [...source.matchAll(/^[A-Z_]+ = "(SCHEDULER_[A-Z_]+)"$/gm)].map((m) => m[1]).sort();
    expect(published.length).toBeGreaterThanOrEqual(3);
    expect([...REALTIME_ONLY_EVENT_TYPES].sort()).toEqual(published);
    // Plus the one scheduler event that is an EventType member, not a module constant.
    expect(getRegisteredEvents("scheduler").sort()).toEqual([...published, "SCHEDULER_RUN_FAILED"].sort());
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

  // The four cases below assert the CORRECTED keys. What they asserted before
  // was the literal spelling the handler happened to use, which matched no
  // cached query on any of these four families — and the case names said so in
  // words ("invalidates the thread for the specific post", "invalidates only
  // the follower side") while the app updated neither. Pinning a key against a
  // jest.fn() cannot tell those apart; `invalidationReachesTheCache` below is
  // the assertion that can, and this block is now the cheap, readable mirror
  // of it.
  it("invalidates the comment family on COMMENT_CREATED", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "social", event: "COMMENT_CREATED", post_id: "p1" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","comments"]',
      '["social","posts"]',
    ]);
  });

  it("invalidates the comment family even when the frame has no post_id", () => {
    // Threads do not cache under a per-post key, so there is no per-post key to
    // skip: a comment frame without an id still has to refresh the family.
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent({ domain: "social", event: "COMMENT_DELETED" } as EventPayload, ctx);

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","comments"]',
      '["social","posts"]',
    ]);
  });

  it("invalidates the post detail for REACTION_ADDED on a post", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "social", event: "REACTION_ADDED", post_id: "p2" } as EventPayload,
      ctx,
    );

    // There is no reaction cache any more (2026-10-31): the counts live on the post row.
    expect(invalidatedKeys(invalidateQueries)).toEqual(['["social","posts","detail","p2"]']);
  });

  it("still refreshes a reaction on a comment (no post_id): the comment rows carry the counts", () => {
    // Previously this invalidated NOTHING and the case was named for that as
    // if it were a decision. Reactions on comments are cached in the same
    // family as reactions on posts; leaving them stale was the per-post key's
    // side effect, not a choice.
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent(
      { domain: "social", event: "REACTION_REMOVED", comment_id: "c1" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual(['["social","comments"]']);
    expect(result.invalidatedKeys).toEqual(["social.comments"]);
    // No banner: a reaction is not addressed to the viewer, and the payload
    // carries no field that could say whether it was. See the "aimed at the
    // viewer" block below.
    expect(showToast).not.toHaveBeenCalled();
  });

  it("invalidates the follow family and both users' profiles", () => {
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

    // One follows key, not one per side: `follows.following` and
    // `follows.followers` are the current user's own lists and carry no id.
    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","follows"]',
      '["social","profiles","detail","u2"]',
      '["social","profiles","detail","u1"]',
    ]);
  });

  // ── Which social frames may interrupt the viewer ───────────────────
  //
  // Every social event used to toast every signed-in user, so one busy tenant
  // meant a banner per post, comment and reaction on everyone's screen. Only a
  // follow frame identifies its target (`following_id` is the person being
  // followed); nothing in the payload says whose post a comment or reaction
  // landed on, so those can only be silent — the cache invalidation above is
  // what keeps the screen current.
  it("toasts a follow aimed at the viewer", () => {
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      {
        domain: "social",
        event: "USER_FOLLOWED",
        follower_id: "u1",
        following_id: "me",
        author_name: "Ann",
      } as EventPayload,
      { ...ctx, currentUserId: "me" },
    );

    expect(showToast).toHaveBeenCalledWith("New follower — Ann", "info", 4000);
  });

  it("stays silent for a follow between two other people", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    dispatchEvent(
      { domain: "social", event: "USER_FOLLOWED", follower_id: "u1", following_id: "u2" } as EventPayload,
      { ...ctx, currentUserId: "me" },
    );

    // Silent, but not inert: the follow lists still refresh.
    expect(showToast).not.toHaveBeenCalled();
    expect(invalidatedKeys(invalidateQueries)).toContain('["social","follows"]');
  });

  it("stays silent when the viewer is unknown, rather than toasting everyone", () => {
    // `currentUserId` is undefined before the user resolves. The old default
    // was to toast; the safe default is not to.
    const { ctx, showToast } = makeContext();

    dispatchEvent(
      { domain: "social", event: "USER_FOLLOWED", follower_id: "u1", following_id: "u2" } as EventPayload,
      ctx,
    );

    expect(showToast).not.toHaveBeenCalled();
  });

  it("invalidates one profile when only the follower is known", () => {
    const { ctx, invalidateQueries } = makeContext();

    dispatchEvent(
      { domain: "social", event: "USER_UNFOLLOWED", follower_id: "u1" } as EventPayload,
      ctx,
    );

    expect(invalidatedKeys(invalidateQueries)).toEqual([
      '["social","follows"]',
      '["social","profiles","detail","u1"]',
    ]);
  });
});

// ── Fallbacks & failure handling ─────────────────────────────────────

describe("unhandled events", () => {
  it("reports failure for an unknown domain instead of silently succeeding", () => {
    const { ctx, invalidateQueries, showToast } = makeContext();

    const result = dispatchEvent({ domain: "aliens", event: "PROBE" } as unknown as EventPayload, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unhandled event: aliens.PROBE");
    expect(invalidatedKeys(invalidateQueries)).toEqual([]);
    // Logged, NOT toasted. This used to assert the opposite: the operator got
    // "Unhandled event: aliens.PROBE" as a banner over their work —
    // untranslated debug text about a missing registry row they cannot act on.
    // The failure still travels, in `result.error` and the console warning.
    expect(showToast).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("reports failure for an unknown event inside a known domain", () => {
    const { ctx } = makeContext();

    const result = dispatchEvent({ domain: "soul", event: "SOUL_VAPORISED" } as EventPayload, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unhandled event: soul.SOUL_VAPORISED");
  });

  // The cache work is deferred to the batch (below), so a handler that throws is made to throw in its toast.
  it("catches a throwing handler and returns the error rather than propagating", () => {
    const ctx = {
      queryClient: { invalidateQueries: jest.fn() } as unknown as QueryClient,
      showToast: jest.fn(() => {
        throw new Error("toast exploded");
      }),
    };

    const result = dispatchEvent({ domain: "soul", event: "SOUL_CREATED" } as EventPayload, ctx);

    expect(result).toEqual({ success: false, invalidatedKeys: [], error: "toast exploded" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("stringifies a non-Error throw", () => {
    const ctx = {
      queryClient: { invalidateQueries: jest.fn() } as unknown as QueryClient,
      showToast: jest.fn(() => {
        throw "plain string failure";
      }),
    };

    const result = dispatchEvent({ domain: "dispatch", event: "DISPATCH_CREATED" } as EventPayload, ctx);

    expect(result.error).toBe("plain string failure");
  });

  it("a cache that throws when the batch is sent is logged, and the rest of the batch still goes out", () => {
    const invalidateQueries = jest.fn((filters: { queryKey: unknown[] }) => {
      if (filters.queryKey[0] === "dispatch") throw new Error("cache exploded");
    });
    const ctx = { queryClient: { invalidateQueries } as unknown as QueryClient, showToast: jest.fn() };

    dispatchEvent({ domain: "dispatch", event: "STATE_CHANGED", soul_id: "s1" } as EventPayload, ctx);
    expect(() => flushEventInvalidations()).not.toThrow();

    expect(invalidateQueries.mock.calls.map(([f]) => JSON.stringify(f.queryKey))).toEqual(['["dispatch"]', '["souls"]']);
    expect(errorSpy).toHaveBeenCalledWith("[EventRegistry] invalidation failed:", expect.any(Error));
  });
});

// ── Registry introspection & drift ───────────────────────────────────

describe("registry introspection", () => {
  it("lists the registered domains", () => {
    expect(getRegisteredDomains().sort()).toEqual([
      "deathsync",
      "dispatch",
      "notification",
      "scheduler",
      "sentence_plan",
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
    expect(getEventLabel("SOUL_CREATED")).toBe("Soul registered");
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
    for (const event of [...BACKEND_EVENT_TYPES, ...REALTIME_ONLY_EVENT_TYPES]) {
      const domain = getRegisteredDomains().find((d) => isEventRegistered(d, event));
      expect(domain).toBeDefined();

      const { ctx } = makeContext();
      const result = dispatchEvent({ domain, event } as unknown as EventPayload, ctx);
      expect(result.success).toBe(true);
    }
  });
});

// ── Toast copy follows the locale (2026-10-29) ──────────────────────────
// The labels used to be English strings shown as they were in every locale. Each case asserts the
// locale's copy AND the absence of the old English and of the raw key.

describe("toast copy follows the locale", () => {
  afterEach(() => publishTranslator(lookup(en)));

  it("zh-Hans toasts in Chinese, with no English and no raw key", () => {
    publishTranslator(lookup(zhHans));
    const { ctx, showToast } = makeContext();
    dispatchEvent({ domain: "soul", event: "SOUL_CREATED", soul_id: "s1", soul_name: "孟" } as EventPayload, ctx);
    dispatchEvent({ domain: "workflow", event: "WORKFLOW_REJECTED", workflow_id: "w1" } as EventPayload, ctx);
    dispatchEvent(
      { domain: "social", event: "USER_FOLLOWED", follower_id: "u1", following_id: "me", author_name: "安" } as EventPayload,
      { ...ctx, currentUserId: "me" },
    );
    const shown = showToast.mock.calls.map(([msg]) => msg as string);
    expect(shown).toEqual(["灵魂登记 — 孟", "工作流驳回", "新关注者 — 安"]);
    for (const msg of shown) {
      expect(msg).not.toMatch(/[A-Za-z]/);
    }
    expect(getEventLabel("SOUL_CREATED")).toBe("灵魂登记");
  });

  it("an unlabelled event in a domain falls back to that domain's translated word", () => {
    publishTranslator(lookup(zhHans));
    const { ctx, showToast } = makeContext();
    handleWorkflowEvent({ domain: "workflow", event: "WORKFLOW_SOMETHING_NEW", workflow_id: "w1" } as WorkflowEventPayload, ctx);
    expect(showToast).toHaveBeenCalledWith("审批有更新", "info", 6000);
    expect(showToast).not.toHaveBeenCalledWith("Workflow update", expect.anything(), expect.anything());
  });

  it("every label and fallback key resolves in en and zh-Hans", () => {
    const keys = [
      ...Object.values(EVENT_LABELS),
      "events.realtime.fallback_workflow",
      "events.realtime.fallback_dispatch",
      "events.realtime.fallback_death_sync",
      "events.realtime.fallback_social",
    ];
    for (const bundle of [en, zhHans]) {
      const t = lookup(bundle);
      expect(keys.filter((k) => t(k) === k)).toEqual([]);
    }
  });
});
