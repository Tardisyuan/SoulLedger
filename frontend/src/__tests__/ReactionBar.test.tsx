/**
 * 表态条(A5 · v3 Post.dc):五种对齐现有表态,长明灯在末位、竖分隔之后单独一格;
 * 长明灯 Noto Serif SC 600、1px ink 描边,点亮后 ink 实底反白并换字;其余四种无框。
 * 选中靠 aria-pressed + 字重,不只靠颜色。没有分类计数,右端只写总数。
 */
import { render, screen } from "@testing-library/react";

const mockReactions: { user: string; reaction_type: string }[] = [];
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useToggleReaction: () => ({ mutate: jest.fn(), isPending: false }),
  useReactions: () => ({ data: { results: mockReactions } }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { id: 7 } }) }));
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { ReactionBar, REACTIONS } from "@/src/components/social/ReactionBar";

beforeEach(() => {
  mockReactions.length = 0;
});

describe("表态条", () => {
  it("五种,顺序照 App,长明灯在末位", () => {
    render(<ReactionBar postId="p1" />);
    const order = screen.getAllByRole("button").map((b) => b.getAttribute("data-reaction"));
    expect(order).toEqual(["LIKE", "LOVE", "RESPECT", "SYMPATHY", "ETERNAL_LIGHT"]);
    expect(REACTIONS.at(-1)?.type).toBe("ETERNAL_LIGHT");
  });

  it("只有长明灯有 ink 描边、标题字体;其余四种无框;两者之间是竖分隔", () => {
    const { container } = render(<ReactionBar postId="p1" />);
    for (const b of screen.getAllByRole("button")) {
      const lamp = b.getAttribute("data-reaction") === "ETERNAL_LIGHT";
      expect(b.className.includes("border-[oklch(var(--color-ink))]")).toBe(lamp);
      expect(b.className.includes("font-title")).toBe(lamp);
      // v2 的胶囊与长明灯色随 v3 撤掉
      expect(b.className).not.toContain("rounded-[9999px]");
      expect(b.className).not.toContain("--color-lamp");
    }
    const lamp = container.querySelector('[data-reaction="ETERNAL_LIGHT"]')!;
    expect(lamp.previousElementSibling).toHaveClass("w-px");
  });

  it("长明灯未点是「点长明灯」描边;点过是「长明灯已点」反白", () => {
    const { unmount } = render(<ReactionBar postId="p1" />);
    let lamp = screen.getByRole("button", { name: /social\.lamp\.light/ });
    expect(lamp).not.toHaveClass("bg-[oklch(var(--color-ink))]");
    unmount();
    mockReactions.push({ user: "7", reaction_type: "ETERNAL_LIGHT" });
    render(<ReactionBar postId="p1" />);
    lamp = screen.getByRole("button", { name: /social\.lamp\.lit/ });
    expect(lamp).toHaveClass("bg-[oklch(var(--color-ink))]", "text-[oklch(var(--color-surface-1))]");
    expect(screen.queryByRole("button", { name: /social\.lamp\.light/ })).toBeNull();
  });

  it("给了总数才写「表态 N · 评论 N」;评论里不写", () => {
    const { unmount } = render(<ReactionBar postId="p1" totals={{ reactions: 12, comments: 3 }} />);
    expect(screen.getByTestId("post-totals").textContent).toBe("social.reactions 12 · social.comments 3");
    unmount();
    render(<ReactionBar commentId="c1" />);
    expect(screen.queryByTestId("post-totals")).toBeNull();
  });

  it("我点过的那一种 aria-pressed 且加粗;别的不是", () => {
    mockReactions.push({ user: "7", reaction_type: "ETERNAL_LIGHT" });
    render(<ReactionBar postId="p1" />);
    const lamp = screen.getByRole("button", { name: /social\.lamp\.lit/ });
    expect(lamp).toHaveAttribute("aria-pressed", "true");
    expect(lamp).toHaveClass("font-semibold");
    const like = screen.getByRole("button", { name: /react\.like/ });
    expect(like).toHaveAttribute("aria-pressed", "false");
    expect(like).not.toHaveClass("font-semibold");
  });
});
