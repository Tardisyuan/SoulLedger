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
import { useToggleReaction, useCreateComment, useUpdateProfile, useUploadAvatar } from "@soulledger/core/hooks/useSocial";
import { socialKeys } from "@soulledger/core/query_keys";
import { socialApi } from "@soulledger/core/api";

const mockShowToast = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  socialApi: {
    addReaction: jest.fn().mockResolvedValue({ data: {} }),
    createComment: jest.fn().mockResolvedValue({ data: {} }),
    updateProfile: jest.fn().mockResolvedValue({ data: {} }),
    uploadAvatar: jest.fn().mockResolvedValue({ data: {} }),
  },
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
   * Optimistic, then narrow. The bar reads `my_reaction` and the counts off the
   * cached post / comment, so the click changes the cache before the server
   * answers; afterwards only queries that HOLD that post (or comment) are
   * refetched — a list that does not contain it is left alone.
   */
  const post = (id: string, mine: string | null, like = 0) => ({
    id, my_reaction: mine, reaction_count: like,
    reaction_counts: { LIKE: like, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 },
  });

  it("shows the new reaction at once, then refetches only the queries holding that post", async () => {
    let answer!: (_v: unknown) => void;
    (socialApi.addReaction as jest.Mock).mockReturnValueOnce(new Promise((r) => { answer = r; }));
    const { queryClient, wrapper } = createWrapper();
    const feed = socialKeys.posts.feed({ page: 1 });
    const other = socialKeys.posts.list({ page: 2 });
    const detail = socialKeys.posts.detail("post-1");
    queryClient.setQueryData(feed, { results: [post("post-1", null), post("post-2", null)], count: 2 });
    queryClient.setQueryData(other, { results: [post("post-9", null)], count: 1 });
    queryClient.setQueryData(detail, post("post-1", null));

    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    act(() => {
      result.current.mutate({ post: "post-1", reaction_type: "LIKE" });
    });
    await waitFor(() =>
      expect((queryClient.getQueryData(detail) as { my_reaction: string }).my_reaction).toBe("LIKE"),
    );
    const row = (queryClient.getQueryData(feed) as { results: ReturnType<typeof post>[] }).results;
    expect(row[0]).toMatchObject({ my_reaction: "LIKE", reaction_count: 1, reaction_counts: { LIKE: 1 } });
    expect(row[1]).toMatchObject({ my_reaction: null, reaction_count: 0 });

    await act(async () => answer({ data: {} }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(feed)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detail)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it("the same kind again takes it off; another kind switches it", async () => {
    const { queryClient, wrapper } = createWrapper();
    const detail = socialKeys.posts.detail("post-1");
    queryClient.setQueryData(detail, post("post-1", "LIKE", 1));
    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LOVE" });
    });
    expect(queryClient.getQueryData(detail)).toMatchObject({
      my_reaction: "LOVE", reaction_count: 1, reaction_counts: { LIKE: 0, LOVE: 1 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LOVE" });
    });
    expect(queryClient.getQueryData(detail)).toMatchObject({
      my_reaction: null, reaction_count: 0, reaction_counts: { LIKE: 0, LOVE: 0 },
    });
  });

  it("a comment's reaction moves the comment row, not any post", async () => {
    const { queryClient, wrapper } = createWrapper();
    const thread = socialKeys.comments.list({ post: "post-1" });
    const detail = socialKeys.posts.detail("post-1");
    queryClient.setQueryData(thread, { results: [{ id: "c1", my_reaction: null, reaction_count: 2 }] });
    queryClient.setQueryData(detail, post("post-1", null));
    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ comment: "c1", reaction_type: "RESPECT" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((queryClient.getQueryData(thread) as { results: unknown[] }).results[0]).toMatchObject({
      my_reaction: "RESPECT", reaction_count: 3,
    });
    expect(queryClient.getQueryState(thread)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(detail)).toMatchObject({ my_reaction: null });
    expect(queryClient.getQueryState(detail)?.isInvalidated).toBe(false);
  });

  it("puts the cache back when the server refuses", async () => {
    (socialApi.addReaction as jest.Mock).mockRejectedValueOnce(networkError());
    const { queryClient, wrapper } = createWrapper();
    const feed = socialKeys.posts.feed({ page: 1 });
    queryClient.setQueryData(feed, { results: [post("post-1", "SYMPATHY", 0)], count: 1 });
    const { result } = renderHook(() => useToggleReaction(), { wrapper });
    await act(async () => {
      result.current.mutate({ post: "post-1", reaction_type: "LIKE" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((queryClient.getQueryData(feed) as { results: unknown[] }).results[0]).toEqual(post("post-1", "SYMPATHY", 0));
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
    // `{ text }`, not a bare string: the port takes a message key now, and what
    // DRF wrote in `non_field_errors` is not one. See `NotifyMessage`.
    expect(mockShowToast).toHaveBeenCalledWith(
      { text: "Cannot react to a post from another tenant." },
      "error"
    );
  });

  it("falls back to the generic message key when the error has no usable shape", async () => {
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
      { text: "Cannot comment on a post from another tenant." },
      "error"
    );
  });

  it("falls back to the generic message key when the error has no usable shape", async () => {
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
      { text: "Cannot edit another user's profile." },
      "error"
    );
  });

  it("falls back to the generic message key when the error has no usable shape", async () => {
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

describe("useUploadAvatar behavior", () => {
  it("posts the body, invalidates profile queries and shows a success toast", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useUploadAvatar(), { wrapper });
    const body = new FormData();
    await act(async () => {
      result.current.mutate(body);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.uploadAvatar).toHaveBeenCalledWith(body);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["social", "profiles"] })
    );
    expect(mockShowToast).toHaveBeenCalledWith("social.avatar_uploaded", "success");
  });

  it("shows the server's reason for a rejected file — a FIELD error, not a non-field one", async () => {
    // The backend answers `{"avatar": ["Avatar must be at most 5 MB."]}`.
    // `serverSaidOr` reads only non_field_errors/detail, so without reading the
    // field the user would get a generic "upload failed" for a file that was
    // simply too big.
    (socialApi.uploadAvatar as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { avatar: ["Avatar must be at most 5 MB."] } },
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUploadAvatar(), { wrapper });
    await act(async () => {
      result.current.mutate(new FormData());
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith({ text: "Avatar must be at most 5 MB." }, "error");
  });

  it("falls back to the generic key when the error has no usable shape", async () => {
    (socialApi.uploadAvatar as jest.Mock).mockRejectedValueOnce(networkError());
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUploadAvatar(), { wrapper });
    await act(async () => {
      result.current.mutate(new FormData());
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith("social.avatar_upload_error", "error");
  });
});
