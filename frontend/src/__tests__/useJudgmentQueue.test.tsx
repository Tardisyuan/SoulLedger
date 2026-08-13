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
import { judgmentApi } from "@/lib/api";

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

jest.mock("@/lib/api", () => ({
  judgmentApi: {
    next: jest.fn(),
    conclude: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
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
