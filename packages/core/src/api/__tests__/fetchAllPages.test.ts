import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What `fetchAllPages` sends, page by page.
 *
 * WHY THIS SUITE EXISTS. `fetchAllPages` read each page's query parameters off
 * `new URL(next).searchParams` — a member `platform/host-globals.d.ts` declared
 * as present on every host, which for React Native's partial `URL` polyfill is
 * not a claim this package could make. The parsing is now done on the string
 * (`queryOf` in ../client.ts) and `URL` is gone from the allowlist. Nothing
 * about the *result* was supposed to change, and "nothing changed" is a
 * property that needs writing down, because there was no test of this function
 * at all before: `frontend/src/__tests__/api.test.ts` covers the interceptors,
 * and the two callers (`realms.ts`, `actors.ts`) are covered only through page
 * components that mock the api module wholesale.
 *
 * WHAT IS FAKED AND WHAT IS NOT. Only `axios` — `axios.create` returns a stub
 * whose `get` replays a scripted list of pages and records its arguments. The
 * function under test is the real, exported `fetchAllPages`, reached through
 * the same import a caller uses, so a change that stops it calling `queryOf`
 * shows up here. A test that called `queryOf` directly would not: the helper
 * would stay correct while the caller stopped using it, which is this
 * repository's recorded failure (a mutation confirmed on disk by grep while the
 * guard stayed green, because the fixture bypassed the mutated line).
 *
 * The `params` the transport is handed are the subject. The path is asserted
 * too, because it carries the query string a second time — see the comment in
 * ../client.ts; that duplication is pre-existing and pinning it is how a
 * later change to it becomes a decision rather than a surprise.
 */

interface RecordedCall {
  path: string;
  params: Record<string, string>;
}

const recorded: RecordedCall[] = [];
/** Page bodies, shifted one per `get`. */
let scripted: { count: number; next: string | null; results: unknown[] }[] = [];

const stubInstance = Object.assign(vi.fn(), {
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  get: vi.fn((path: string, config?: { params?: Record<string, string> }) => {
    recorded.push({ path, params: { ...(config?.params ?? {}) } });
    const page = scripted.shift();
    if (page === undefined) {
      throw new Error(`fetchAllPages asked for an unscripted page: ${path}`);
    }
    return Promise.resolve({ data: page });
  }),
  post: vi.fn(),
});

vi.mock("axios", () => {
  const stub = {
    create: () => stubInstance,
    post: vi.fn(),
    get: vi.fn(),
    isAxiosError: () => false,
  };
  return { default: stub, ...stub };
});

const { fetchAllPages } = await import("../client");
const { configurePlatform, resetPlatform } = await import("../../platform/index");

const BASE = "https://api.example.test/api/v1";

const noopStore = { get: () => null, set: () => {}, remove: () => {} };

beforeEach(() => {
  recorded.length = 0;
  scripted = [];
  configurePlatform({
    session: noopStore,
    persistent: noopStore,
    secure: noopStore,
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    baseUrl: BASE,
  });
});

afterEach(() => {
  resetPlatform();
});

/** One page, no `next`. */
function onlyPage(results: unknown[] = []) {
  scripted = [{ count: results.length, next: null, results }];
}

describe("fetchAllPages — query parsing", () => {
  it("hands the transport every parameter it was given", async () => {
    onlyPage([{ id: 1 }]);
    const out = await fetchAllPages<{ id: number }>("/realms/", {
      civilization: "chinese",
      ordering: "-created_at",
      page_size: "100",
    });

    expect(out).toEqual([{ id: 1 }]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].params).toEqual({
      civilization: "chinese",
      ordering: "-created_at",
      page_size: "100",
    });
  });

  it("decodes percent-encoding and `+`, and does not re-encode", async () => {
    onlyPage();
    // `URLSearchParams` encodes a space as `+` on the way out; the parse has to
    // turn it back into a space, or the server is asked for a different value
    // than the caller named. `%2F` likewise: a slash that survives as `%2F`
    // would be re-encoded to `%252F` by axios on the next hop.
    await fetchAllPages("/actors/", { search: "Sun Wukong", path: "a/b", plus: "1+1" });

    expect(recorded[0].params).toEqual({
      search: "Sun Wukong",
      path: "a/b",
      plus: "1+1",
    });
  });

  it("is empty for a page with no query at all", async () => {
    // DRF's `next` is normally `?page=2`, but the first URL this function
    // builds ends in a bare `?` when `params` is empty, and a hand-written
    // `next` need not carry one either. Neither may produce a phantom key.
    scripted = [
      { count: 0, next: `${BASE}/realms/`, results: [] },
      { count: 0, next: null, results: [] },
    ];
    await fetchAllPages("/realms/");

    expect(recorded.map((c) => c.params)).toEqual([{}, {}]);
  });

  it("takes the last value when a key repeats", async () => {
    // Not a preference — it is what the `URL.searchParams.forEach` version did,
    // and what Django's QueryDict does when it reads a repeated key with
    // `.get()`. Stated so that changing it is visible.
    scripted = [
      { count: 0, next: `${BASE}/realms/?status=draft&status=final`, results: [] },
      { count: 0, next: null, results: [] },
    ];
    await fetchAllPages("/realms/");

    expect(recorded[1].params).toEqual({ status: "final" });
  });

  it("splits on the first `?` — a later one belongs to the value", async () => {
    scripted = [
      { count: 0, next: `${BASE}/realms/?q=what?&page=2`, results: [] },
      { count: 0, next: null, results: [] },
    ];
    await fetchAllPages("/realms/");

    expect(recorded[1].params).toEqual({ q: "what?", page: "2" });
  });

  it("drops a fragment rather than gluing it to the last value", async () => {
    scripted = [
      { count: 0, next: `${BASE}/realms/?page=2#section`, results: [] },
      { count: 0, next: null, results: [] },
    ];
    await fetchAllPages("/realms/");

    expect(recorded[1].params).toEqual({ page: "2" });
    // Assert the absence too: the fragment must not have leaked into a value.
    expect(JSON.stringify(recorded[1].params)).not.toContain("#");
  });
});

describe("fetchAllPages — walking the pages", () => {
  it("follows an absolute `next` and concatenates the results", async () => {
    scripted = [
      { count: 3, next: `${BASE}/realms/?page=2`, results: [{ id: 1 }, { id: 2 }] },
      { count: 3, next: null, results: [{ id: 3 }] },
    ];
    const out = await fetchAllPages<{ id: number }>("/realms/", { ordering: "id" });

    expect(out).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(recorded.map((c) => c.path)).toEqual(["/realms/?ordering=id", "/realms/?page=2"]);
    expect(recorded.map((c) => c.params)).toEqual([{ ordering: "id" }, { page: "2" }]);
  });

  it("follows a relative `next` by re-attaching the base", async () => {
    // DRF emits an absolute URL, but a proxy that rewrites it to a path must
    // not send the second request to a relative URL with the base still glued
    // on — and the parameters must come out the same either way.
    scripted = [
      { count: 2, next: "/realms/?page=2", results: [{ id: 1 }] },
      { count: 2, next: null, results: [{ id: 2 }] },
    ];
    const out = await fetchAllPages<{ id: number }>("/realms/");

    expect(out).toEqual([{ id: 1 }, { id: 2 }]);
    expect(recorded[1].path).toBe("/realms/?page=2");
    expect(recorded[1].params).toEqual({ page: "2" });
  });

  it("stops at the first page when `next` is null", async () => {
    onlyPage([{ id: 1 }]);
    await fetchAllPages("/actors/", { civilization: "greek" });

    expect(recorded).toHaveLength(1);
    // `scripted` was one page long; a second `get` would have thrown. Assert
    // the queue is drained rather than trusting that.
    expect(scripted).toHaveLength(0);
  });
});
