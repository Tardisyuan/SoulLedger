/**
 * The saved payload has to carry the edges as they are **now**.
 *
 * WHY THIS FILE EXISTS, AND WHY `WorkflowEditor.test.tsx` CANNOT COVER IT.
 * `getTemplateNodes` reads both `nodes` and `edges` but was memoised on
 * `[nodes]` alone, so it kept whatever `edges` were in scope the last time
 * `nodes` changed identity. Every path in the sibling file that produces an
 * edge (`addNode`) changes `nodes` in the same commit, which refreshes the
 * closure and hides the defect. The one path that moves `edges` without
 * touching `nodes` is `onConnect` — the operator drawing a branch by hand —
 * and reaching it needs a `@xyflow/react` mock that actually hands the
 * `onConnect` prop back, which the sibling file's mock does not.
 *
 * The failure it pins is silent in exactly the way that matters: the save
 * answers 201 and the branch the operator just drew is simply not in the body.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    // Unlike the sibling file's mock, this one exposes `onConnect` as a real
    // control. Without it there is no way to change `edges` on its own, and
    // the whole point of this file is that path.
    ReactFlow: ({ children, onConnect }: any) => (
      <div data-testid="react-flow">
        <button
          data-testid="draw-fail-edge"
          onClick={() =>
            onConnect({ source: "A", target: "B", sourceHandle: "fail", targetHandle: null })
          }
        >
          draw fail edge
        </button>
        {children}
      </div>
    ),
    Controls: () => <div>Controls</div>,
    Background: () => <div>Background</div>,
    Panel: ({ children }: any) => <div>{children}</div>,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
    MarkerType: { ArrowClosed: "arrow" },
    useNodesState: (initial: any[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, jest.fn()];
    },
    useEdgesState: (initial: any[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, jest.fn()];
    },
    addEdge: (edge: any, edges: any[]) => [...edges, { id: `e-${edges.length}`, ...edge }],
    NodeChange: {},
    EdgeChange: {},
    BackgroundVariant: { Dots: "dots" },
    NodeTypes: {},
    Connection: {},
  };
});

jest.mock("@xyflow/react/dist/style.css", () => {});

jest.mock("@soulledger/core/api", () => ({
  workflowApi: {
    templates: {
      get: jest.fn().mockResolvedValue({ data: null }),
      create: jest.fn().mockResolvedValue({ data: { id: "new-1" } }),
      update: jest.fn().mockResolvedValue({ data: { id: "updated-1" } }),
    },
  },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "workflow.editor.add_node": "Add Node",
        "workflow.editor.save_template": "Save Template",
        "workflow.editor.new_node": "New Node",
        "workflow.detail.priority": "Priority",
        "workflow.detail.normal": "Normal",
        "workflow.detail.urgent": "Urgent",
        "workflow.detail.critical": "Critical",
      })[key] || key,
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("@/src/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
}));

import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEditor
        initialTemplateData={{
          name: "two node chain",
          civilization: "CHINESE",
          case_type: "ROUTINE",
          priority: 0,
          nodes_json: [
            { id: "A", node_name: "A", node_type: "TRIAL", node_order: 1, approver_type: "ROLE" },
            { id: "B", node_name: "B", node_type: "FINAL", node_order: 2, approver_type: "ROLE" },
          ],
        }}
      />
    </QueryClientProvider>
  );
}

describe("WorkflowEditor — edges drawn after the last node change reach the save body", () => {
  beforeEach(() => {
    const { workflowApi } = require("@soulledger/core/api");
    workflowApi.templates.create.mockClear();
  });

  it("sends the fail branch the operator drew, with no node edit in between", async () => {
    const { workflowApi } = require("@soulledger/core/api");
    renderEditor();

    // `edges` moves; `nodes` does not. This is the only sequence that can
    // catch a `getTemplateNodes` memoised on `[nodes]`.
    fireEvent.click(screen.getByTestId("draw-fail-edge"));
    fireEvent.click(screen.getByText(/Save Template/));

    await waitFor(() => expect(workflowApi.templates.create).toHaveBeenCalled());
    const payload = workflowApi.templates.create.mock.calls.at(-1)![0];
    const nodeA = payload.nodes.find((n: any) => n.id === "A");
    expect(nodeA).toBeDefined();
    // Presence AND absence: `on_fail: null` is precisely what the stale
    // closure produces, so asserting only "the payload has an on_fail key"
    // would stay green through the defect.
    expect(nodeA.on_fail).toBe("B");
  });
});
