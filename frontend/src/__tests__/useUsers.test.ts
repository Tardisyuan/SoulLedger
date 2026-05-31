/**
 * Tests for src/hooks/useUsers.ts
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useUsers, useCreateUser, useDeleteUser } from "@/src/hooks/useUsers";
import { userKeys } from "@/lib/query_keys";

// Mock the API
jest.mock("@/lib/api", () => ({
  usersApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
    create: jest.fn().mockResolvedValue({ data: { id: 1, username: "test" } }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    update: jest.fn().mockResolvedValue({ data: { id: 1 } }),
    activate: jest.fn().mockResolvedValue({ data: {} }),
    deactivate: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

// Mock showToast
jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

// Mock useI18n
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
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

describe("userKeys", () => {
  it("should generate correct query keys", () => {
    expect(userKeys.all).toEqual(["users"]);
    expect(userKeys.list({ page: 1 })).toEqual(["users", "list", { page: 1 }]);
    expect(userKeys.detail("5")).toEqual(["users", "detail", "5"]);
  });
});

describe("useUsers", () => {
  it("should fetch users list", async () => {
    const { result } = renderHook(() => useUsers(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });
});

describe("useCreateUser", () => {
  it("should create a user", async () => {
    const { result } = renderHook(() => useCreateUser(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
  });
});

describe("useDeleteUser", () => {
  it("should delete a user", async () => {
    const { result } = renderHook(() => useDeleteUser(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
  });
});
