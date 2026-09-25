/**
 * Tests for useJudgments hooks
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useJudgments,
  useCreateJudgment,
  useConcludeJudgment,
  useRuleEvidence,
  useSaveJudgmentDraft,
  useJudgmentDestinations,
  useJudgmentPrevious,
} from "@soulledger/core/hooks/useJudgments";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { judgmentApi } from "@soulledger/core/api";

const mockShowToast = jest.fn();

// `mockInvalidateQueries` 与 `mockShowToast` 曾经在这里各占一行,而**两个都
// 没有被任何 `jest.mock` 工厂引用**,也没有任何断言读它们 —— 下面的
// `jest.mock("@/src/components/ui/Toast")` 用的是一个就地新建的 `jest.fn()`。
// 它们制造出「这条测试在观察 toast 与缓存失效」的观感,而实际什么都没观察。
//
// 藏了很久:`src/__tests__/**` 整个在 eslint 的 `ignores` 里,主块又把
// `no-unused-vars` 关成了 off。

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
    create: jest.fn().mockResolvedValue({ data: {} }),
    conclude: jest.fn().mockResolvedValue({ data: {} }),
    ruleEvidence: jest.fn().mockResolvedValue({ data: { admission: {}, admitted_balance: {} } }),
    saveDraft: jest.fn().mockResolvedValue({
      data: { notes: "saved", draft_verdict: "FAILED", draft_version: 4, draft_saved_at: "2026-09-24T00:00:00Z" },
    }),
    destinations: jest.fn().mockResolvedValue({
      data: { verdict: "FAILED", default_realm_id: null, default_term_years: null, options: [] },
    }),
    previous: jest.fn().mockResolvedValue({ data: { judgment: null } }),
  },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.spyOn(queryClient, "invalidateQueries");
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Shape tests (sanity) ──────────────────────────────────────────────

describe("useJudgments", () => {
  it("returns query result shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useJudgments(), { wrapper });
    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
  });
});

describe("useCreateJudgment", () => {
  it("returns mutation shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateJudgment(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useConcludeJudgment", () => {
  it("returns mutation shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConcludeJudgment(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

// ── Behavior tests ────────────────────────────────────────────────────

describe("useJudgments behavior", () => {
  it("fetches judgments list via judgmentApi.list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useJudgments(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.list).toHaveBeenCalled();
  });

  it("passes params through to judgmentApi.list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useJudgments({ status: "PENDING" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.list).toHaveBeenCalledWith({ status: "PENDING" });
  });
});

describe("useJudgmentDestinations / useJudgmentPrevious (「戊 · 发落」, 「上一件」)", () => {
  it("does not ask for destinations until a verdict is chosen", () => {
    const { wrapper } = createWrapper();
    renderHook(() => useJudgmentDestinations("j1", null), { wrapper });
    expect(judgmentApi.destinations).not.toHaveBeenCalled();
  });

  it("asks for the destinations of that verdict", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useJudgmentDestinations("j1", "FAILED"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.destinations).toHaveBeenCalledWith("j1", "FAILED");
    expect(result.current.data?.options).toEqual([]);
  });

  it("walks back from `at` with the skips, and only once there is an `at`", async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useJudgmentPrevious(undefined), { wrapper });
    expect(judgmentApi.previous).not.toHaveBeenCalled();
    const { result } = renderHook(() => useJudgmentPrevious("c", ["b"]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.previous).toHaveBeenCalledWith({ at: "c", skip: ["b"] });
  });
});

describe("useCreateJudgment behavior", () => {
  it("calls judgmentApi.create with provided data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ soulId: "soul-1", verdict: "REBORN" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.create).toHaveBeenCalledWith({ soulId: "soul-1", verdict: "REBORN" });
  });

  it("invalidates judgment queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ soulId: "soul-1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["judgments"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ soulId: "soul-1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "success"
    );
  });

  it("shows error toast on failure", async () => {
    (judgmentApi.create as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ soulId: "soul-1" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });
});

describe("useConcludeJudgment behavior", () => {
  it("calls judgmentApi.conclude with id and data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConcludeJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "judgment-1", data: { result: "PURGATORY" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.conclude).toHaveBeenCalledWith("judgment-1", { result: "PURGATORY" });
  });

  it("invalidates judgment queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useConcludeJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "judgment-1", data: { result: "PURGATORY" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["judgments"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConcludeJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "judgment-1", data: { result: "PURGATORY" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "success"
    );
  });

  it("shows error toast on failure", async () => {
    (judgmentApi.conclude as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useConcludeJudgment(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "judgment-1", data: { result: "PURGATORY" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });
});

describe("useRuleEvidence behavior", () => {
  it("PUTs the ruling for that record and refetches only this judgment's detail", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useRuleEvidence("judgment-1"), { wrapper });
    await act(async () => {
      result.current.mutate({ recordId: "rec-1", data: { admitted: false, reason: "证人翻供" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.ruleEvidence).toHaveBeenCalledWith("judgment-1", "rec-1", { admitted: false, reason: "证人翻供" });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: judgmentKeys.detail("judgment-1") });
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

describe("useSaveJudgmentDraft behavior", () => {
  it("writes the saved draft into the cached detail instead of refetching", async () => {
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(judgmentKeys.detail("judgment-1"), {
      id: "judgment-1", notes: "old", draft_version: 3, court: "第一殿",
    });
    const { result } = renderHook(() => useSaveJudgmentDraft("judgment-1"), { wrapper });
    await act(async () => {
      result.current.mutate({ version: 3, notes: "saved" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(judgmentApi.saveDraft).toHaveBeenCalledWith("judgment-1", { version: 3, notes: "saved" });
    expect(queryClient.getQueryData(judgmentKeys.detail("judgment-1"))).toEqual({
      id: "judgment-1", court: "第一殿",
      notes: "saved", draft_verdict: "FAILED", draft_version: 4, draft_saved_at: "2026-09-24T00:00:00Z",
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("does not invent a cache entry when the detail was never loaded", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useSaveJudgmentDraft("judgment-2"), { wrapper });
    await act(async () => {
      result.current.mutate({ version: 0, notes: "x" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(judgmentKeys.detail("judgment-2"))).toBeUndefined();
  });

  it("surfaces a 409 to the caller without toasting", async () => {
    (judgmentApi.saveDraft as jest.Mock).mockRejectedValueOnce({ response: { status: 409, data: { code: "draft_conflict" } } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSaveJudgmentDraft("judgment-1"), { wrapper });
    await act(async () => {
      result.current.mutate({ version: 0, notes: "x" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual({ response: { status: 409, data: { code: "draft_conflict" } } });
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
