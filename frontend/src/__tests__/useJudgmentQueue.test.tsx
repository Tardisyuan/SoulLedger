/**
 * The judgment queue's session state.
 *
 * Since 2026-09-25 a verdict is POSTed the moment it is given — the user
 * removed the eight-second undo window (「落判即提交,不可撤回」, as on the
 * desk). `POST .../conclude/` creates the disposition, so what is pinned here
 * is: the request goes out on the call, nothing is held client-side, the
 * operator advances at once, and a refusal is never silent.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useJudgmentQueue } from "@soulledger/core/hooks/useJudgmentQueue";
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

// `notify` is the port the hook raises its toasts through; the rest of the
// module (the web adapter jest.setup.js installed) is kept as it is.
jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  notify: (...args: unknown[]) => mockShowToast(...args),
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

const CLAIMED_BY_OTHER = {
  response: {
    status: 409,
    data: { error: "claimed", code: "claimed_by_other", claimed_by: 7, claimed_by_name: "崔判官" },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  // A concluded case is no longer pending, so the server stops handing it out.
  const concluded = new Set<string>();
  mockNext.mockImplementation(async (params?: { skip?: string[] }) => {
    const skipped = params?.skip ?? [];
    const queue = [JUDGMENT_A, JUDGMENT_B].filter((j) => !skipped.includes(j.id) && !concluded.has(j.id));
    return cursorFor(queue[0] ?? null, 2, queue.length);
  });
  mockConclude.mockImplementation(async (id: string) => {
    concluded.add(id);
    return { data: {} };
  });
});

describe("useJudgmentQueue", () => {
  it("hands out the head of the queue", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
    expect(result.current.progress.position).toBe(1);
    expect(result.current.progress.total).toBe(2);
  });

  it("POSTs the verdict at once and holds nothing client-side", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment).not.toBeNull());

    act(() => {
      void result.current.submitVerdict({ verdict: "FAILED", notes: "罪证确凿" });
    });

    // Synchronously, inside the call — no timer, no window.
    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, {
      verdict: "FAILED",
      notes: "罪证确凿",
      create_workflow: false,
    });
    // No pending verdict, no undo, nothing written to disk for a later launch.
    expect(result.current).not.toHaveProperty("pending");
    expect(result.current).not.toHaveProperty("undo");
    expect(result.current).not.toHaveProperty("flush");
    expect(localStorage.length).toBe(0);
    await waitFor(() => expect(result.current.progress.decided).toBe(1));
  });

  it("advances to the next case immediately", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
    });

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(result.current.progress.position).toBe(2);
  });

  it("keeps the case out of `next/` while its request is in flight", async () => {
    let land: (_value: unknown) => void = () => {};
    mockConclude.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    act(() => {
      void result.current.submitVerdict({ verdict: "PASSED" });
    });

    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(lastSkip()).toContain(JUDGMENT_A.id);
    await act(async () => land({ data: {} }));
  });

  it("a second press on the same card while it is in flight sends nothing more", async () => {
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    // One act, no re-render between them — what key auto-repeat looks like.
    act(() => {
      void result.current.submitVerdict({ verdict: "PASSED" });
      void result.current.submitVerdict({ verdict: "FAILED" });
    });

    expect(mockConclude).toHaveBeenCalledTimes(1);
    expect(mockConclude).toHaveBeenCalledWith(JUDGMENT_A.id, expect.objectContaining({ verdict: "PASSED" }));
    expect(mockConclude).not.toHaveBeenCalledWith(JUDGMENT_A.id, expect.objectContaining({ verdict: "FAILED" }));
    await act(async () => {});
  });

  it("a failed POST returns the case to the queue and says so", async () => {
    mockConclude.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
    });

    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.commit_error", "error");
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
    expect(result.current.progress.decided).toBe(0);
  });

  it("409 claimed_by_other names the claimant and defers the case for the sitting", async () => {
    mockConclude.mockRejectedValueOnce(CLAIMED_BY_OTHER);
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      { key: "judgment.queue.claimed_by_other", params: { name: "崔判官" } },
      "error"
    );
    expect(mockShowToast).not.toHaveBeenCalledWith("judgment.queue.commit_error", "error");
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_B.id));
    expect(result.current.deferredCount).toBe(1);
    expect(result.current.progress.decided).toBe(0);
    expect(lastSkip()).toEqual([JUDGMENT_A.id]);
  });

  it("a claimed_by_other refusal without a name still says who holds it, as blank rather than `undefined`", async () => {
    mockConclude.mockRejectedValueOnce({ response: { status: 409, data: { code: "claimed_by_other" } } });
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      { key: "judgment.queue.claimed_by_other", params: { name: "" } },
      "error"
    );
  });

  it("a rejection that carries nothing at all is the generic refusal, not a crash", async () => {
    mockConclude.mockRejectedValueOnce(undefined);
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
    });

    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.commit_error", "error");
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));
  });

  it("with the queue exhausted, a verdict or a defer does nothing", async () => {
    mockNext.mockResolvedValue(cursorFor(null, 0, 0));
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isExhausted).toBe(true));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
      result.current.defer();
    });

    expect(mockConclude).not.toHaveBeenCalled();
    expect(result.current.deferredCount).toBe(0);
  });

  it("any other 409 is the generic refusal, not claimed_by_other", async () => {
    mockConclude.mockRejectedValueOnce({ response: { status: 409, data: { code: "realm_full" } } });
    const { result } = renderHook(() => useJudgmentQueue(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cursor.judgment?.id).toBe(JUDGMENT_A.id));

    await act(async () => {
      await result.current.submitVerdict({ verdict: "PASSED" });
    });

    expect(mockShowToast).toHaveBeenCalledWith("judgment.queue.commit_error", "error");
    expect(result.current.deferredCount).toBe(0);
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
