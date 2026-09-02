/**
 * Tests for useJudgments hooks
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useJudgments, useCreateJudgment, useConcludeJudgment } from "@/src/hooks/useJudgments";
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
  },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    hydrated: true,
  }),
}));

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
