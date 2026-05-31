/**
 * Tests for useSouls hooks
 */
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSouls, useCreateSoul, useUpdateSoul, useDeleteSoul } from "@/src/hooks/useSouls";

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

describe("useSouls", () => {
  it("returns query result shape", () => {
    const { result } = renderHook(() => useSouls(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
  });

  it("useCreateSoul returns mutation", () => {
    const { result } = renderHook(() => useCreateSoul(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
    expect(result.current).toHaveProperty("isPending");
  });

  it("useUpdateSoul returns mutation", () => {
    const { result } = renderHook(() => useUpdateSoul(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });

  it("useDeleteSoul returns mutation", () => {
    const { result } = renderHook(() => useDeleteSoul(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});
