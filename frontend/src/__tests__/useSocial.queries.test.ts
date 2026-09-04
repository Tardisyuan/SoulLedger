/**
 * Tests for the src/hooks/useSocial.ts hooks that useSocial.test.ts does not
 * reach — the read hooks (posts / feed / comments / reactions / follows /
 * profiles) and the post & follow mutations.
 *
 * The read hooks all carry an `enabled` gate keyed off an id; a broken gate
 * fires a request for `undefined` and 404s on every mount. The mutations all
 * carry an invalidation list; a missing key leaves a stale feed on screen.
 * Both are asserted directly, including the negative cases.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  usePosts,
  usePost,
  useFeed,
  useCreatePost,
  useDeletePost,
  useComments,
  useDeleteComment,
  useReactions,
  useToggleFollow,
  useFollowing,
  useFollowers,
  useProfile,
  useMyProfile,
} from "@/src/hooks/useSocial";
import { socialApi } from "@soulledger/core/api";

const mockShowToast = jest.fn();

jest.mock("@soulledger/core/api", () => ({
  socialApi: {
    listPosts: jest.fn().mockResolvedValue({ data: { results: [] } }),
    getPost: jest.fn().mockResolvedValue({ data: { id: "p1" } }),
    feed: jest.fn().mockResolvedValue({ data: { results: [] } }),
    createPost: jest.fn().mockResolvedValue({ data: {} }),
    deletePost: jest.fn().mockResolvedValue({ data: {} }),
    listComments: jest.fn().mockResolvedValue({ data: { results: [] } }),
    deleteComment: jest.fn().mockResolvedValue({ data: {} }),
    listReactions: jest.fn().mockResolvedValue({ data: { results: [] } }),
    toggleFollow: jest.fn().mockResolvedValue({ data: {} }),
    following: jest.fn().mockResolvedValue({ data: { results: [] } }),
    followers: jest.fn().mockResolvedValue({ data: { results: [] } }),
    getProfile: jest.fn().mockResolvedValue({ data: { id: "u1" } }),
    myProfile: jest.fn().mockResolvedValue({ data: { id: "me" } }),
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

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  return {
    invalidate,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

const keys = (invalidate: jest.SpyInstance): string[] =>
  invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Post reads ───────────────────────────────────────────────────────

describe("usePosts", () => {
  it("forwards filter params to the list endpoint", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePosts({ author: "u1", page: 2 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.listPosts).toHaveBeenCalledWith({ author: "u1", page: 2 });
  });

  it("caches per params — a different filter triggers a second request", async () => {
    const { wrapper } = createWrapper();

    const { result, rerender } = renderHook(({ p }: { p: Record<string, string> }) => usePosts(p), {
      wrapper,
      initialProps: { p: { author: "u1" } },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ p: { author: "u2" } });
    await waitFor(() => expect(socialApi.listPosts).toHaveBeenCalledTimes(2));
    expect(socialApi.listPosts).toHaveBeenLastCalledWith({ author: "u2" });
  });

  it("surfaces a failure as an error state", async () => {
    (socialApi.listPosts as jest.Mock).mockRejectedValueOnce(new Error("500"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePosts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("usePost", () => {
  it("fetches a single post by id", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePost("p1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.getPost).toHaveBeenCalledWith("p1");
  });

  it("stays idle rather than requesting an empty id", () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePost(""), { wrapper });

    expect(socialApi.getPost).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useFeed", () => {
  it("reads the feed endpoint, not the plain post list", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useFeed({ page: 1 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.feed).toHaveBeenCalledWith({ page: 1 });
    expect(socialApi.listPosts).not.toHaveBeenCalled();
  });
});

// ── Post mutations ───────────────────────────────────────────────────

describe("useCreatePost", () => {
  it("invalidates the post list and confirms with a success toast", async () => {
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useCreatePost(), { wrapper });

    await act(async () => {
      result.current.mutate({ content: "hello", visibility: "PUBLIC" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(socialApi.createPost).toHaveBeenCalledWith({ content: "hello", visibility: "PUBLIC" });
    expect(keys(invalidate)).toEqual(['["social","posts"]']);
    expect(mockShowToast).toHaveBeenCalledWith("social.post_created", "success");
  });

  it("shows an error toast and skips invalidation when the post is rejected", async () => {
    (socialApi.createPost as jest.Mock).mockRejectedValueOnce(new Error("400"));
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useCreatePost(), { wrapper });

    await act(async () => {
      result.current.mutate({ content: "" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockShowToast).toHaveBeenCalledWith("social.post_error", "error");
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useDeletePost", () => {
  it("invalidates the post list without a success toast", async () => {
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useDeletePost(), { wrapper });

    await act(async () => {
      result.current.mutate("p9");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(socialApi.deletePost).toHaveBeenCalledWith("p9");
    expect(keys(invalidate)).toEqual(['["social","posts"]']);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("toasts when the delete is refused", async () => {
    (socialApi.deletePost as jest.Mock).mockRejectedValueOnce(new Error("403"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeletePost(), { wrapper });

    await act(async () => {
      result.current.mutate("p9");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockShowToast).toHaveBeenCalledWith("Failed to delete post", "error");
  });
});

// ── Comments ─────────────────────────────────────────────────────────

describe("useComments", () => {
  it("scopes the request to the post", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useComments("p1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.listComments).toHaveBeenCalledWith({ post: "p1" });
  });

  it("does not request comments for an empty post id", () => {
    const { wrapper } = createWrapper();

    renderHook(() => useComments(""), { wrapper });

    expect(socialApi.listComments).not.toHaveBeenCalled();
  });
});

describe("useDeleteComment", () => {
  it("invalidates the comment cache on success", async () => {
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useDeleteComment(), { wrapper });

    await act(async () => {
      result.current.mutate("c1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(keys(invalidate)).toEqual(['["social","comments"]']);
  });

  it("toasts when the delete is refused", async () => {
    (socialApi.deleteComment as jest.Mock).mockRejectedValueOnce(new Error("403"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteComment(), { wrapper });

    await act(async () => {
      result.current.mutate("c1");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockShowToast).toHaveBeenCalledWith("Failed to delete comment", "error");
  });
});

// ── Reactions ────────────────────────────────────────────────────────

describe("useReactions", () => {
  it("passes the filter params through", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useReactions({ post: "p1" }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.listReactions).toHaveBeenCalledWith({ post: "p1" });
  });

  it("fetches unfiltered when no params are given", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useReactions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.listReactions).toHaveBeenCalledWith(undefined);
  });
});

// ── Follows ──────────────────────────────────────────────────────────

describe("useToggleFollow", () => {
  it("invalidates both the follow graph and the profiles that display it", async () => {
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useToggleFollow(), { wrapper });

    await act(async () => {
      result.current.mutate("u2");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(socialApi.toggleFollow).toHaveBeenCalledWith("u2");
    expect(keys(invalidate)).toEqual(['["social","follows"]', '["social","profiles"]']);
  });

  it("leaves the caches untouched when the follow is rejected", async () => {
    (socialApi.toggleFollow as jest.Mock).mockRejectedValueOnce(new Error("400"));
    const { wrapper, invalidate } = createWrapper();
    const { result } = renderHook(() => useToggleFollow(), { wrapper });

    await act(async () => {
      result.current.mutate("u2");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useFollowing / useFollowers", () => {
  it("reads the following list from its own endpoint", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useFollowing(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.following).toHaveBeenCalled();
    expect(socialApi.followers).not.toHaveBeenCalled();
  });

  it("reads the followers list from its own endpoint", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useFollowers(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.followers).toHaveBeenCalled();
    expect(socialApi.following).not.toHaveBeenCalled();
  });
});

// ── Profiles ─────────────────────────────────────────────────────────

describe("useProfile / useMyProfile", () => {
  it("fetches a profile by user id", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useProfile("u1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.getProfile).toHaveBeenCalledWith("u1");
  });

  it("does not fetch a profile for an empty user id", () => {
    const { wrapper } = createWrapper();

    renderHook(() => useProfile(""), { wrapper });

    expect(socialApi.getProfile).not.toHaveBeenCalled();
  });

  it("reads the caller's own profile from the me endpoint", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useMyProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(socialApi.myProfile).toHaveBeenCalled();
    expect(result.current.data).toEqual({ id: "me" });
  });

  it("surfaces a failed profile read as an error", async () => {
    (socialApi.myProfile as jest.Mock).mockRejectedValueOnce(new Error("401"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useMyProfile(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
