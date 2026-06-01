/**
 * Tests for useDispositions hooks
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDispositions, useExecuteDisposition } from "@/src/hooks/useDispositions";

jest.mock("@/lib/api", () => ({
  dispositionApi: {
    list: jest.fn().mockResolvedValue({ data: [] }),
    execute: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { queryClient, wrapper: ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children) };
}

describe("useDispositions", () => {
  it("returns query result shape", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDispositions(), { wrapper });
    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
  });

  it("fetches dispositions list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDispositions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useExecuteDisposition", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useExecuteDisposition(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });

  it("calls dispositionApi.execute on mutate", async () => {
    const { dispositionApi } = require("@/lib/api");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useExecuteDisposition(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dispositionApi.execute).toHaveBeenCalledWith("1", undefined);
  });
});
