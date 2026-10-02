/**
 * 审批流编辑器的节点框(v3 A1):168 宽,1px line-strong 实线,不分角色;选中是 2px ink 框;
 * 有问题是 danger 边框加名称行末的 `!`。文明色**不进画布**(用户 10-02)。
 */
import type { ComponentType } from "react";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { nodeTypes } from "@/src/components/workflow/EditableNode";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "zh-Hans", hydrated: true }),
}));

const Node = nodeTypes.editableNode as unknown as ComponentType<{ data: Record<string, unknown>; selected: boolean }>;

function frame(role: string, selected = false, extra: Record<string, unknown> = {}) {
  const { container } = render(
    <ReactFlowProvider>
      <Node selected={selected} data={{ label: "殿主复核", nodeType: "APPROVAL", courtCode: "CN_5", approverRole: "JUDGE", role, ...extra }} />
    </ReactFlowProvider>
  );
  return container.querySelector("[data-role]") as HTMLElement;
}

it("draws every role with the same solid line-strong frame, 168 wide", () => {
  for (const role of ["entry", "step", "branch", "end"]) {
    const el = frame(role);
    expect(el.className).toMatch(/border-\[oklch\(var\(--color-line-strong\)\)\]/);
    expect(el.className).toMatch(/w-\[168px\]/);
    expect(el.className).not.toMatch(/border-dashed/);
  }
});

it("marks the selected node with a 2px ink frame, never the civilization colour", () => {
  const on = frame("step", true);
  expect(on.className).toMatch(/outline-2/);
  expect(on.className).toMatch(/outline-\[oklch\(var\(--color-ink\)\)\]/);
  expect(on.className).not.toMatch(/color-main|color-accent/);
  expect(frame("step", false).className).not.toMatch(/outline-2/);
});

it("shows the role on the first line and the kind glyph before the name", () => {
  const el = frame("branch", false, { kind: "COUNTERSIGN", signers: [{}, {}, {}], threshold: 2 });
  expect(el.textContent).toContain("◇ workflow.editor.role.branch");
  expect(el.textContent).toContain("⧉ 殿主复核");
  expect(el.textContent).toContain("CN_5 · 2/3");
});

it("puts a node with issues in danger, with a `!`, and a clean one in neither", () => {
  const bad = frame("step", false, { issueCount: 2 });
  expect(bad.className).toMatch(/border-\[oklch\(var\(--color-danger\)\)\]/);
  expect(bad.textContent).toContain("!");
  const ok = frame("step");
  expect(ok.className).not.toMatch(/color-danger/);
  expect(ok.textContent).not.toContain("!");
});
