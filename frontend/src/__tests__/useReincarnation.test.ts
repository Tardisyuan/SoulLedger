/**
 * Tests for useReincarnation hook
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useReborn } from "@soulledger/core/hooks/useReincarnation";

jest.mock("@soulledger/core/api", () => ({
  reincarnationApi: {
    reborn: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// NO `jest.mock("@/src/contexts/I18nContext")`. The hook under test stopped
// importing it when `notify` began taking a message key — the strings below are
// keys because that is what the hook now passes, not because a stub echoed them.

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { queryClient, wrapper: ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children) };
}

describe("useReborn", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReborn(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
    expect(result.current).toHaveProperty("isPending");
  });

  it("calls reincarnationApi.reborn on mutate", async () => {
    const { reincarnationApi } = require("@soulledger/core/api");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useReborn(), { wrapper });
    await act(async () => {
      result.current.mutate({ soul_id: "1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reincarnationApi.reborn).toHaveBeenCalledWith({ soul_id: "1" });
  });
});
