/**
 * Tests for src/hooks/useUsers.ts
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useUsers, useCreateUser, useDeleteUser } from "@/src/hooks/useUsers";
import { usersApi } from "@/lib/api";
import { userKeys } from "@/lib/query_keys";

const mockShowToast = jest.fn();

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

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
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

// ── Query key tests ───────────────────────────────────────────────────

describe("userKeys", () => {
  it("should generate correct query keys", () => {
    expect(userKeys.all).toEqual(["users"]);
    expect(userKeys.list({ page: 1 })).toEqual(["users", "list", { page: 1 }]);
    expect(userKeys.detail("5")).toEqual(["users", "detail", "5"]);
  });
});

// ── Shape tests (sanity) ──────────────────────────────────────────────

describe("useUsers", () => {
  it("should fetch users list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUsers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });
});

describe("useCreateUser", () => {
  it("should create a user", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateUser(), { wrapper });
    expect(result.current.mutate).toBeDefined();
  });
});

describe("useDeleteUser", () => {
  it("should delete a user", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteUser(), { wrapper });
    expect(result.current.mutate).toBeDefined();
  });
});

// ── Behavior tests ────────────────────────────────────────────────────

describe("useUsers behavior", () => {
  it("fetches users list via usersApi.list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUsers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usersApi.list).toHaveBeenCalled();
  });

  it("passes params through to usersApi.list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUsers({ page: 2 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usersApi.list).toHaveBeenCalledWith({ page: 2 });
  });
});

describe("useCreateUser behavior", () => {
  it("calls usersApi.create with provided data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ username: "newuser", email: "test@example.com" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usersApi.create).toHaveBeenCalledWith({ username: "newuser", email: "test@example.com" });
  });

  it("invalidates user queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ username: "newuser" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["users"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ username: "newuser" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (usersApi.create as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateUser(), { wrapper });
    await act(async () => {
      result.current.mutate({ username: "newuser" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

describe("useDeleteUser behavior", () => {
  it("calls usersApi.delete with the user id", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteUser(), { wrapper });
    await act(async () => {
      result.current.mutate("user-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usersApi.delete).toHaveBeenCalledWith("user-1");
  });

  it("invalidates user queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteUser(), { wrapper });
    await act(async () => {
      result.current.mutate("user-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["users"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteUser(), { wrapper });
    await act(async () => {
      result.current.mutate("user-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (usersApi.delete as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteUser(), { wrapper });
    await act(async () => {
      result.current.mutate("user-1");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});
