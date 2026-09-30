/**
 * 审批流编辑器的节点框(规范 v2 补足 C15):普通节点 1px ink3 实线,条件(分支 ◇)节点虚线,
 * 选中是 2px 焦点框。
 */
import type { ComponentType } from "react";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { nodeTypes } from "@/src/components/workflow/EditableNode";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "zh-Hans", hydrated: true }),
}));

const Node = nodeTypes.editableNode as unknown as ComponentType<{ data: Record<string, unknown>; selected: boolean }>;

function frame(role: string, selected = false) {
  const { container } = render(
    <ReactFlowProvider>
      <Node selected={selected} data={{ label: "殿主复核", nodeType: "APPROVAL", courtCode: "CN_5", approverRole: "JUDGE", role }} />
    </ReactFlowProvider>
  );
  return container.querySelector("[data-role]") as HTMLElement;
}

it("draws a branch node dashed and a plain step solid, both in ink3", () => {
  const branch = frame("branch");
  const step = frame("step");
  expect(branch.className).toMatch(/border-dashed/);
  expect(step.className).not.toMatch(/border-dashed/);
  for (const el of [branch, step]) {
    expect(el.className).toMatch(/border-\[oklch\(var\(--color-ink-subtle\)\)\]/);
    expect(el.className).not.toMatch(/color-block/);
  }
});

it("marks the selected node with the 2px focus frame and only that one", () => {
  expect(frame("step", true).className).toMatch(/outline-2/);
  expect(frame("step", false).className).not.toMatch(/outline-2/);
});
