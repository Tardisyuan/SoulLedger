import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedResponse } from "../users";

/**
 * What `fetchAllPages` / `collectPages` send, page by page (2026-10-30 D5).
 *
 * The walk used to follow each page's `next` URL, one request after another, and
 * there were four copies of it (this one, tenants, statutes, organizations). It
 * is now one: page 1, then pages 2..N from page 1's `count`, at most four in
 * flight. What can go wrong with that, and is pinned here:
 *   - a page answered out of order lands out of order in the result;
 *   - the cap is not a cap (all at once) or not concurrent at all (one by one);
 *   - page 1 stops carrying exactly the caller's parameters;
 *   - a response without `count` is cut at page 1.
 *
 * Only `axios` is faked — `axios.create` returns a stub whose `get` records its
 * arguments and answers from `answer(page)`. The functions under test are the
 * real exports, reached through the same import a caller uses.
 */


interface RecordedCall {
  path: string;
  params: Record<string, string>;
}

const recorded: RecordedCall[] = [];
type Row = { id: number };
let answer: (page: number) => unknown = () => {
  throw new Error("unscripted");
};

const stubInstance = Object.assign(vi.fn(), {
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  get: vi.fn(async (path: string, config?: { params?: Record<string, string> }) => {
    const params = { ...(config?.params ?? {}) };
    recorded.push({ path, params });
    return { data: await answer(Number(params.page ?? "1")) };
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

const { fetchAllPages, collectPages } = await import("../client");
const { configurePlatform, resetPlatform } = await import("../../platform/index");

const noopStore = { get: () => null, set: () => {}, remove: () => {} };

beforeEach(() => {
  recorded.length = 0;
  configurePlatform({
    session: noopStore,
    persistent: noopStore,
    secure: noopStore,
    onUnauthorized: () => {},
    onSessionSuspend: () => () => {},
    onSessionResume: () => () => {},
    notify: () => {},
    baseUrl: "https://api.example.test/api/v1",
  });
});

afterEach(() => {
  resetPlatform();
});

/** `total` rows in pages of `size`; page n holds ids (n-1)*size+1 … */
function paged(total: number, size: number) {
  return (page: number): PaginatedResponse<Row> => {
    const start = (page - 1) * size;
    const ids = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ id: start + i + 1 }));
    return { count: total, next: start + size < total ? `?page=${page + 1}` : null, previous: null, results: ids };
  };
}

describe("fetchAllPages", () => {
  it("asks once, with exactly the caller's parameters, when page 1 is the whole list", async () => {
    answer = paged(1, 20);
    const out = await fetchAllPages<{ id: number }>("/realms/", { civilization: "chinese", page_size: "100" });

    expect(out).toEqual([{ id: 1 }]);
    expect(recorded).toEqual([{ path: "/realms/", params: { civilization: "chinese", page_size: "100" } }]);
  });

  it("adds `page=N` to the caller's parameters for pages 2..N, and only for those", async () => {
    answer = paged(5, 2);
    const out = await fetchAllPages<{ id: number }>("/actors/", { ordering: "id" });

    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(recorded[0].params).toEqual({ ordering: "id" });
    expect(recorded.slice(1).map((c) => c.params).sort((a, b) => a.page.localeCompare(b.page))).toEqual([
      { ordering: "id", page: "2" },
      { ordering: "id", page: "3" },
    ]);
    expect(recorded.every((c) => c.path === "/actors/")).toBe(true);
  });
});

describe("collectPages", () => {
  it("keeps page order when later pages answer first", async () => {
    const rows = paged(10, 2);
    // Page n waits (6 - n) ticks: page 5 answers first, page 2 last.
    const fetchPage = async (n: number) => {
      for (let i = 0; i < 6 - n; i += 1) await Promise.resolve();
      return rows(n);
    };
    const out = await collectPages(fetchPage);
    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("has at most four requests in flight, and does use all four", async () => {
    const rows = paged(18, 2); // nine pages
    let inFlight = 0;
    let peak = 0;
    const fetchPage = async (n: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => setTimeout(() => r(), 1));
      inFlight -= 1;
      return rows(n);
    };
    const out = await collectPages(fetchPage);
    expect(out).toHaveLength(18);
    expect(peak).toBe(4);
  });

  it("asks for every page exactly once", async () => {
    const asked: number[] = [];
    const rows = paged(9, 2);
    await collectPages(async (n) => {
      asked.push(n);
      return rows(n);
    });
    expect(asked.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("follows `next` one page at a time when page 1 has no `count`", async () => {
    const rows = paged(5, 2);
    const asked: number[] = [];
    const out = await collectPages(async (n) => {
      asked.push(n);
      // An older / hand-written response: `next` but no `count`.
      return { ...rows(n), count: undefined as unknown as number };
    });
    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(asked).toEqual([1, 2, 3]);
  });
});
