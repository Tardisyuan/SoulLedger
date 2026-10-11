/**
 * 作者编辑自己的帖子:入口只给作者;内容 / 可见性没变「保存」不可点;空白不能存;
 * 只发改动了的字段;有未保存改动时关闭先确认。
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PostCard } from "@/src/components/social/PostCard";
import type { Post } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, formatDate: (v: string) => v, locale: "en", hydrated: true }),
}));

let mockUser: { id: string | number } | null = { id: "user-1" };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

const mockUpdate = jest.fn();
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useDeletePost: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdatePost: () => ({ mutate: mockUpdate, isPending: false }),
  useRefreshPosts: () => jest.fn(),
  useToggleReaction: () => ({ mutate: jest.fn(), isPending: false }),
  useReactions: () => ({ data: { results: [] } }),
}));

const post: Post = {
  id: "post-1",
  author: "user-1",
  author_name: "Author One",
  author_username: "author1",
  content: "Hello world",
  visibility: "PUBLIC",
  comment_count: 0,
  reaction_count: 0,
  media: [],
  reaction_counts: { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 },
  create_time: "2026-08-01T00:00:00Z",
};

const open = () => {
  render(<PostCard post={post} />);
  fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
  return screen.getByRole("dialog");
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "user-1" };
});

describe("PostCard 编辑入口", () => {
  it("作者看得到", () => {
    render(<PostCard post={post} />);
    expect(screen.getByRole("button", { name: "common.edit" })).toBeInTheDocument();
  });

  it("非作者没有", () => {
    mockUser = { id: "someone-else" };
    render(<PostCard post={post} />);
    expect(screen.queryByRole("button", { name: "common.edit" })).toBeNull();
  });

  it("未登录没有", () => {
    mockUser = null;
    render(<PostCard post={post} />);
    expect(screen.queryByRole("button", { name: "common.edit" })).toBeNull();
  });
});

describe("PostCard「已编辑」", () => {
  it("有 edited_at:显示,悬停给出编辑时间", () => {
    render(<PostCard post={{ ...post, edited_at: "2026-08-02T00:00:00Z" }} />);
    const mark = document.querySelector("[data-edited]")!;
    expect(mark).toHaveTextContent("social.edited");
    expect(mark).toHaveAttribute("title", "social.edited_at");
  });

  it("没有 edited_at(null 或缺省):不显示", () => {
    const { unmount } = render(<PostCard post={{ ...post, edited_at: null }} />);
    expect(document.querySelector("[data-edited]")).toBeNull();
    unmount();
    render(<PostCard post={post} />);
    expect(document.querySelector("[data-edited]")).toBeNull();
  });
});

describe("PostCard 作者视角的审核状态", () => {
  it.each([
    ["PENDING", "待审"],
    ["HIDDEN", "已隐藏"],
  ])("%s:卡片上有状态标记", (status) => {
    render(<PostCard post={{ ...post, moderation_status: status as "PENDING" | "HIDDEN" }} />);
    // 原始枚举值留在 title 上(显示契约);测试里 t() 回显键,所以认 title。
    expect(document.querySelector(`[title="${status}"]`)).not.toBeNull();
  });

  it("PUBLISHED 或缺省:没有标记", () => {
    const { unmount } = render(<PostCard post={{ ...post, moderation_status: "PUBLISHED" }} />);
    expect(document.querySelector('[title="PUBLISHED"]')).toBeNull();
    unmount();
    render(<PostCard post={post} />);
    expect(document.querySelector('[title="PENDING"], [title="HIDDEN"]')).toBeNull();
  });
});

describe("PostEditModal", () => {
  it("预填原文;没改动时保存不可点", () => {
    const dialog = open();
    expect(within(dialog).getByRole("textbox")).toHaveValue("Hello world");
    expect(within(dialog).getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("只改空白、或清空:保存仍不可点", () => {
    const dialog = open();
    const box = within(dialog).getByRole("textbox");
    fireEvent.change(box, { target: { value: "  Hello world  " } });
    expect(within(dialog).getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("改了文字:只发 content,不带 visibility", () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Bye" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    expect(mockUpdate).toHaveBeenCalledWith({ id: "post-1", data: { content: "Bye" } }, expect.anything());
  });

  it("只改可见范围:只发 visibility", () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "PRIVATE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    expect(mockUpdate).toHaveBeenCalledWith({ id: "post-1", data: { visibility: "PRIVATE" } }, expect.anything());
  });

  it("有未保存改动时取消先确认;没改动直接关", () => {
    let dialog = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("social.edit_discard_message");
    fireEvent.click(screen.getByRole("button", { name: "social.edit_discard_confirm" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
