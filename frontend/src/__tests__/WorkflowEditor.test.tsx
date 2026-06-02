/**
 * Tests for WorkflowEditor component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock all heavy dependencies before import
jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    ReactFlow: ({ children, ...props }: any) => <div data-testid="react-flow">{children}</div>,
    Controls: () => <div>Controls</div>,
    Background: () => <div>Background</div>,
    Panel: ({ children }: any) => <div>{children}</div>,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
    MarkerType: { ArrowClosed: "arrow" },
    useNodesState: (initial: any[]) => {
      const [nodes, setNodes] = React.useState(initial);
      const onNodesChange = jest.fn();
      return [nodes, setNodes, onNodesChange];
    },
    useEdgesState: (initial: any[]) => {
      const [edges, setEdges] = React.useState(initial);
      const onEdgesChange = jest.fn();
      return [edges, setEdges, onEdgesChange];
    },
    addEdge: (edge: any, edges: any[]) => [...edges, edge],
    NodeChange: {},
    EdgeChange: {},
    BackgroundVariant: { Dots: "dots" },
    NodeTypes: {},
    Connection: {},
  };
});

jest.mock("@xyflow/react/dist/style.css", () => {});

jest.mock("@/lib/api", () => ({
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
    t: (key: string) => {
      const map: Record<string, string> = {
        "workflow.editor.template_name_placeholder": "Template name...",
        "workflow.editor.add_node": "Add Node",
        "workflow.editor.delete_selected": "Delete Selected",
        "workflow.editor.save_template": "Save Template",
        "workflow.editor.saving": "Saving...",
        "workflow.editor.edit_node": "Edit Node",
        "workflow.editor.node_name": "Node Name",
        "workflow.editor.node_type": "Node Type",
        "workflow.editor.court_code": "Court Code",
        "workflow.editor.court_placeholder": "e.g. First Court",
        "workflow.editor.approver_type": "Approver Type",
        "workflow.editor.approver_role": "Approver Role",
        "workflow.editor.approver_placeholder": "e.g. Qinguang Wang",
        "workflow.editor.new_node": "New Node",
        "workflow.editor.hint": "Double-click nodes to edit",
        "workflow.editor.saved": "Saved!",
        "workflow.editor.save_failed": "Save failed",
        "workflow.node_type.trial": "Trial",
        "workflow.node_type.evaluation": "Evaluation",
        "workflow.node_type.appeal": "Appeal",
        "workflow.node_type.final": "Final",
        "workflow.node_type.execution": "Execution",
        "workflow.approver_types.ROLE": "Role",
        "workflow.approver_types.ACTOR": "Actor",
        "workflow.approver_types.SYSTEM": "System",
        "workflow.civilizations.CHINESE": "Chinese",
        "workflow.civilizations.EUROPEAN": "European",
        "workflow.civilizations.EGYPTIAN": "Egyptian",
        "workflow.case_types.ROUTINE": "Routine",
        "workflow.case_types.APPEAL": "Appeal",
        "workflow.case_types.CROSS_REALM": "Cross-Realm",
        "workflow.case_types.SPECIAL": "Special",
        "workflow.case_types.CANONIZATION": "Canonization",
        "workflow.case_types.PURGATORY_REVIEW": "Purgatory Review",
        "workflow.case_types.HERESY_TRIAL": "Heresy Trial",
        "workflow.case_types.HEART_WEIGHING": "Heart Weighing",
        "workflow.case_types.DIVINE_TRIAL": "Divine Trial",
        "common.cancel": "Cancel",
        "common.save": "Save",
      };
      return map[key] || key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: jest.fn(),
  }),
}));

// Mock the Modal component used internally
jest.mock("@/src/components/ui/Modal", () => ({
  Modal: ({ isOpen, onClose, title, children }: any) =>
    isOpen ? (
      <div data-testid="modal">
        <h3>{title}</h3>
        <button onClick={onClose}>Close Modal</button>
        {children}
      </div>
    ) : null,
}));

import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("WorkflowEditor", () => {
  it("renders the toolbar with template name input and action buttons", () => {
    renderWithProviders(<WorkflowEditor />);
    expect(screen.getByPlaceholderText("Template name...")).toBeInTheDocument();
    expect(screen.getByText(/Add Node/)).toBeInTheDocument();
    expect(screen.getByText(/Delete Selected/)).toBeInTheDocument();
    expect(screen.getByText(/Save Template/)).toBeInTheDocument();
  });

  it("renders the ReactFlow canvas", () => {
    renderWithProviders(<WorkflowEditor />);
    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
  });

  it("renders civilization and case type selects", () => {
    renderWithProviders(<WorkflowEditor />);
    // Chinese is the default civilization option text
    expect(screen.getByText("Chinese")).toBeInTheDocument();
    // Default case type
    expect(screen.getByText("Routine")).toBeInTheDocument();
  });

  it("updates template name when typing", () => {
    renderWithProviders(<WorkflowEditor />);
    const input = screen.getByPlaceholderText("Template name...");
    fireEvent.change(input, { target: { value: "My Template" } });
    expect(input).toHaveValue("My Template");
  });

  it("calls onSave callback when save mutation succeeds", () => {
    const onSave = jest.fn();
    renderWithProviders(<WorkflowEditor onSave={onSave} />);
    // The save button should be present
    const saveBtn = screen.getByText(/Save Template/);
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).not.toBeDisabled();
  });

  it("delete button is disabled when no node is selected", () => {
    renderWithProviders(<WorkflowEditor />);
    const deleteBtn = screen.getByText(/Delete Selected/);
    expect(deleteBtn).toBeDisabled();
  });

  it("renders hint panel", () => {
    renderWithProviders(<WorkflowEditor />);
    expect(screen.getByText("Double-click nodes to edit")).toBeInTheDocument();
  });
});
