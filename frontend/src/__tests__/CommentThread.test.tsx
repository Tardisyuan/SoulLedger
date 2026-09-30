/**
 * Tests for CommentThread's delete UI — the wiring for useDeleteComment
 * (frontend/src/hooks/useSocial.ts), which already called a real working
 * DELETE endpoint but had no caller anywhere in the UI.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CommentThread } from "@/src/components/social/CommentThread";
import type { Comment } from "@soulledger/core/api";

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
const mockCreateMutate = jest.fn();

const comments: Comment[] = [
  {
    id: "comment-1",
    post: "post-1",
    author: "user-1",
    author_name: "Author One",
    author_username: "author1",
    parent: null,
    content: "My own comment",
    create_time: "2026-08-01T00:00:00Z",
  },
  {
    id: "comment-2",
    post: "post-1",
    author: "someone-else",
    author_name: "Other Author",
    author_username: "other",
    parent: null,
    content: "Someone else's comment",
    create_time: "2026-08-01T00:05:00Z",
  },
];

jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useComments: () => ({ data: { results: comments }, isLoading: false }),
  useCreateComment: () => ({ mutate: mockCreateMutate, isPending: false }),
  useDeleteComment: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useToggleReaction: () => ({ mutate: jest.fn(), isPending: false }),
  useReactions: () => ({ data: { results: [] } }),
}));

describe("CommentThread delete UI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "user-1" };
  });

  it("shows a delete action only on the current user's own comment", () => {
    render(<CommentThread postId="post-1" />);
    // Only one comment (comment-1) belongs to user-1.
    expect(screen.getAllByText("common.delete")).toHaveLength(1);
  });

  it("hides all delete actions when there is no logged-in user", () => {
    mockUser = null;
    render(<CommentThread postId="post-1" />);
    expect(screen.queryByText("common.delete")).not.toBeInTheDocument();
  });

  it("opens a confirmation dialog before deleting", () => {
    render(<CommentThread postId="post-1" />);
    fireEvent.click(screen.getByText("common.delete"));
    expect(mockDeleteMutate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("social.delete_comment_confirm");
  });

  it("calls useDeleteComment's mutate with the comment id after confirming", async () => {
    render(<CommentThread postId="post-1" />);
    fireEvent.click(screen.getByText("common.delete"));

    // 作者自删不可撤回,但评论没有名称 → 普通确认框(2026-09-30 用户拍板):不打字,
    // 按钮带 ✕ 和「确认删除」,是次按钮不是实底危险按钮(dangerButtonPlacement.test.ts)。
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByTestId("name-confirm-action")).toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "common.confirm_delete" });
    expect(confirm).toHaveTextContent("✕common.confirm_delete");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mockDeleteMutate).toHaveBeenCalledWith(
      "comment-1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    ));
  });
});
