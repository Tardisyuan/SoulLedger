/**
 * Tests for useSouls hooks
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSouls, useCreateSoul, useUpdateSoul, useDeleteSoul } from "@/src/hooks/useSouls";
import { soulsApi } from "@/lib/api";

const mockShowToast = jest.fn();
const mockInvalidateQueries = jest.fn();

jest.mock("@/lib/api", () => ({
  soulsApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
    create: jest.fn().mockResolvedValue({ data: {} }),
    update: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({}),
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
  const spy = jest.spyOn(queryClient, "invalidateQueries");
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
