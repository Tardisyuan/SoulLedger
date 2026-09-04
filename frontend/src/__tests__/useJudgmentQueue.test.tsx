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
  type PendingVerdict,
} from "@soulledger/core/hooks/useJudgmentQueue";
import { judgmentApi } from "@soulledger/core/api";
import {
  PENDING_VERDICT_KEY,
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
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockShowToast(...args),
}));

// NO `jest.mock("@/src/contexts/I18nContext")`. The hook under test stopped
// importing it when `notify` began taking a message key — the strings below are
// keys because that is what the hook now passes, not because a stub echoed them.

const mockNext = judgmentApi.next as jest.Mock;
const mockConclude = judgmentApi.conclude as jest.Mock;

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
  const adapter: PlatformAdapter = {
    session: store(),
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
  installWebPlatform();
  mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
    const skipped = params?.skip ?? [];
    const queue = [JUDGMENT_A, JUDGMENT_B].filter((j) => !skipped.includes(j.id));
    return cursorFor(queue[0] ?? null, 2, queue.length);
  });
  mockConclude.mockResolvedValue({ data: {} });
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

    expect(mockConclude).toHaveBeenCalledWith(
      JUDGMENT_A.id,
      expect.objectContaining({ verdict: "PURGATORY" })
    );
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

    expect(mockConclude).toHaveBeenCalledTimes(1);
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
  it("web 的 beforeunload 仍然照旧提交 —— 一个字节都没变", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => result.current.submitVerdict({ verdict: "PURGATORY" }));
    expect(mockConclude).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    // 走的是真事件、真适配器:useJudgmentQueue -> onSessionSuspend ->
    // lib/platform/web.ts -> window。这条链断了、或者 web 报了 "transient",
    // 这里就红。
    expect(mockConclude).toHaveBeenCalledWith(
      JUDGMENT_A.id,
      expect.objectContaining({ verdict: "PURGATORY" })
    );
    // 提交路径也清盘 —— 否则下次加载就是一条可重放的裁决。
    expect(stored()).toBeNull();
  });

  it("beforeunload 提交之后,新的一次挂载复原不出任何东西", async () => {
    const first = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.cursor.judgment).not.toBeNull());
    act(() => first.result.current.submitVerdict({ verdict: "PASSED" }));
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    first.unmount();
    mockConclude.mockClear();

    // 「刷新之后」:同一个 localStorage,新的 hook。
    const second = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.cursor.judgment).not.toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });

    expect(second.result.current.pending).toBeNull();
    expect(mockConclude).not.toHaveBeenCalled();
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

    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, expect.objectContaining({ verdict: "RETRY" }));
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
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.commit_error", "error");
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
    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.commit_error", "error");
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
