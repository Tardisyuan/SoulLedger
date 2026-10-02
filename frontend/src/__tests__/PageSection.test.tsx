import { render, screen } from "@testing-library/react";
import { PageSection } from "@/components/ui/page-section";

/**
 * `PageSection` 是 v3 面板(2026-10-02,v3/pages-b):surface-1 底 + 结构线外框,
 * 标题是 DESIGN.md 的「面板标题」—— `<h2>`、`text-lg`、界面字体。
 * 它此前是 v1「卡片 = 区块」:无底色、标题是 11 px 等宽大写栏目标签 —— 调度、跨文明审判
 * 两页的面板就长那样。断言里同时写「不在」的那一半:等宽与 2xs 回来就红。
 */
describe("PageSection — v3 panel", () => {
  it("is a surface-1 panel whose title is a 20 px interface-face panel title", () => {
    render(
      <PageSection title="待处理提案">
        <p>rows</p>
      </PageSection>
    );
    const heading = screen.getByRole("heading", { level: 2, name: "待处理提案" });
    expect(heading.className).toContain("text-lg");
    expect(heading.className).not.toMatch(/font-mono|text-2xs|uppercase/);

    const panel = heading.closest("section")!;
    expect(panel.className).toContain("bg-[oklch(var(--color-surface-1))]");
    expect(panel.className).toContain("border-[oklch(var(--color-line))]");
  });
});
