/**
 * Does a realtime event actually invalidate anything?
 *
 * `eventRegistry.test.ts` pins the query key each event asks to invalidate,
 * against a `queryClient` that is `{ invalidateQueries: jest.fn() }`. A mock
 * records the REQUEST. It cannot know whether any query was cached at that key,
 * so a handler that asks to invalidate a key nothing uses looks identical to
 * one that works — and four of them were exactly that:
 *
 *   handler asked for                        cache was actually at
 *   ["social","comments","post",id]          ["social","comments","list",{post:id}]
 *   ["social","reactions","post",id]         ["social","reactions",{post:id}]
 *   ["social","follows","followers",id]      ["social","follows","followers"]
 *   ["social","profile",id]                  ["social","profiles","detail",id]
 *
 * plus two page-level keys spelled in the singular — `["workflow", id]` and
 * `["judgment", id]` / `["soul", id]` — which diverged from
 * `workflowKeys.detail` / `judgmentKeys.detail` / `soulKeys.detail` at the
 * first segment. Comment threads, reaction counts, follow lists, profile pages,
 * the workflow an approver was looking at and the soul panel on a judgment all
 * failed to update on a push, and the suite was green the whole time. One test
 * was even NAMED for the behaviour that was not happening: "invalidates the
 * thread for the specific post on COMMENT_CREATED".
 *
 * This file uses a REAL QueryClient. It seeds the cache at the keys the app's
 * hooks and pages really use, dispatches the event, and asks the cache whether
 * the entry came back invalidated. There is no spelling to agree with: either
 * the push reaches the data on screen or it does not.
 *
 * WHY BOTH FILES. Key-level pinning is still worth having — it reads as a
 * table and it catches an over-broad invalidation that this file would happily
 * call a pass. That one answers "what did it ask for"; this one answers "did
 * anyone hear it".
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { QueryClient } from "@tanstack/react-query";

import {
  dispatchEvent,
  type EventContext,
  type EventPayload,
} from "@/lib/events/event_registry";
import {
  judgmentKeys,
  notificationKeys,
  socialKeys,
  soulKeys,
  workflowKeys,
} from "@/lib/query_keys";

/**
 * Every cache entry a push is supposed to be able to reach, keyed the way the
 * code that owns it keys it. `owner` is where to look when one of these goes
 * red: it is the file whose query key must keep matching the handler.
 */
const CACHED: { label: string; owner: string; key: readonly unknown[] }[] = [
  { label: "soul detail", owner: "src/hooks/useSouls.ts", key: soulKeys.detail("s1") },
  { label: "soul list", owner: "src/hooks/useSouls.ts", key: soulKeys.list() },
  { label: "workflow detail", owner: "app/workflow/[id]/page.tsx", key: workflowKeys.detail("w1") },
  { label: "judgment detail", owner: "app/judgment/[id]/page.tsx", key: judgmentKeys.detail("j1") },
  { label: "notification list", owner: "app/notifications/page.tsx", key: notificationKeys.list() },
  { label: "unread badge", owner: "src/components/layout/AppLayout.tsx", key: notificationKeys.unreadCount },
  { label: "post feed", owner: "src/hooks/useSocial.ts", key: socialKeys.posts.feed() },
  { label: "post detail", owner: "src/hooks/useSocial.ts", key: socialKeys.posts.detail("p1") },
  // The four that were unreachable. Keyed here EXACTLY as useSocial.ts keys
  // them — including the params object, which is where the post id actually
  // lives and which is what the old per-post keys got wrong.
  { label: "comment thread", owner: "src/hooks/useSocial.ts", key: socialKeys.comments.list({ post: "p1" }) },
  { label: "reaction list", owner: "src/hooks/useSocial.ts", key: [...socialKeys.reactions.all, { post: "p1" }] },
  { label: "followers list", owner: "src/hooks/useSocial.ts", key: socialKeys.follows.followers },
  { label: "following list", owner: "src/hooks/useSocial.ts", key: socialKeys.follows.following },
  { label: "profile detail", owner: "src/hooks/useSocial.ts", key: socialKeys.profiles.detail("u2") },
];

function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const { key } of CACHED) {
    client.setQueryData(key, { seeded: true });
  }
  return client;
}

function makeCtx(client: QueryClient) {
  const showToast = jest.fn();
  return { ctx: { queryClient: client, showToast } satisfies EventContext, showToast };
}

/** Labels of every seeded entry the dispatch marked stale. */
function invalidatedLabels(client: QueryClient): string[] {
  return CACHED.filter(({ key }) => client.getQueryState(key)?.isInvalidated === true).map(
    ({ label }) => label
  );
}

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe("the seeding is real", () => {
  it("seeds every entry, and none of them start invalidated", () => {
    const client = seededClient();
    for (const { key, label } of CACHED) {
      expect([label, client.getQueryState(key)?.data]).toEqual([label, { seeded: true }]);
    }
    expect(invalidatedLabels(client)).toEqual([]);
  });

  it("has no duplicate keys, which would make one entry stand for two", () => {
    const serialised = CACHED.map(({ key }) => JSON.stringify(key));
    expect(new Set(serialised).size).toBe(CACHED.length);
  });
});

describe("a realtime push reaches the cache", () => {
  const CASES: { name: string; payload: EventPayload; reaches: string[] }[] = [
    {
      name: "STATE_CHANGED refreshes the soul list and that soul's detail",
      payload: { domain: "soul", event: "STATE_CHANGED", soul_id: "s1" } as EventPayload,
      reaches: ["soul detail", "soul list"],
    },
    {
      name: "WORKFLOW_APPROVED refreshes the workflow an approver has open",
      payload: {
        domain: "workflow",
        event: "WORKFLOW_APPROVED",
        workflow_id: "w1",
        soul_id: "s1",
      } as EventPayload,
      reaches: ["soul detail", "soul list", "workflow detail"],
    },
    {
      name: "a notification refreshes both the list and the masthead badge",
      payload: { domain: "notification", event: "NOTIFICATION_CREATED" } as EventPayload,
      reaches: ["notification list", "unread badge"],
    },
    {
      name: "COMMENT_CREATED refreshes the thread it was posted into",
      payload: { domain: "social", event: "COMMENT_CREATED", post_id: "p1" } as EventPayload,
      reaches: ["post feed", "post detail", "comment thread"],
    },
    {
      name: "REACTION_ADDED refreshes the reaction list and the post",
      payload: { domain: "social", event: "REACTION_ADDED", post_id: "p1" } as EventPayload,
      reaches: ["post detail", "reaction list"],
    },
    {
      name: "USER_FOLLOWED refreshes both follow lists and the followed profile",
      payload: {
        domain: "social",
        event: "USER_FOLLOWED",
        follower_id: "u1",
        following_id: "u2",
      } as EventPayload,
      reaches: ["followers list", "following list", "profile detail"],
    },
  ];

  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const client = seededClient();
    const { ctx } = makeCtx(client);

    dispatchEvent(testCase.payload, ctx);

    // Sorted and compared whole: this asserts the entries that must NOT go
    // stale stay valid too. An over-broad handler that invalidated the entire
    // cache would satisfy a `toContain` check on every case above.
    expect(invalidatedLabels(client).sort()).toEqual([...testCase.reaches].sort());
  });

  it("an unregistered event invalidates nothing at all", () => {
    const client = seededClient();
    const { ctx } = makeCtx(client);

    const result = dispatchEvent(
      { domain: "soul", event: "NOT_A_REAL_EVENT" } as EventPayload,
      ctx
    );

    expect(result.success).toBe(false);
    expect(invalidatedLabels(client)).toEqual([]);
  });
});

/**
 * The half this file cannot see on its own.
 *
 * Everything above seeds the cache FROM THE FACTORIES, so it proves the
 * handlers agree with `lib/query_keys.ts`. It cannot see a page that caches
 * under a key of its own invention — and that is how two of the six defects
 * happened: `app/workflow/[id]/page.tsx` cached at `["workflow", id]` and
 * `app/judgment/[id]/page.tsx` at `["judgment", id]` / `["soul", id]`. Mutating
 * those three back and re-running the block above leaves it GREEN, which is
 * measured, not assumed.
 *
 * Every factory family is a plural noun. The singular is therefore never a
 * correct first segment, and is what a hand-typed key reaches for. That is a
 * shape a grep reads with no ambiguity, so it is checked as text.
 *
 * `["profile"]` in app/profile/page.tsx is deliberately NOT here: it is the
 * account profile from `authApi.profile()`, it has no factory family to
 * collide with, and the page both reads and invalidates it — self-consistent,
 * and no realtime handler aims at it. The rule is about singulars that SHADOW
 * a family, not about singular keys generally.
 */
describe("no source file caches under a singular form of a factory family", () => {
  const FRONTEND_ROOT = path.join(__dirname, "..", "..");

  /** Plural family root → the singular that would shadow it. */
  const SHADOWS: Record<string, string> = {
    souls: "soul",
    judgments: "judgment",
    workflows: "workflow",
    notifications: "notification",
    dispositions: "disposition",
    permissions: "permission",
    users: "user",
  };

  function grep(pattern: string): string[] {
    try {
      const out = execFileSync(
        "grep",
        ["-rn", "--include=*.ts", "--include=*.tsx", "-e", pattern, "app", "src", "lib"],
        { cwd: FRONTEND_ROOT, encoding: "utf8" }
      );
      return out.trim() === "" ? [] : out.trim().split("\n");
    } catch (err) {
      // grep exits 1 for "no matches", which is the passing case. Any other
      // status is a broken check, and must not read as a pass.
      const status = (err as { status?: number }).status;
      if (status === 1) return [];
      throw err;
    }
  }

  it("the grep works, or this whole block is a no-op", () => {
    // Proves the search reaches real files and the plural spelling is in use;
    // without this, a broken invocation would report zero matches and pass.
    expect(grep('queryKey: \\[\\"souls\\"').length + grep("soulKeys\\.").length).toBeGreaterThan(0);
  });

  it.each(Object.entries(SHADOWS).map(([plural, singular]) => [singular, plural] as const))(
    "nothing keys under [\"%s\"] where the family is \"%s\"",
    (singular, _plural) => {
      expect(grep(`queryKey: \\[\\"${singular}\\"`)).toEqual([]);
    }
  );
});
