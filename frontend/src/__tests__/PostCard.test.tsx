/**
 * Tests for PostCard's delete UI — the wiring for useDeletePost
 * (frontend/src/hooks/useSocial.ts), which already called a real working
 * DELETE endpoint but had no caller anywhere in the UI.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PostCard } from "@/src/components/social/PostCard";
import type { Post } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatDate: (v: string) => v,
    locale: "en",
    hydrated: true,
  }),
}));

let mockUser: { id: string | number } | null = { id: "user-1" };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

const mockDeleteMutate = jest.fn();
const mockRefresh = jest.fn();
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useDeletePost: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useRefreshPosts: () => mockRefresh,
  useToggleReaction: () => ({ mutate: jest.fn(), isPending: false }),
  useReactions: () => ({ data: { results: [] } }),
}));

const basePost: Post = {
  id: "post-1",
  author: "user-1",
  author_name: "Author One",
  author_username: "author1",
  content: "Hello world",
  visibility: "PUBLIC",
  comment_count: 0,
  reaction_count: 0,
  media: [],
  create_time: "2026-08-01T00:00:00Z",
};

describe("PostCard delete UI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "user-1" };
  });

  it("shows a delete action when the current user is the post's author", () => {
    render(<PostCard post={basePost} />);
    expect(screen.getAllByText("common.delete").length).toBeGreaterThan(0);
  });

  it("hides the delete action when the current user is not the author", () => {
    mockUser = { id: "someone-else" };
    render(<PostCard post={basePost} />);
    expect(screen.queryByText("common.delete")).not.toBeInTheDocument();
  });

  it("hides the delete action when there is no logged-in user", () => {
    mockUser = null;
    render(<PostCard post={basePost} />);
    expect(screen.queryByText("common.delete")).not.toBeInTheDocument();
  });

  it("does not delete immediately — opens a confirmation dialog first", () => {
    render(<PostCard post={basePost} />);
    fireEvent.click(screen.getByText("common.delete"));
    expect(mockDeleteMutate).not.toHaveBeenCalled();
    // The confirm dialog is portal-rendered onto document.body, not inside
    // the component's own container.
    expect(document.body.textContent).toContain("social.delete_post_confirm");
  });

  it("calls useDeletePost's mutate with the post id after confirming", async () => {
    render(<PostCard post={basePost} />);
    fireEvent.click(screen.getByText("common.delete"));

    // 作者自删不可撤回,但帖子没有名称 → 普通确认框(2026-09-30 用户拍板):不打字,
    // 按钮带 ✕ 和「确认删除」,是次按钮不是实底危险按钮(dangerButtonPlacement.test.ts)。
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByTestId("name-confirm-action")).toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "common.confirm_delete" });
    expect(confirm).toHaveTextContent("✕common.confirm_delete");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mockDeleteMutate).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    ));
  });

  it("cancelling the dialog does not call mutate", () => {
    render(<PostCard post={basePost} />);
    fireEvent.click(screen.getByText("common.delete"));
    fireEvent.click(screen.getByText("common.cancel"));
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});

describe("PostCard 配图(官员也能发图,2026-10-02)", () => {
  const media = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `m${i}`, url: `/api/v1/social-media/m${i}/?t=s${i}`, width: 64, height: 48 }));

  it("没有图:不画方格", () => {
    render(<PostCard post={basePost} />);
    expect(document.querySelector("[data-media-grid]")).toBeNull();
  });

  it("有图:按顺序画进方格", () => {
    render(<PostCard post={{ ...basePost, media: media(4) }} />);
    const grid = document.querySelector("[data-media-grid]")!;
    expect(grid.getAttribute("data-count")).toBe("4");
    expect(Array.from(grid.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(
      media(4).map((m) => expect.stringContaining(m.url)),
    );
  });

  it("签名过期:虚线格「重新获取」重拉帖子列表,不留破图", () => {
    render(<PostCard post={{ ...basePost, media: media(1) }} />);
    fireEvent.error(document.querySelector("[data-media-grid] img")!);
    expect(document.querySelector("[data-media-grid] img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "social.media.refetch social.media.refetch_short" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
