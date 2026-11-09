/**
 * 审批流编辑器的节点卡片(Design v4 第十四批 §2):176 宽、圆角 6,常态 1px line 内边;选中是 2px 强调色外环
 * 加左右两个圆点;出错是 1.5px danger 内边、角上「!」徽记、底部一行短说明 —— 选中与出错靠形状分开,不只靠颜色。
 */
import type { ComponentType } from "react";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { nodeTypes } from "@/src/components/workflow/EditableNode";

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ locale: "zh-Hans", hydrated: true }));

const Node = nodeTypes.editableNode as unknown as ComponentType<{ data: Record<string, unknown>; selected: boolean }>;

function frame(role: string, selected = false, extra: Record<string, unknown> = {}) {
  const { container } = render(
    <ReactFlowProvider>
      <Node selected={selected} data={{ label: "殿主复核", nodeType: "TRIAL", courtCode: "CN_5", approverRole: "JUDGE", role, ...extra }} />
    </ReactFlowProvider>
  );
  return container.querySelector("[data-role]") as HTMLElement;
}

it("draws every role with the same solid 1px line inner edge, 176 wide, panel radius (6)", () => {
  for (const role of ["entry", "step", "branch", "end"]) {
    const el = frame(role);
    expect(el.className).toMatch(/border-\[oklch\(var\(--color-line\)\)\]/);
    expect(el.className).toMatch(/w-\[176px\]/);
    expect(el.className).toMatch(/rounded-panel/);
    expect(el.className).not.toMatch(/border-dashed/);
  }
});

it("uses only the shadow tokens: the card shadow in light, raised while dragged, no literal colour", () => {
  const el = frame("step");
  expect(el.className).toMatch(/\[\.light_&\]:shadow-\(--shadow-card\)/);
  expect(el.className).not.toMatch(/shadow-\[/);
});

it("marks the selected node with an accent ring and two dots; an unselected one with neither", () => {
  const on = frame("step", true);
  expect(on.className).toMatch(/outline-2/);
  expect(on.className).toMatch(/outline-\[oklch\(var\(--color-accent\)\)\]/);
  expect(on.querySelectorAll("[data-selected-dot]")).toHaveLength(2);
  const off = frame("step", false);
  expect(off.className).not.toMatch(/outline-2/);
  expect(off.querySelectorAll("[data-selected-dot]")).toHaveLength(0);
});

it("line 1 is role glyph · kind · stage code with the threshold at the right; line 2 the name", () => {
  const el = frame("branch", false, { kind: "COUNTERSIGN", signers: [{}, {}, {}], threshold: 2 });
  expect(el.textContent).toContain("◇ ⧉ workflow.editor.kind.COUNTERSIGN");
  expect(el.textContent).toContain("TRIAL");
  expect(el.textContent).toContain("2/3");
  expect(el.textContent).toContain("殿主复核");
  // The court is no longer on the card (it is in the inspector and the accessible name).
  expect(el.textContent).not.toContain("CN_5");
});

it("a node with issues: danger inner edge, the「!」badge and the short reason; a clean one has none of them", () => {
  const bad = frame("step", false, { issueCount: 2, issueCodes: ["no_exit", "unreachable"] });
  expect(bad.className).toMatch(/border-\[1\.5px\]/);
  expect(bad.className).toMatch(/border-\[oklch\(var\(--color-danger\)\)\]/);
  expect(bad.querySelector("[data-issue-badge]")).not.toBeNull();
  expect(bad.querySelector("[data-issue-line]")?.textContent).toContain("workflow.editor.issue_short.no_exit");
  const ok = frame("step");
  expect(ok.className).not.toMatch(/color-danger/);
  expect(ok.querySelector("[data-issue-badge]")).toBeNull();
  expect(ok.querySelector("[data-issue-line]")).toBeNull();
  expect(ok.textContent).not.toContain("!");
});

it("selected and failing at once keeps the ring, the red edge and the issue line", () => {
  const el = frame("step", true, { issueCount: 1, issueCodes: ["name_empty"] });
  expect(el.className).toMatch(/outline-\[oklch\(var\(--color-accent\)\)\]/);
  expect(el.className).toMatch(/border-\[oklch\(var\(--color-danger\)\)\]/);
  expect(el.querySelector("[data-issue-line]")?.textContent).toContain("workflow.editor.issue_short.name_empty");
});
