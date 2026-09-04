/**
 * The judgment queue's session state — and specifically its undo semantics,
 * which are the one part of §4.2 that can quietly become a second amendment
 * path into the audit chain.
 *
 * The property under test is narrow and load-bearing: `POST .../conclude/`
 * creates the disposition (backend/apps/judgment/services.py), so a verdict
 * that has been sent can only be changed through the ADMIN-only audited
 * correction. "Undo" is therefore only ever allowed to mean *not sending it
 * yet*. These tests fail if anything makes the POST fire earlier, or makes
 * undo fire a request of its own.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useJudgmentQueue,
  UNDO_WINDOW_MS,
  LEASE_HEARTBEAT_MS,
  LEASE_POLL_MS,
  LEASE_STALE_MS,
  verdictLeaseIsLive,
  type PendingVerdict,
} from "@soulledger/core/hooks/useJudgmentQueue";
import { judgmentApi } from "@soulledger/core/api";
import {
  ACCESS_TOKEN_KEY,
  PENDING_VERDICT_KEY,
  PENDING_VERDICT_LEASE_KEY,
  configurePlatform,
  type KeyValueStore,
  type PlatformAdapter,
  type SessionSuspendKind,
} from "@soulledger/core/platform";
import { installWebPlatform } from "@/lib/platform/web";

const mockShowToast = jest.fn();

const JUDGMENT_A = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  soul: "s-1",
  soul_name: "第一位待判者",
  civilization: "CHINESE",
  judge: null,
  judge_name: null,
  court: "第一殿",
  evidence_json: {},
  confession: "",
  verdict: null,
  notes: "",
  is_final: false,
  created_at: "2026-08-01T00:00:00Z",
  concluded_at: null,
};

const JUDGMENT_B = { ...JUDGMENT_A, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", soul_name: "第二位待判者" };

function cursorFor(judgment: typeof JUDGMENT_A | null, total = 2, remaining = 2) {
  return {
    data: {
      total,
      remaining,
      skipped: total - remaining,
      position: judgment ? total - remaining + 1 : null,
      judgment,
      soul: judgment ? { id: "s-1", name: judgment.soul_name, karmic_balance: 0 } : null,
      ledger: judgment ? { merit_score: 0, demerit_score: 0, karmic_balance: 0, records: [] } : null,
      prior_cycles: [],
      realm_options: [],
    },
  };
}

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: {
    next: jest.fn(),
    conclude: jest.fn().mockResolvedValue({ data: {} }),
    // `get` is how a session finds out what became of a verdict its
    // predecessor handed to the platform on the way out — see the
    // terminal-delivery block in the hook. Default `concluded_at: null`, i.e.
    // "not concluded", so a test that does not care about that path gets the
    // ordinary window rules rather than an unexpected branch.
    get: jest.fn().mockResolvedValue({ data: { concluded_at: null } }),
  },
}));

// The hooks under test now raise their toasts through `@soulledger/core/platform`'s
// `notify` port instead of `useToast()`. The assertions below are unchanged and
// still read `mockShowToast`; this block is what keeps pointing them at it.
//
// A `requireActual` spread rather than a bare object, and that matters: this
// module also exports the token readers and `onSessionSuspend`, and
// `jest.setup.js` has already installed the real web adapter through it.
// Replacing the whole module would take the adapter with it and break things
// that have nothing to do with toasts.
//
// Rest args, not `(message, kind, durationMs)`: forwarding a third `undefined`
// would make every `toHaveBeenCalledWith(msg, kind)` assertion below fail on an
// argument the hook never passed.
// 类型从端口本身推出来,而不是另写一遍:端口签名变了,这里停止编译,
// 而不是让 `.mock.calls[0][0]` 悄悄退化成 `any`。
const mockDeliverOnExit: jest.MockedFunction<PlatformAdapter["deliverOnExit"]> =
  jest.fn((_request) => true);

jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockShowToast(...args),
}));

// NO `jest.mock("@/src/contexts/I18nContext")`. The hook under test stopped
// importing it when `notify` began taking a message key — the strings below are
// keys because that is what the hook now passes, not because a stub echoed them.

const mockNext = judgmentApi.next as jest.Mock;
const mockConclude = judgmentApi.conclude as jest.Mock;
// 终态投递之后,下次会话拿它去问「这条到底落库了没有」。
const mockJudgmentGet = judgmentApi.get as jest.Mock;
let mockFetch: jest.Mock;
/** 终态投递发出去的那一条 `fetch`,已解析成 url + headers + body。 */
function deliveredRequest() {
  const call = mockFetch.mock.calls[0];
  const init = call[1] as { headers: Record<string, string>; body: string; keepalive?: boolean };
  return { url: String(call[0]), ...init, payload: JSON.parse(init.body) };
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/** The last `skip` array the hook asked the API for. */
function lastSkip(): string[] {
  return mockNext.mock.calls.at(-1)?.[0]?.skip ?? [];
}

/**
 * A held verdict as it is written to disk. `dueAt` is relative to the fake
 * clock, so every test that seeds one says how much window it is seeding.
 */
function record(over: Partial<PendingVerdict> = {}): PendingVerdict {
  return {
    judgmentId: JUDGMENT_A.id,
    soulName: JUDGMENT_A.soul_name,
    verdict: "PASSED",
    notes: "",
    createWorkflow: false,
    dueAt: Date.now() + UNDO_WINDOW_MS,
    ...over,
  };
}

/** What is on disk right now, through the real web adapter's own read path. */
function stored(): PendingVerdict | null {
  const raw = localStorage.getItem(PENDING_VERDICT_KEY);
  return raw === null ? null : (JSON.parse(raw) as PendingVerdict);
}

/** The liveness stamp on disk, as a number, or null if there is none. */
function lease(): number | null {
  const raw = localStorage.getItem(PENDING_VERDICT_LEASE_KEY);
  return raw === null ? null : Number(raw);
}

/**
 * A record left behind by a session that has since died, with its last
 * heartbeat `deadFor` ms ago and `left` ms of undo window remaining.
 *
 * Seeds both keys and then moves the **wall clock only** — never the timer
 * queue — because that is what a dead process looks like from the outside:
 * time passes and nothing of theirs runs. Advancing timers instead would be a
 * clock that only moves when this test's own hook is scheduled, which is the
 * one thing a crashed writer never does.
 */
function seedDeadWriter({ deadFor, left }: { deadFor: number; left: number }) {
  localStorage.setItem(
    PENDING_VERDICT_KEY,
    JSON.stringify(record({ dueAt: Date.now() + left + deadFor }))
  );
  localStorage.setItem(PENDING_VERDICT_LEASE_KEY, String(Date.now()));
  jest.setSystemTime(Date.now() + deadFor);
}

/**
 * A stand-in host: real-enough stores, and suspend/resume I can fire by hand.
 *
 * The stores are ONE `Map` each, created once per adapter and serving every
 * call — not a fresh object per `get`, which would let a hook that never wrote
 * anything read back what it thought it wrote. And they hold strings, because a
 * real store does: an implementation that stashed the object would hide a
 * `JSON.stringify`/`parse` round trip that is exactly where a persisted record
 * loses its shape.
 *
 * Only the two subscribers are pretend, and they have to be: `beforeunload` is
 * the only suspend jsdom can raise, and it is terminal by construction. A
 * transient suspend has no browser spelling — that is the whole reason the port
 * carries a kind — so the only way to exercise it is a host that reports one.
 */
function probePlatform() {
  function store(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      get: (key) => data.get(key) ?? null,
      set: (key, value) => void data.set(key, value),
      remove: (key) => void data.delete(key),
    };
  }
  const persistent = store();
  // Derived from the port rather than restated, so a handler signature that
  // changes there stops compiling here instead of drifting.
  const suspendHandlers = new Set<Parameters<PlatformAdapter["onSessionSuspend"]>[0]>();
  const resumeHandlers = new Set<() => void>();
  // 探针宿主自带一份 session store,所以 beforeEach 放进 `sessionStorage` 的
  // token 在这里读不到 —— 而没有 token 的终态投递会诚实地返回 false 且不发。
  const probeSession = store();
  probeSession.set(ACCESS_TOKEN_KEY, "test-access-token");
  const adapter: PlatformAdapter = {
    session: probeSession,
    persistent,
    secure: store(),
    onUnauthorized: () => {},
    onSessionSuspend: (handler) => {
      suspendHandlers.add(handler);
      return () => void suspendHandlers.delete(handler);
    },
    onSessionResume: (handler) => {
      resumeHandlers.add(handler);
      return () => void resumeHandlers.delete(handler);
    },
    notify: () => {},
    // A jest.fn so the terminal-delivery tests can assert both directions:
    // what was handed to the platform, and what the hook does when the
    // platform refuses it. Default `true` — accepted — because that is the
    // ordinary case and the interesting one.
    deliverOnExit: mockDeliverOnExit,
    baseUrl: "http://example.test/api/v1",
  };
  configurePlatform(adapter);
  return {
    persistent,
    suspend: (kind: SessionSuspendKind) => suspendHandlers.forEach((h) => h(kind)),
    resume: () => resumeHandlers.forEach((h) => h()),
    held: () => {
      const raw = persistent.data.get(PENDING_VERDICT_KEY);
      return raw === undefined ? null : (JSON.parse(raw) as PendingVerdict);
    },
    leaseStamp: () => {
      const raw = persistent.data.get(PENDING_VERDICT_LEASE_KEY);
      return raw === undefined ? null : Number(raw);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // A fixed wall clock. Every window assertion below is arithmetic on this, and
  // the restore path's whole job is arithmetic on `Date.now()`.
  jest.setSystemTime(new Date("2026-09-04T09:00:00Z"));
  // The hook now reads persistent storage on mount. A record left behind by the
  // previous test would be restored into this one, which is a cross-test leak
  // that looks like a hook bug.
  localStorage.clear();
  sessionStorage.clear();
  installWebPlatform();
  // 终态投递要带 `Authorization: Bearer` —— 这正是它不能用 sendBeacon 的原因,
  // 也意味着没有 token 时 `deliverOnExit` 会诚实地返回 false 而根本不发。
  // 不放这个 token,下面每一条终态测试测到的都会是「没登录」而不是它想测的东西。
  sessionStorage.setItem(ACCESS_TOKEN_KEY, "test-access-token");
  // 真 web 适配器的终态投递就是这一个调用。下探针而不是替换端口:一个替换掉
  // 端口的替身,在 useJudgmentQueue -> onSessionSuspend -> web.ts -> fetch
  // 这条链断掉时**依然会绿**,而链路断掉正是这类改动会引入的故障。
  mockFetch = jest.fn(() => Promise.resolve({ ok: true } as Response));
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
    const skipped = params?.skip ?? [];
    const queue = [JUDGMENT_A, JUDGMENT_B].filter((j) => !skipped.includes(j.id));
    return cursorFor(queue[0] ?? null, 2, queue.length);
  });
  mockConclude.mockResolvedValue({ data: {} });
  // 默认「没落库」,这样不关心投递路径的测试拿到的是普通窗口规则,
  // 而不是一条它没预料到的分支。
  mockJudgmentGet.mockResolvedValue({ data: { concluded_at: null } });
  // `clearAllMocks` 会连实现一起清掉,所以默认值要在这里重新装回去。
  mockDeliverOnExit.mockReturnValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  // Some tests below install a probe host. Put the browser back, so a suite
  // that runs after them is not quietly talking to a `Map`.
  installWebPlatform();
  localStorage.clear();
});

describe("useJudgmentQueue", () => {
  it("hands out the head of the queue", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
    expect(result.current.progress.position).toBe(1);
    expect(result.current.progress.total).toBe(2);
  });

  it("does NOT send the verdict when it is given", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    // The whole undo design rests on this line.
    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending?.verdict).toBe("PASSED");
  });

  it("advances to the next case immediately, without waiting for the send", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(lastSkip()).toContain(JUDGMENT_A.id);
  });

  it("sends the verdict once the undo window closes", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "FAILED", notes: "罪证确凿" }));
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS + 10);
    });

    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, {
      verdict: "FAILED",
      notes: "罪证确凿",
      create_workflow: false,
    });
    expect(result.current.pending).toBeNull();
  });

  it("undo cancels the send outright — no request of any kind", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    act(() => result.current.undo());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("counts a held verdict as progress, so the counter tracks the screen", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.progress.position).toBe(1));

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    // Case 2 is on screen even though case 1's verdict has not been sent.
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(result.current.progress.position).toBe(2);
  });

  it("undo puts the case back at the head of the queue", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));

    act(() => result.current.undo());

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
    expect(lastSkip()).not.toContain(JUDGMENT_A.id);
  });

  it("a second verdict flushes the first, so undo is never a stack", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    act(() => result.current.submitVerdict({ verdict: "FAILED" }));
    // Let the flushed send settle inside act(), so its state updates land
    // before the assertions rather than after the test has finished.
    await act(async () => {});

    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, expect.objectContaining({ verdict: "PASSED" }));
    expect(result.current.pending?.judgmentId).toBe(JUDGMENT_B.id);
  });

  it("unmounting sends the held verdict rather than dropping it", async () => {
    const { result, unmount } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PURGATORY" }));
    await act(async () => {
      unmount();
    });

    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, expect.objectContaining({ verdict: "PURGATORY" }));
  });

  it("挂起会话也会送出扣在手里的裁决 —— 不靠卸载", async () => {
    // 这条对应的是 unmount 那条**没有**覆盖的另一半路径。操作员给了裁决然后直接
    // 关标签页,组件不会卸载,清理函数不会跑 —— 送出与否全看那个挂起监听。
    //
    // 走的是 `beforeunload` 这个真事件,不是 mock:jest.setup.js 装的是真的 web
    // 适配器,所以这条同时验证了 useJudgmentQueue -> onSessionSuspend ->
    // lib/platform/web.ts -> window 这一整条链。一个 mock 掉端口的替身在链路断掉时
    // 依然会绿,而链路断掉正是这次改动可能引入的故障。
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PURGATORY" }));
    expect(mockConclude).not.toHaveBeenCalled();   // 还在撤销窗口里扣着

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    // **不是** `mockConclude`。终态路径上 axios 是错的工具:文档 unload 会中止
    // 它自己的 XHR,所以那条 POST 是被触发它的那个事件取消掉的。这条断言的
    // 反面比正面更重要 —— 旧版本断言的正是 `mockConclude` 被调用,而它在
    // jsdom 里恒绿,因为 jsdom 根本没有 unload。
    expect(mockConclude).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const req = deliveredRequest();
    expect(req.url).toContain(`/judgment/${JUDGMENT_A.id}/conclude/`);
    // `keepalive` 是这条请求能活过文档卸载的全部原因 —— 少了它,它就退回成
    // 被 unload 中止的那种请求,也就是这次修复的起点。
    expect(req.keepalive).toBe(true);
    // 凭据必须在头里 —— 这正是这条路径不能用 sendBeacon 的原因。
    expect(req.headers.Authorization).toMatch(/^Bearer /);
    expect(req.payload).toMatchObject({ verdict: "PURGATORY" });
  });

  it("挂起两次只送出一次 —— 端口契约说它可以反复触发", async () => {
    // `onSessionSuspend` 的契约(见 packages/core/src/platform/types.ts)现在明写
    // 「可能触发很多次」:web 的 `beforeunload` 只来一次,而 React Native 的
    // `AppState → background` 每次切应用都来一次。所以 `flush()` 必须是幂等的
    // —— 第二次调用不能再发一遍 POST,否则同一条裁决会被 conclude 两次,而
    // conclude 会建 disposition。
    //
    // 这条钉的是「不重复发送」,**不是**「不提前发送」。两件事,两组测试:
    // 「提前发送」那条缺陷现在由下面 “terminal vs transient” 那一组盯着 ——
    // 瞬态挂起不再提交。这一条仍然只管幂等,因为终态挂起本身也可能来不止一次
    // (被别的监听器取消掉的导航会让 `beforeunload` 再来一遍)。
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PURGATORY" }));

    // Both in ONE act, deliberately. Separate acts let React re-render between
    // them, and the re-render reassigns `pendingRef.current` from the now-null
    // `pending` state — so the second flush would find nothing held even if
    // `flush` itself had stopped clearing the ref. That version of this test
    // passes against a `flush` with its `pendingRef.current = null` deleted,
    // i.e. it would be measuring React rather than the hook. Fired back to back
    // with no render in between, the only thing that can stop the second send
    // is `flush`'s own guard.
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
      window.dispatchEvent(new Event("beforeunload"));
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("defer hides the case for the sitting and writes nothing", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => result.current.defer());

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(mockConclude).not.toHaveBeenCalled();
    expect(lastSkip()).toEqual([JUDGMENT_A.id]);
    expect(result.current.deferredCount).toBe(1);
  });

  it("restoreDeferred brings deferred cases back", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => result.current.defer());
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    act(() => result.current.restoreDeferred());

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
    expect(result.current.deferredCount).toBe(0);
  });

  it("a failed send returns the case to the queue instead of losing it", async () => {
    mockConclude.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS + 10);
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.commit_error", "error"));
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
  });

  it("reports the queue exhausted once nothing is left", async () => {
    mockNext.mockResolvedValue(cursorFor(null, 0, 0));
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isExhausted).toBe(true));
    expect(result.current.progress.total).toBe(0);
  });

  it("latches the denominator so it does not tick down under the operator", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.progress.total).toBe(2));

    // Server now reports a smaller queue (someone else ruled on one).
    mockNext.mockResolvedValue(cursorFor(JUDGMENT_B, 1, 1));
    act(() => result.current.defer());

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(result.current.progress.total).toBe(2);
  });

  it("passes `at` through so a deep link enters the queue on its case", async () => {
    renderHook(() => useJudgmentQueue({ at: JUDGMENT_B.id }), { wrapper: wrapper() });
    await waitFor(() => expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ at: JUDGMENT_B.id })));
  });
});

/**
 * The held verdict on disk.
 *
 * A verdict lives for eight seconds in a variable, and a process can end in
 * that window without warning — an OS reclaiming a backgrounded app, a tab
 * discarded, a crash. The copy exists so that does not lose a decision the
 * operator made. It is also the single most dangerous object in this hook: a
 * judicial verdict, replayable by any later process that finds it. Every test
 * here is about one of the two.
 */
describe("扣住的裁决落盘", () => {
  it("给出裁决时就写盘 —— 不等挂起", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "FAILED", notes: "罪证确凿" }));

    // 落的是完整的一条,不是一个 id —— 复原时要能原样发出去。
    expect(stored()).toEqual({
      judgmentId: JUDGMENT_A.id,
      soulName: JUDGMENT_A.soul_name,
      verdict: "FAILED",
      notes: "罪证确凿",
      createWorkflow: false,
      dueAt: Date.now() + UNDO_WINDOW_MS,
    });
    // 写盘不等于发送。
    expect(mockConclude).not.toHaveBeenCalled();
  });

  it("送出之后盘上不留 —— 断的是**不存在**", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS + 10);
    });

    expect(mockConclude).toHaveBeenCalledTimes(1);
    // 送出后还躺在盘上的那一条,就是下一次启动会重放的那一条。
    expect(stored()).toBeNull();
  });

  it("撤销之后盘上不留", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    expect(stored()).not.toBeNull();
    act(() => result.current.undo());

    expect(stored()).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });
    expect(mockConclude).not.toHaveBeenCalled();
  });
});

/**
 * 终态挂起与瞬态挂起。
 *
 * web 的 `beforeunload` 是终态的:之后页面就没了,现在不发就永远不发。RN 的
 * `AppState → background` 每次切 app 都来一次,而 app 好好活着。同一个处理器,
 * 两种相反的正确行为 —— 端口现在把是哪一种告诉它。
 */
describe("terminal vs transient suspend", () => {
  it("web 的 beforeunload 走终态投递,而且**把记录留在盘上**", async () => {
    // 这条曾叫「一个字节都没变」,断言 `mockConclude` 被调用、`stored()` 为
    // null。两条都是在给缺陷背书:
    //
    //   - `conclude` 是 axios 是 XHR,文档 unload 会中止它。在 jsdom 里它恒绿,
    //     因为 jsdom 没有 unload —— 一条永远不会触发的检查。
    //   - `stored()` 为 null 正是「先清记录再发一个发不出去的请求」,判决两头
    //     落空的那一半。
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PURGATORY" }));
    expect(mockFetch).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    // 走的是真事件、真适配器:useJudgmentQueue -> onSessionSuspend ->
    // lib/platform/web.ts -> window。链断了、或者 web 报了 "transient",这里红。
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 记录**留着**,并且带上了投递戳。没有这个戳,下次会话会按普通窗口规则
    // 报 stale_discarded ——「没送出去」—— 而 keepalive 请求很可能送到了。
    const kept = stored();
    expect(kept).toMatchObject({ judgmentId: JUDGMENT_A.id, verdict: "PURGATORY" });
    expect(typeof kept?.deliveredAt).toBe("number");
  });

  it("宿主拒绝投递时,记录留着但**不**盖投递戳", async () => {
    // 端口返回 false 的三种成因:没装适配器、没有 token、keepalive 配额满。
    // 三种都意味着请求没被接受,所以下次会话该走普通窗口规则,而不是去问服务端
    // 一件根本没发生过的事。
    // keepalive 配额满时 `fetch` 是**同步**抛的,适配器把它翻译成 false。
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError("keepalive quota exceeded");
    });
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "FAILED" }));

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    const kept = stored();
    expect(kept).toMatchObject({ judgmentId: JUDGMENT_A.id, verdict: "FAILED" });
    expect(kept?.deliveredAt).toBeUndefined();
  });

  it("下次挂载:投递已落库 —— 说它落了,不重发", async () => {
    // 旧测试在这里断言「复原不出任何东西」,那正是缺陷的形状:判决被丢掉,
    // 而且一声不吭。现在记录还在,所以这条问的是**它去问了服务端没有**。
    const first = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.cursor.judgment).not.toBeNull());
    act(() => first.result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    first.unmount();
    mockConclude.mockClear();
    mockShowToast.mockClear();
    // keepalive 那条真的到了服务端。
    mockJudgmentGet.mockResolvedValue({ data: { concluded_at: "2026-09-05T00:00:00Z" } });

    const second = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    expect(mockJudgmentGet).toHaveBeenCalledWith(JUDGMENT_A.id);
    // 已经落库了,再发一次就是第二个 disposition。
    expect(mockConclude).not.toHaveBeenCalled();
    expect(second.result.current.pending).toBeNull();
    // 说出来。既不是 commit_error(什么都没出错),也不是沉默。
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.delivery_landed", "info");
    // 缺席断言:绝不能报「没送出去」,那在这条路径上是假话。
    expect(mockShowToast).not.toHaveBeenCalledWith("judgment.queue.stale_discarded", "error");
  });

  it("下次挂载:投递没落库,窗口已过 —— stale_discarded 这次是核实过的", async () => {
    const first = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.cursor.judgment).not.toBeNull());
    act(() => first.result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    first.unmount();
    mockShowToast.mockClear();
    mockJudgmentGet.mockResolvedValue({ data: { concluded_at: null } });

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    });
    const second = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(mockJudgmentGet).toHaveBeenCalledWith(JUDGMENT_A.id);
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.stale_discarded", "error");
  });

  it("下次挂载:问不到服务端 —— 丢弃并说明「不知道」,而不是重发", async () => {
    // 这条是三个分支里唯一有争议的一个,所以它有自己的测试。问不到就是问不到,
    // 而 hook 的表头把顺序定死了:丢掉的判决把案子退回队列,重放的判决建出一个
    // 只有 ADMIN 更正才能撤的 disposition。所以选丢,并且告诉操作员去核对。
    const first = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.cursor.judgment).not.toBeNull());
    act(() => first.result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    first.unmount();
    mockConclude.mockClear();
    mockShowToast.mockClear();
    mockJudgmentGet.mockRejectedValue(new Error("network"));

    const second = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(second.result.current.pending).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.delivery_unverified", "error");
  });

  it("瞬态挂起**不**提交 —— 裁决还扣着,撤销条还在,盘上还留着", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "FAILED", notes: "切了个 app" }));

    await act(async () => {
      // 切走、切回来、再切走:RN 上一分钟能有好几次。
      probe.suspend("transient");
      probe.suspend("transient");
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending?.verdict).toBe("FAILED");
    // 「不提交」必须配「已落盘」,否则这条测的就只是「什么都没做」。
    expect(probe.held()).toMatchObject({ judgmentId: JUDGMENT_A.id, verdict: "FAILED" });
  });

  it("瞬态挂起之后,撤销仍然拦得住 —— 这才是那条缺陷的症状", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    await act(async () => probe.suspend("transient"));
    act(() => result.current.undo());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    // 缺陷的样子:切一次 app 之后撤销「成功」了,却什么也没拦下来。
    expect(mockConclude).not.toHaveBeenCalled();
    expect(probe.held()).toBeNull();
  });

  it("瞬态挂起不影响原本的定时器 —— 窗口走完照样发一次", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    await act(async () => probe.suspend("transient"));
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS + 10);
    });

    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(probe.held()).toBeNull();
  });

  it("终态挂起从探针宿主发来时也照样提交 —— 分流看的是 kind,不是平台", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "RETRY" }));

    await act(async () => probe.suspend("terminal"));

    // 分流看的是 `kind`,不是平台 —— 探针宿主报 terminal,走的就是终态投递,
    // 和 web 的 beforeunload 同一条路。
    expect(mockDeliverOnExit).toHaveBeenCalledTimes(1);
    const req = mockDeliverOnExit.mock.calls[0][0];
    expect(req.url).toContain(`/judgment/${JUDGMENT_A.id}/conclude/`);
    expect(JSON.parse(req.body)).toMatchObject({ verdict: "RETRY" });
  });
});

/**
 * 回到前台:按墙钟重新对表。
 *
 * RN 在后台会冻结 JS 定时器,所以切回来时那个 `setTimeout` 晚了「你离开多久」
 * 那么多,而屏幕上的倒计时也差了同样多。只有 `Date.now()` 一直在走。
 *
 * 这几条用 `jest.setSystemTime` 单独推墙钟、**不**推定时器队列 —— 那正是被冻结
 * 的样子。用 `advanceTimersByTime` 推会两个一起动,于是测不到任何东西。
 */
describe("resume 按墙钟重新对表", () => {
  it("后台待到窗口过期,回来立刻提交", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    await act(async () => probe.suspend("transient"));
    // 定时器冻着,墙钟走了十分钟。
    jest.setSystemTime(Date.now() + 10 * 60 * 1000);
    expect(mockConclude).not.toHaveBeenCalled();

    await act(async () => probe.resume());

    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(probe.held()).toBeNull();
  });

  it("后台只待了一会儿,回来续上剩下的窗口 —— 不是重新给八秒", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    await act(async () => probe.suspend("transient"));
    jest.setSystemTime(Date.now() + 5000);
    await act(async () => probe.resume());

    // 还剩 3 秒:2.9 秒时不许发。
    await act(async () => {
      jest.advanceTimersByTime(2900);
    });
    expect(mockConclude).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockConclude).toHaveBeenCalledTimes(1);
  });

  it("回到前台时租约当场补一次 —— 不等下一拍", async () => {
    // 心跳和提交定时器一起被冻住,所以切回来的那一刻,盘上的租约和屏幕上的倒计时
    // 一样陈旧。interval 自己会接着跑,但下一拍最远在 LEASE_HEARTBEAT_MS 之外,
    // 而这个会话此刻明摆着活着 —— 那段空档里,另一个标签页读到的是一份看起来
    // 死了的租约。
    //
    // RN 上没有第二个进程能读到它;web 上 bfcache 复原回到的浏览器里有别的标签页,
    // 而那是同一个事件。
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    const stamped = probe.leaseStamp();

    await act(async () => probe.suspend("transient"));
    // 定时器冻着,墙钟走了两秒:租约没人续。
    jest.setSystemTime(Date.now() + 2000);
    expect(probe.leaseStamp()).toBe(stamped);

    await act(async () => probe.resume());

    expect(probe.leaseStamp()).toBe(Date.now());
  });

  it("手里没扣东西时,resume 什么都不做", async () => {
    const probe = probePlatform();
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    await act(async () => probe.resume());

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });
});

/**
 * 崩溃之后的那一次启动 —— 这次改动最危险的一条路径。
 *
 * 用户在两个更省事的方案之外挑了这个,并且事先被告知了风险:**把没提交的裁决
 * 持久化下来,崩溃或升级之后重放一条旧裁决,比丢掉它更糟。** 下面每一条都是那句
 * 话的一个面。
 */
describe("重新启动时复原扣住的裁决", () => {
  it("窗口真的还有剩,就把撤销条还给操作员", async () => {
    localStorage.setItem(PENDING_VERDICT_KEY, JSON.stringify(record({ dueAt: Date.now() + 3000 })));

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pending).not.toBeNull());

    expect(result.current.pending).toMatchObject({ judgmentId: JUDGMENT_A.id, verdict: "PASSED" });
    // 复原不是发送。
    expect(mockConclude).not.toHaveBeenCalled();
    // 剩多少是多少,不是重新给八秒。
    await act(async () => {
      jest.advanceTimersByTime(2900);
    });
    expect(mockConclude).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, expect.objectContaining({ verdict: "PASSED" }));
  });

  it("复原之后按下撤销,一次请求都不会发出", async () => {
    localStorage.setItem(PENDING_VERDICT_KEY, JSON.stringify(record({ dueAt: Date.now() + 3000 })));
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pending).not.toBeNull());

    act(() => result.current.undo());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    expect(mockConclude).not.toHaveBeenCalled();
  });

  it("**读一次就删** —— 同一条不会被两个进程各发一遍", async () => {
    localStorage.setItem(PENDING_VERDICT_KEY, JSON.stringify(record({ dueAt: Date.now() + 3000 })));

    const first = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.pending).not.toBeNull());
    // 挂载那一刻就没了,不是等提交完才没。两个标签页、一个崩溃重启循环,
    // 都会在这个空档里读到同一条。
    expect(stored()).toBeNull();

    const second = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.cursor.judgment).not.toBeNull());
    expect(second.result.current.pending).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });
    expect(mockConclude).toHaveBeenCalledTimes(1);
  });

  it("窗口已经过去的,**绝不**提交 —— 丢掉,并且说出来", async () => {
    localStorage.setItem(PENDING_VERDICT_KEY, JSON.stringify(record({ dueAt: Date.now() - 1 })));

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 5);
    });

    // 断的是**不存在**:一条陈旧裁决被静默发出去,是这次改动唯一不可接受的结局。
    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
    expect(stored()).toBeNull();
    // 而且不是静默的:操作员裁决过、看着那条案子离开了屏幕,必须知道它没被记下。
    //
    // **不是** `commit_error`。那句话说的是「裁决没送达」,隐含「送过一次」;
    // 这条路径上一个请求都没发出去。断言写死这个键,是因为「说了话」和
    // 「说的是这句话」是两件事,而前者绿着的时候后者可以是错的。
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.stale_discarded", "error");
    expect(mockShowToast).not.toHaveBeenCalledWith("judgment.queue.commit_error", "error");
  });

  it("过期一整天的也一样 —— 不是「差一点」才丢", async () => {
    localStorage.setItem(
      PENDING_VERDICT_KEY,
      JSON.stringify(record({ dueAt: Date.now() - 24 * 60 * 60 * 1000 }))
    );

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 5);
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("墙钟往回跳过(NTP、手动改表),读出来的窗口比整个窗口还长 —— 丢掉", async () => {
    // 正常时钟下 `dueAt - now` 不可能超过 UNDO_WINDOW_MS,所以超过了就说明这条
    // 记录根本没法推理。给它一个「还剩很久」的窗口,等于让一条来历不明的裁决
    // 在操作员面前坐等发送。
    localStorage.setItem(
      PENDING_VERDICT_KEY,
      JSON.stringify(record({ dueAt: Date.now() + UNDO_WINDOW_MS * 5 }))
    );

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 10);
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
    expect(stored()).toBeNull();
    // 跟上面那条**不是**同一句话。上面那条的事实是「窗口走完了」,这条的事实是
    // 「窗口在哪儿都不知道」。共用一个键会让其中一句变成没有依据的断言。
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.skew_discarded", "error");
    expect(mockShowToast).not.toHaveBeenCalledWith("judgment.queue.stale_discarded", "error");
  });

  it.each([
    ["不是 JSON", "{ 这不是 json"],
    ["不是对象", '"PASSED"'],
    ["缺字段", JSON.stringify({ judgmentId: JUDGMENT_A.id })],
    ["verdict 不在四个里", JSON.stringify({ ...record(), verdict: "EXILE" })],
    ["dueAt 是字符串", JSON.stringify({ ...record(), dueAt: "soon" })],
    ["dueAt 是 NaN", JSON.stringify({ ...record(), dueAt: Number.NaN })],
    ["createWorkflow 是字符串", JSON.stringify({ ...record(), createWorkflow: "true" })],
  ])("盘上是%s时,既不复原也不发送", async (_label, raw) => {
    localStorage.setItem(PENDING_VERDICT_KEY, raw);

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
    // 读不懂的字节没有可说的实话,所以这一支不吵操作员 —— 但也不能留着,
    // 否则每次启动都要再读一遍同一堆垃圾。
    expect(stored()).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("盘上是空的时候,挂载不碰任何存储", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    expect(result.current.pending).toBeNull();
    expect(stored()).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

/**
 * 谁还活着 —— 一个 localStorage,两个标签页。
 *
 * 上面那一组「重新启动时复原」全都假设:盘上的记录是**没人再管**的。在 web 上
 * 那是半个假设。`persistent` 是每台设备一份,不是每个会话一份,所以第二个标签页
 * 在第一个的八秒窗口里挂载,读到的是**还在被人扣着**的那条裁决。
 *
 * 分辨的不是「谁写的」—— 崩溃重启后的进程也不是写它的那个,按写者拒绝会把这份
 * 持久化唯一存在的理由拒绝掉 —— 而是「写它的那个还在不在跑」。写者边扣边续租约,
 * 读到的会话看租约。
 *
 * 这一组里最要紧的两条往**相反**方向失败:活着的不许被接管,死了的必须被接管。
 * 任何只朝一个方向想的修法,都会踩红其中一条。
 */
describe("裁决记录的归属:活着的写者 vs 死掉的写者", () => {
  it("第一个标签页还活着时,第二个标签页**不**接管它的裁决", async () => {
    const first = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.cursor.judgment).not.toBeNull());
    act(() => first.result.current.submitVerdict({ verdict: "PASSED" }));
    expect(stored()).not.toBeNull();

    // 两秒后开第二个标签页:同一个 localStorage,窗口还剩六秒。
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    const second = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.cursor.judgment).not.toBeNull());

    // 没接管:第二个标签页的操作员没裁决过任何东西,不该看见撤销条。
    expect(second.result.current.pending).toBeNull();
    // 也**没删**。这条断言和上面那条一样重要:接管路径的第一件事是「读完就删」,
    // 而这条记录不是它的。删了就等于——第一个标签页两秒后再崩,盘上什么都不剩。
    expect(stored()).not.toBeNull();
    // 什么也没发生,所以什么也不该说。
    expect(mockShowToast).not.toHaveBeenCalled();

    // 窗口走完:只发一次,由扣着它的那个标签页发。
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });
    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(second.result.current.pending).toBeNull();
    // 第一个标签页发完就清盘,盯着的那个于是收摊 —— 静悄悄地。
    expect(stored()).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("写它的进程真的死了、窗口还有剩 —— 必须接管", async () => {
    // 「只有写它的会话才能复原」在这里红:重启后的进程从来就不是写它的那个。
    // 这条是那个修法的反例,也是这份持久化存在的全部理由。
    seedDeadWriter({ deadFor: LEASE_STALE_MS + 500, left: 4000 });

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pending).not.toBeNull());

    expect(result.current.pending).toMatchObject({ judgmentId: JUDGMENT_A.id, verdict: "PASSED" });
    // 接管不是发送。
    expect(mockConclude).not.toHaveBeenCalled();
    // 读一次就删,两个键一起。
    expect(stored()).toBeNull();
    expect(lease()).toBeNull();
    // 剩多少是多少。
    await act(async () => {
      jest.advanceTimersByTime(3900);
    });
    expect(mockConclude).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockConclude).toHaveBeenCalledTimes(1);
  });

  it("崩溃之后立刻重启:挂载那一刻分不出死活,于是等 —— 等到确定,再接管", async () => {
    // 这条是「等」而不是「拒绝」的理由。重启很快(重新加载一个标签页、热启动一个
    // app),所以挂载的瞬间,上一个进程的租约往往还很新。当场判定就只有两个选择:
    // 判它活着 → 永远不接管,崩溃恢复作废;判它死了 → 阈值必须小到会误杀活着的。
    seedDeadWriter({ deadFor: 1000, left: 7000 });

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    expect(result.current.pending).toBeNull();
    expect(stored()).not.toBeNull();

    // 时间往前走,而**没有任何东西**在续那份租约 —— 这就是死掉的样子。
    await act(async () => {
      jest.advanceTimersByTime(LEASE_STALE_MS + LEASE_POLL_MS);
    });

    expect(result.current.pending).toMatchObject({ judgmentId: JUDGMENT_A.id });
    expect(stored()).toBeNull();
    expect(lease()).toBeNull();
    expect(mockConclude).not.toHaveBeenCalled();
  });

  it("崩溃发生在窗口的最后几秒 —— 等到确定它死了,窗口已经没了,于是丢掉并说出来", async () => {
    // 这次改动**换来的代价**,写在这里而不是等人去发现:确认一个写者死了要花
    // LEASE_STALE_MS + LEASE_POLL_MS,这段时间也在窗口里走。窗口末尾崩溃的那几秒
    // 从此不可恢复 —— 案子退回队列,操作员重判,这是这份文件一贯选的那一边。
    seedDeadWriter({ deadFor: 500, left: 2000 });

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(LEASE_STALE_MS + LEASE_POLL_MS);
    });

    expect(result.current.pending).toBeNull();
    expect(mockConclude).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.stale_discarded", "error");
  });

  it("盘上有记录、没有租约(上一版写下的)—— 立刻接管,和加租约之前一模一样", async () => {
    // 向后兼容不是善意,是行为的定义:没有租约就是「没人声称在管它」,而那正是
    // 接管的条件。ed4355d 写下的记录不会因为这次改动被卡住。
    localStorage.setItem(PENDING_VERDICT_KEY, JSON.stringify(record({ dueAt: Date.now() + 3000 })));
    expect(lease()).toBeNull();

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pending).not.toBeNull());

    expect(stored()).toBeNull();
    expect(mockConclude).not.toHaveBeenCalled();
  });

  it("租约读不懂时,当作没有租约 —— 接管", async () => {
    localStorage.setItem(PENDING_VERDICT_KEY, JSON.stringify(record({ dueAt: Date.now() + 3000 })));
    localStorage.setItem(PENDING_VERDICT_LEASE_KEY, "soon");

    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pending).not.toBeNull());
    expect(stored()).toBeNull();
  });

  it("给出裁决时落下租约,并且一直在续 —— 不是写一次就不管", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    const first = lease();
    expect(first).toBe(Date.now());

    await act(async () => {
      jest.advanceTimersByTime(LEASE_HEARTBEAT_MS * 3);
    });

    // 断的是「续过」。只写一次的租约三秒后自己就「死」了,而这个会话还活着 ——
    // 那正是隔壁标签页会拿走它裁决的那一刻。
    expect(lease()).toBeGreaterThan(first as number);
    expect(Date.now() - (lease() as number)).toBeLessThanOrEqual(LEASE_HEARTBEAT_MS);
  });

  it("送出之后租约不留,心跳也停", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS + 10);
    });
    expect(lease()).toBeNull();

    // 心跳停没停,只能靠「再等一会儿它还是空的」来断 —— 一个没停的 setInterval
    // 会自己把租约写回来。
    await act(async () => {
      jest.advanceTimersByTime(LEASE_HEARTBEAT_MS * 3);
    });
    expect(lease()).toBeNull();
  });

  it("撤销之后租约不留,心跳也停", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PASSED" }));
    act(() => result.current.undo());
    expect(lease()).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(LEASE_HEARTBEAT_MS * 3);
    });
    expect(lease()).toBeNull();
  });

  it("卸载之后心跳不留 —— 一个活过组件的 interval 会一直往存储里写", async () => {
    const { result, unmount } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());
    act(() => result.current.submitVerdict({ verdict: "PASSED" }));

    await act(async () => {
      unmount();
    });
    expect(lease()).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(LEASE_HEARTBEAT_MS * 5);
    });
    expect(lease()).toBeNull();
  });
});

/**
 * 租约本身的判读,单独钉住 —— 边界在哪一边,是这次改动里唯一的自由参数。
 */
describe("verdictLeaseIsLive", () => {
  const NOW = 1_757_000_000_000;

  it("整整 LEASE_STALE_MS 的沉默仍然算活着 —— 平局判给「别人的」", () => {
    // 比较是 `age > LEASE_STALE_MS`,不是 `>=`。判错成「活着」多等一轮轮询,
    // 判错成「死了」就是另一个操作员的控制台上多一条错误提示。
    expect(verdictLeaseIsLive(String(NOW - LEASE_STALE_MS), NOW)).toBe(true);
    expect(verdictLeaseIsLive(String(NOW - LEASE_STALE_MS - 1), NOW)).toBe(false);
  });

  it("没有租约、空串、读不出数字,都算没人管", () => {
    expect(verdictLeaseIsLive(null, NOW)).toBe(false);
    expect(verdictLeaseIsLive("", NOW)).toBe(false);
    expect(verdictLeaseIsLive("soon", NOW)).toBe(false);
    expect(verdictLeaseIsLive("NaN", NOW)).toBe(false);
  });

  it("盖在未来的租约算活着 —— 一个读不懂的声明,安全的读法是「不是我的」", () => {
    // 墙钟往回跳过之后会出现。它不是永久的沉默:钟被校正回来,年龄就长大,
    // 记录随后由自己的 skew 分支报出去。
    expect(verdictLeaseIsLive(String(NOW + 60_000), NOW)).toBe(true);
  });
});
