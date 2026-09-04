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
import { useJudgmentQueue, UNDO_WINDOW_MS } from "@/src/hooks/useJudgmentQueue";
import { judgmentApi } from "@soulledger/core/api";

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

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

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

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
    const skipped = params?.skip ?? [];
    const queue = [JUDGMENT_A, JUDGMENT_B].filter((j) => !skipped.includes(j.id));
    return cursorFor(queue[0] ?? null, 2, queue.length);
  });
  mockConclude.mockResolvedValue({ data: {} });
});

afterEach(() => {
  jest.useRealTimers();
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
    expect(result.current.pending?.judgment.id).toBe(JUDGMENT_B.id);
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
    // 这条钉的是「不重复发送」,**不是**「不提前发送」。提前发送这个缺陷仍然存在:
    // 第一次挂起就把还在撤销窗口里的裁决送走了。那是 useJudgmentQueue 的设计问题,
    // 这一轮没有修,flush 的注释里写明了。
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
