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
import { useToggleReaction, useCreateComment, useUpdateProfile } from "@/src/hooks/useSocial";
import { socialKeys } from "@/lib/query_keys";
import { socialApi } from "@soulledger/core/api";

const mockShowToast = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  socialApi: {
    addReaction: jest.fn().mockResolvedValue({ data: {} }),
    createComment: jest.fn().mockResolvedValue({ data: {} }),
    updateProfile: jest.fn().mockResolvedValue({ data: {} }),
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
  /**
   * Behavioural, and it asserts an ABSENCE that the previous version could not.
   *
   * This used to spy on `invalidateQueries` and check it was called with
   * `["social","reactions"]`. That is the whole reaction family — every
   * PostCard mounts its own ReactionBar with its own `useReactions({ post })`
   * query, so one click refetched the reaction list of every post on screen,
   * and a spy on the call could not tell that from the narrow, correct thing.
   *
   * Seeding two posts and asking the cache afterwards can. `posts.all` is
   * still expected broad: `Post.reaction_count` is rendered in the card
   * (PostCard.tsx:91), so the feed rows really do go stale on a reaction —
   * checked before narrowing anything.
   */
  it("invalidates the reacted post's reactions, and leaves other posts' alone", async () => {
    const { queryClient, wrapper } = createWrapper();
    const mine = [...socialKeys.reactions.all, { post: "post-1" }];
    const theirs = [...socialKeys.reactions.all, { post: "post-2" }];
    const feed = socialKeys.posts.feed({ page: 1 });
    queryClient.setQueryData(mine, { results: [] });
    queryClient.setQueryData(theirs, { results: [] });
    queryClient.setQueryData(feed, { results: [], count: 0 });

    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LIKE" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(mine)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(theirs)?.isInvalidated).toBe(false);
    // The feed carries reaction_count, so it does have to refresh.
    expect(queryClient.getQueryState(feed)?.isInvalidated).toBe(true);
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

describe("useUpdateProfile behavior", () => {
  it("invalidates profile queries and shows a success toast on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "profile-1", data: { bio: "hi" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["social", "profiles"] })
    );
    expect(mockShowToast).toHaveBeenCalledWith("social.profile_updated", "success");
  });

  it("surfaces the backend's actual message on a validation 400", async () => {
    (socialApi.updateProfile as jest.Mock).mockRejectedValueOnce(
      nonFieldValidationError("Cannot edit another user's profile.")
    );
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "profile-1", data: { bio: "hi" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(
      "Cannot edit another user's profile.",
      "error"
    );
  });

  it("falls back to a translated generic message when the error has no usable shape", async () => {
    (socialApi.updateProfile as jest.Mock).mockRejectedValueOnce(networkError());
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "profile-1", data: { bio: "hi" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith("social.profile_update_error", "error");
  });
});
