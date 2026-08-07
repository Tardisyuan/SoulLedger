/**
 * Tests for useSocial hooks — reaction/comment mutation error handling.
 *
 * Covers the bug where a failed reaction mutation (e.g. the backend's 400
 * when the target post/comment belongs to another tenant, see
 * ReactionCreateSerializer.validate in backend/apps/social/serializers.py)
 * failed completely silently: no toast, no error surfaced anywhere.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useToggleReaction, useCreateComment } from "@/src/hooks/useSocial";
import { socialApi } from "@/lib/api";

const mockShowToast = jest.fn();

jest.mock("@/lib/api", () => ({
  socialApi: {
    addReaction: jest.fn().mockResolvedValue({ data: {} }),
    createComment: jest.fn().mockResolvedValue({ data: {} }),
  },
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

/** Shape DRF renders for a plain (non-field) serializers.ValidationError. */
function nonFieldValidationError(message: string) {
  return {
    isAxiosError: true,
    response: { status: 400, data: { non_field_errors: [message] } },
  };
}

function networkError() {
  return { isAxiosError: true, response: undefined, message: "Network Error" };
}

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

describe("useToggleReaction behavior", () => {
  it("invalidates reaction and post queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LIKE" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["social", "reactions"] })
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["social", "posts"] })
    );
  });

  it("surfaces the backend's actual message on a cross-tenant 400", async () => {
    (socialApi.addReaction as jest.Mock).mockRejectedValueOnce(
      nonFieldValidationError("Cannot react to a post from another tenant.")
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LIKE" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      "Cannot react to a post from another tenant.",
      "error"
    );
  });

  it("falls back to a translated generic message when the error has no usable shape", async () => {
    (socialApi.addReaction as jest.Mock).mockRejectedValueOnce(networkError());
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LIKE" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith("social.reaction_error", "error");
  });
});

describe("useCreateComment behavior", () => {
  it("surfaces the backend's actual message on a cross-tenant 400", async () => {
    (socialApi.createComment as jest.Mock).mockRejectedValueOnce(
      nonFieldValidationError("Cannot comment on a post from another tenant.")
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateComment(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", content: "hi" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      "Cannot comment on a post from another tenant.",
      "error"
    );
  });

  it("falls back to a translated generic message when the error has no usable shape", async () => {
    (socialApi.createComment as jest.Mock).mockRejectedValueOnce(networkError());
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateComment(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", content: "hi" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith("social.comment_error", "error");
  });
});
