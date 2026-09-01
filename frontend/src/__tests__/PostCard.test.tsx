/**
 * Tests for PostCard's delete UI — the wiring for useDeletePost
 * (frontend/src/hooks/useSocial.ts), which already called a real working
 * DELETE endpoint but had no caller anywhere in the UI.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PostCard } from "@/src/components/social/PostCard";
import type { Post } from "@/lib/api";

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
jest.mock("@/src/hooks/useSocial", () => ({
  useDeletePost: () => ({ mutate: mockDeleteMutate, isPending: false }),
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

    // `alertdialog`, not `dialog`. ConfirmDialog moved from @headlessui's
    // generic Dialog to Base UI's AlertDialog, which is the accurate role for
    // a question the operator has to answer — and which, unlike a plain
    // dialog, does not let a stray click on the backdrop quietly answer
    // "cancel" for them.
    const dialog = screen.getByRole("alertdialog");
    const confirmButtons = within(dialog).getAllByText("common.delete");
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

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
