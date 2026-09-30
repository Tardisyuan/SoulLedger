/**
 * 表态条(规范 v2 补足 C17):五种对齐现有表态,长明灯在末位;长明灯是胶囊 + 长明灯色框,
 * 其余是方角 ink3 框;选中靠 aria-pressed + 字重,不只靠颜色。
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

  it("只有长明灯是胶囊、长明灯色框;其余四种方角", () => {
    render(<ReactionBar postId="p1" />);
    for (const b of screen.getAllByRole("button")) {
      const lamp = b.getAttribute("data-reaction") === "ETERNAL_LIGHT";
      expect(b.className.includes("rounded-[9999px]")).toBe(lamp);
      expect(b.className.includes("--color-lamp")).toBe(lamp);
    }
  });

  it("我点过的那一种 aria-pressed 且加粗;别的不是", () => {
    mockReactions.push({ user: "7", reaction_type: "ETERNAL_LIGHT" });
    render(<ReactionBar postId="p1" />);
    const lamp = screen.getByRole("button", { name: /eternal_light/ });
    expect(lamp).toHaveAttribute("aria-pressed", "true");
    expect(lamp).toHaveClass("font-semibold");
    const like = screen.getByRole("button", { name: /react\.like/ });
    expect(like).toHaveAttribute("aria-pressed", "false");
    expect(like).not.toHaveClass("font-semibold");
  });
});
