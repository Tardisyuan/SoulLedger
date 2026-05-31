/**
 * Tests for useJudgments hooks
 */
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useJudgments, useCreateJudgment, useConcludeJudgment } from "@/src/hooks/useJudgments";

jest.mock("@/lib/api", () => ({
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
  useToast: () => ({ showToast: jest.fn() }),
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
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useJudgments", () => {
  it("returns query result shape", () => {
    const { result } = renderHook(() => useJudgments(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
  });

  it("useCreateJudgment returns mutation", () => {
    const { result } = renderHook(() => useCreateJudgment(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });

  it("useConcludeJudgment returns mutation", () => {
    const { result } = renderHook(() => useConcludeJudgment(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});
