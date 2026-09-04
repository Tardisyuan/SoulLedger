/**
 * `src/components/workflow/page/TemplatePreview.tsx` — the one template
 * preview, and the two adapters that feed it.
 *
 * WHY THIS FILE EXISTS. This markup used to be written twice in
 * `app/workflow/page.tsx`, once per data shape. Measured before the merge with
 * an order-preserving LCS over the two comment-stripped extracts (82 and 81
 * lines): 44 aligned common lines, 19 of them pure closing tokens — **25
 * substantive shared lines**. The line count is not the argument. This is:
 * every one of those 25 lines was mutated in place, one at a time, against
 * `WorkflowPage.test.tsx` + `WorkflowPage.instances.test.tsx`, and exactly
 * **one** turned the suite red (`node_name`, on the backend copy). Blanking
 * either title, either civilization badge, either case-type badge, either
 * court cell, either node-type cell, either ordinal — 32 passed, every time.
 * Reverting the preset preview's `nodeTypeFor(...)` to the raw `n.type` that
 * shipped the 400 — 32 passed. Two copies, one guarded field between them.
 *
 * WHAT THIS GUARDS, and why it is falsifiable. Comparing the component against
 * itself would not be: same model in, same HTML out, always. What can still
 * drift is the pair of **adapters**, because that is where the two field-name
 * sets and the two meanings of `node_type` are reconciled. So the drift case
 * below builds one logical template in both source shapes, runs each through
 * its own adapter, and asserts the two models are deep-equal — and then
 * asserts that model equals a literal written out here, because two tables
 * agreeing is also what it looks like when both are wrong.
 *
 * `@/src/components/ui/DomainValue` is NOT stubbed. It is the component under
 * test as much as the preview is: `<DomainEnum>` is what turns a node type
 * into either a label or the "unrecognized" copy, and a stub that echoed its
 * `value` would reproduce the exact defect these cases exist to catch — the
 * §4.6 trap this repo already paid for once.
 */
import { render, screen, within } from "@testing-library/react";

import {
  TemplatePreview,
  backendPreviewModel,
  presetPreviewModel,
  type TemplatePreviewModel,
} from "@/src/components/workflow/page/TemplatePreview";
import { type WorkflowTemplateListItem } from "@soulledger/core/api";
import { type WorkflowTemplate as PresetTemplate } from "@soulledger/core/config/workflow-templates";

/**
 * `t` echoes its key, except for the four bundle entries these cases read.
 * Echoing is what the real I18nContext does on a miss, and `resolveEnumDisplay`
 * keys off exactly that — so an enum with no bundle entry lands in the
 * "unrecognized" state here just as it would in the app.
 */
const BUNDLE: Record<string, string> = {
  "workflow.node_type.trial": "审判",
  "workflow.node_type.final": "终审",
  "workflow.civilizations.CHINESE": "中国地府",
  "workflow.case_types.ROUTINE": "常规",
};

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const base = BUNDLE[key] ?? key;
      return params ? `${base}(${Object.values(params).join(",")})` : base;
    },
    locale: "zh",
    hydrated: true,
  }),
}));

// ── The same template, said twice ────────────────────────────────────
//
// One logical template in both source shapes. `court_code`/`court` and
// `node_name`/`name` are the rename pair; `node_type` is the one that is not a
// rename — the backend row already holds a validated `NodeType` member, the
// preset row holds the Chinese step name that has to be read as one.

const BACKEND_SHAPE = {
  id: "7",
  name: "十殿审判流程",
  description: "十殿逐级审理",
  civilization: "CHINESE",
  case_type: "ROUTINE",
  priority: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  node_count: 2,
  nodes_json: [
    { node_name: "秦广王 · 分流", court_code: "第一殿", node_type: "TRIAL" },
    { node_name: "转轮王 · 终审", court_code: "第十殿", node_type: "FINAL" },
  ],
} as unknown as WorkflowTemplateListItem;

const PRESET_SHAPE = {
  civilization: "CHINESE",
  caseType: "ROUTINE",
  name: "十殿审判流程",
  description: "十殿逐级审理",
  priority: 0,
  nodes: [
    { id: "n1", name: "秦广王 · 分流", court: "第一殿", type: "分流", order: 1 },
    { id: "n2", name: "转轮王 · 终审", court: "第十殿", type: "终审", order: 2 },
  ],
} as PresetTemplate;

/** What both adapters must produce. Written out, not derived from either one. */
const EXPECTED: TemplatePreviewModel = {
  name: "十殿审判流程",
  civilization: "CHINESE",
  caseType: "ROUTINE",
  description: "十殿逐级审理",
  nodeCount: 2,
  nodes: [
    { name: "秦广王 · 分流", court: "第一殿", nodeType: "TRIAL" },
    { name: "转轮王 · 终审", court: "第十殿", nodeType: "FINAL" },
  ],
};

describe("TemplatePreview adapters do not drift", () => {
  it("maps both source shapes onto the same model", () => {
    expect(backendPreviewModel(BACKEND_SHAPE)).toEqual(presetPreviewModel(PRESET_SHAPE));
  });

  it("maps both onto the model written out here, not merely onto each other", () => {
    // Two tables agreeing is also what two wrong tables look like. This is the
    // half that says which model is the right one.
    expect(backendPreviewModel(BACKEND_SHAPE)).toEqual(EXPECTED);
    expect(presetPreviewModel(PRESET_SHAPE)).toEqual(EXPECTED);
  });

  it("renders the two shapes to the same markup", () => {
    const backend = render(<TemplatePreview model={backendPreviewModel(BACKEND_SHAPE)} />);
    const backendHtml = backend.container.innerHTML;
    backend.unmount();

    const preset = render(<TemplatePreview model={presetPreviewModel(PRESET_SHAPE)} />);
    expect(preset.container.innerHTML).toBe(backendHtml);
  });
});

describe("TemplatePreview node rows", () => {
  it("numbers the steps from one, not from zero", () => {
    render(<TemplatePreview model={EXPECTED} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // Absence: an off-by-one would still render two chips, both plausible.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows each step's name and court", () => {
    render(<TemplatePreview model={EXPECTED} />);

    expect(screen.getByText("秦广王 · 分流")).toBeInTheDocument();
    expect(screen.getByText("第一殿")).toBeInTheDocument();
    expect(screen.getByText("转轮王 · 终审")).toBeInTheDocument();
    expect(screen.getByText("第十殿")).toBeInTheDocument();
  });

  it("shows the node type as a recognised member, never as the raw step name", () => {
    render(<TemplatePreview model={presetPreviewModel(PRESET_SHAPE)} />);

    // Known, not "unrecognized": the value reaching <DomainEnum> is a NodeType
    // member the bundle has a key for.
    expect(screen.getByTitle("TRIAL")).toHaveTextContent("审判");
    expect(screen.getByTitle("FINAL")).toHaveTextContent("终审");
    expect(screen.getByTitle("TRIAL")).toHaveAttribute("data-enum-state", "known");

    // Absence, twice over. Passing `n.type` straight through is the shipped
    // defect: the cell would read "unrecognized" and `title` would carry the
    // step name — the value that POSTs as a 400.
    expect(screen.queryByTitle("分流")).not.toBeInTheDocument();
    expect(screen.queryByText("common.value.unrecognized")).not.toBeInTheDocument();
  });
});

describe("TemplatePreview header and node count", () => {
  it("shows the name and both badges", () => {
    render(<TemplatePreview model={EXPECTED} />);

    expect(screen.getByRole("heading", { name: "十殿审判流程" })).toBeInTheDocument();
    expect(screen.getByTitle("CHINESE")).toHaveTextContent("中国地府");
    expect(screen.getByTitle("ROUTINE")).toHaveTextContent("常规");
  });

  it("reports the node count the model carries, not the length of the list it renders", () => {
    // A saved template's row carries `node_count` and no graph at all; counting
    // the rendered rows would print 0 for every such template.
    render(<TemplatePreview model={{ ...EXPECTED, nodeCount: 10, nodes: null }} />);

    expect(screen.getByText("workflow.nodes_count(10)")).toBeInTheDocument();
    expect(screen.queryByText("workflow.nodes_count(0)")).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when the description is empty", () => {
    render(<TemplatePreview model={{ ...EXPECTED, description: "" }} />);

    expect(screen.getByText("workflow.no_description")).toBeInTheDocument();
  });

  it("shows the real description rather than the placeholder when there is one", () => {
    render(<TemplatePreview model={EXPECTED} />);

    expect(screen.getByText("十殿逐级审理")).toBeInTheDocument();
    expect(screen.queryByText("workflow.no_description")).not.toBeInTheDocument();
  });

  it("renders the actions it is handed, and nothing where there are none", () => {
    const { rerender, container } = render(
      <TemplatePreview model={EXPECTED} actions={<button type="button">删除</button>} />
    );
    expect(screen.getByText("删除")).toBeInTheDocument();

    rerender(<TemplatePreview model={EXPECTED} />);
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
    expect(within(container).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("TemplatePreview node graph presence", () => {
  it("points at the detail view when the row carries no node graph", () => {
    // `nodes: null` is "this row did not come with a graph" — the shape every
    // saved template has, because the list serializer omits it.
    render(<TemplatePreview model={{ ...EXPECTED, nodes: null }} />);

    expect(screen.getByText("workflow.view_to_see_nodes")).toBeInTheDocument();
    expect(screen.queryByText("秦广王 · 分流")).not.toBeInTheDocument();
  });

  it("distinguishes an absent graph from an empty one", () => {
    // An empty array means the graph arrived and has no nodes. Collapsing the
    // two would tell an operator to go look at a detail page that is also empty.
    render(<TemplatePreview model={{ ...EXPECTED, nodes: [] }} />);

    expect(screen.queryByText("workflow.view_to_see_nodes")).not.toBeInTheDocument();
  });

  it("lists the nodes inline when the graph is there", () => {
    render(<TemplatePreview model={EXPECTED} />);

    expect(screen.queryByText("workflow.view_to_see_nodes")).not.toBeInTheDocument();
    expect(screen.getByText("秦广王 · 分流")).toBeInTheDocument();
  });

  it("turns a backend row with no nodes_json into an absent graph, not an empty one", () => {
    const { nodes_json: _omitted, ...withoutGraph } = BACKEND_SHAPE as WorkflowTemplateListItem & {
      nodes_json?: unknown;
    };

    expect(backendPreviewModel(withoutGraph as WorkflowTemplateListItem).nodes).toBeNull();
  });
});
