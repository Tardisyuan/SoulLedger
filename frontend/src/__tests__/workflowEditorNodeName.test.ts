/**
 * The editor's linear preview, exits and issue list name a node through `nodeName`. In English it reads the node's
 * English when there is one; every other language, and a node without one, keeps the source name.
 */
import type { Node } from "@xyflow/react";

import { nodeName } from "@/src/components/workflow/WorkflowEditorPanels";
import { getLocale } from "@soulledger/core/platform";

jest.mock("@soulledger/core/platform", () => ({
  ...jest.requireActual("@soulledger/core/platform"),
  getLocale: jest.fn(),
}));

const t = (key: string) => key;
const node = (data: Record<string, unknown>) => ({ id: "n1", position: { x: 0, y: 0 }, data }) as Node;
const locale = (value: string) => (getLocale as jest.Mock).mockReturnValue(value);

it("reads the English in English", () => {
  locale("en");
  expect(nodeName(node({ label: "核验节点", labelEn: "Check Node" }), t)).toBe("Check Node");
});

it("falls back to the source name when no English was written", () => {
  locale("en");
  expect(nodeName(node({ label: "核验节点", labelEn: "  " }), t)).toBe("核验节点");
});

it("keeps the source name in Chinese", () => {
  locale("zh-Hans");
  expect(nodeName(node({ label: "核验节点", labelEn: "Check Node" }), t)).toBe("核验节点");
});

it("says unnamed when there is neither", () => {
  locale("en");
  expect(nodeName(node({}), t)).toBe("workflow.editor.unnamed");
});
