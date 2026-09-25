/**
 * Tests for useSouls hooks
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useSouls,
  useCreateSoul,
  useUpdateSoul,
  useDeleteSoul,
  useBatchRecycleSouls,
} from "@soulledger/core/hooks/useSouls";
import { soulsApi } from "@soulledger/core/api";
import { AxiosError, AxiosHeaders } from "axios";

const mockShowToast = jest.fn();

// `mockInvalidateQueries` 与 `mockShowToast` 曾经在这里各占一行,而**两个都
// 没有被任何 `jest.mock` 工厂引用**,也没有任何断言读它们 —— 下面的
// `jest.mock("@/src/components/ui/Toast")` 用的是一个就地新建的 `jest.fn()`。
// 它们制造出「这条测试在观察 toast 与缓存失效」的观感,而实际什么都没观察。
//
// 藏了很久:`src/__tests__/**` 整个在 eslint 的 `ignores` 里,主块又把
// `no-unused-vars` 关成了 off。

jest.mock("@soulledger/core/api", () => ({
  soulsApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
    create: jest.fn().mockResolvedValue({ data: {} }),
    update: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({}),
    batchRecycle: jest.fn().mockResolvedValue({ data: { recycled: 2, results: [] } }),
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
  // `jest.spyOn` 装的是间谍本身;句柄没人用,所以不留变量。
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

describe("useSouls", () => {
  it("returns query result shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSouls(), { wrapper });
    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
  });
});

describe("useCreateSoul", () => {
  it("returns mutation shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSoul(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
    expect(result.current).toHaveProperty("isPending");
  });
});

describe("useUpdateSoul", () => {
  it("returns mutation shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSoul(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useDeleteSoul", () => {
  it("returns mutation shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSoul(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

// ── Behavior tests ────────────────────────────────────────────────────

describe("useSouls behavior", () => {
  it("fetches souls list via soulsApi.list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSouls(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.list).toHaveBeenCalled();
  });

  it("passes params through to soulsApi.list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSouls({ status: "ACTIVE" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.list).toHaveBeenCalledWith({ status: "ACTIVE" });
  });
});

describe("useCreateSoul behavior", () => {
  it("calls soulsApi.create with provided data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "TestSoul", culture: "CHINA" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.create).toHaveBeenCalledWith({ name: "TestSoul", culture: "CHINA" });
  });

  it("invalidates soul queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Soul" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["souls"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Soul" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "success"
    );
  });

  it("shows error toast on failure", async () => {
    (soulsApi.create as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Soul" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });
});

describe("useUpdateSoul behavior", () => {
  it("calls soulsApi.update with id and data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "soul-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.update).toHaveBeenCalledWith("soul-1", { name: "Updated" });
  });

  it("invalidates soul queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "soul-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["souls"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "soul-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "success"
    );
  });

  it("shows error toast on failure", async () => {
    (soulsApi.update as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateSoul(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "soul-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });
});

describe("useDeleteSoul behavior", () => {
  it("calls soulsApi.delete with the soul id", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSoul(), { wrapper });
    await act(async () => {
      result.current.mutate("soul-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.delete).toHaveBeenCalledWith("soul-1");
  });

  it("invalidates soul queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSoul(), { wrapper });
    await act(async () => {
      result.current.mutate("soul-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["souls"] })
    );
  });

  it("shows error toast on failure", async () => {
    (soulsApi.delete as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSoul(), { wrapper });
    await act(async () => {
      result.current.mutate("soul-1");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.any(String),
      "error"
    );
  });
});

describe("useBatchRecycleSouls behavior", () => {
  const body = { ids: ["soul-1", "soul-2"], reason: "重复录入" };

  it("posts the ids and reason to soulsApi.batchRecycle", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBatchRecycleSouls(), { wrapper });
    await act(async () => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(soulsApi.batchRecycle).toHaveBeenCalledWith(body);
  });

  // Seeded queries rather than asserting the call's arguments: the recycle
  // bin page keys its list by a literal (`["recycle-bin"]` in
  // app/recycle-bin/page.tsx), so what matters is that the query stored under
  // that literal goes stale — not that some key was passed.
  it("invalidates the soul list and the recycle bin, and nothing else", async () => {
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["souls", "list", undefined], { results: [], count: 0 });
    queryClient.setQueryData(["recycle-bin"], { results: [], count: 0 });
    queryClient.setQueryData(["judgments", "list", undefined], { results: [], count: 0 });
    const { result } = renderHook(() => useBatchRecycleSouls(), { wrapper });
    await act(async () => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(["souls", "list", undefined])).toBe(true);
    expect(stale(["recycle-bin"])).toBe(true);
    expect(stale(["judgments", "list", undefined])).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith("souls.detail.delete_to_recycle_bin", "success");
  });

  it("on a refusal invalidates nothing — nothing was recycled", async () => {
    (soulsApi.batchRecycle as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useBatchRecycleSouls(), { wrapper });
    await act(async () => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith("souls.detail.error_delete", "error");
    expect(mockShowToast).not.toHaveBeenCalledWith("souls.detail.delete_to_recycle_bin", "success");
  });

  // The caller (SoulBatchBar) lists the refused souls in its dialog; a generic
  // 「删除失败」 toast on top of that is the defect this pins.
  it.each([
    [404, "not_found"],
    [409, "not_deletable"],
  ])("a %s %s refusal the dialog shows raises no generic toast", async (status, code) => {
    const refusal = new AxiosError("refused", String(status), undefined, undefined, {
      status,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { detail: "x", code, ids: ["soul-2"] },
    });
    (soulsApi.batchRecycle as jest.Mock).mockRejectedValueOnce(refusal);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBatchRecycleSouls(), { wrapper });
    await act(async () => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("an axios error without the refusal shape (a 500) still toasts: nothing else would say it failed", async () => {
    const crash = new AxiosError("boom", "500", undefined, undefined, {
      status: 500,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { detail: "Server Error" },
    });
    (soulsApi.batchRecycle as jest.Mock).mockRejectedValueOnce(crash);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useBatchRecycleSouls(), { wrapper });
    await act(async () => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith("souls.detail.error_delete", "error");
  });
});

describe("the shared 「删除失败」 key still reaches single deletes", () => {
  it("useDeleteSoul toasts souls.detail.error_delete even for a 409 refusal body", async () => {
    const refusal = new AxiosError("refused", "409", undefined, undefined, {
      status: 409,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { detail: "x", code: "not_deletable", ids: ["soul-1"] },
    });
    (soulsApi.delete as jest.Mock).mockRejectedValueOnce(refusal);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteSoul(), { wrapper });
    await act(async () => {
      result.current.mutate("soul-1");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith("souls.detail.error_delete", "error");
  });
});
