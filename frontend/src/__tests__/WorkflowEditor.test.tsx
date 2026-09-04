/**
 * Tests for WorkflowEditor component
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock all heavy dependencies before import
jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    /**
     * A WRAPPER PER NODE, WHICH THIS STUB DID NOT USED TO RENDER.
     *
     * The keyboard path added to `WorkflowEditor.tsx` is a delegated `keydown`
     * listener on the canvas element that resolves the pressed node through
     * `.react-flow__node[data-id]`. With `{children}` alone there is no such
     * element in this tree and every assertion about it would be made against
     * nothing.
     *
     * The attributes below are the ones the real wrapper carries, copied from
     * `@xyflow/react` 12.10.2's own bundle (`dist/esm/index.mjs`, the single
     * `jsx("div", …)` at line 2240) and in its order — including the fact that
     * `domAttributes` is spread LAST, which is the whole reason
     * `WorkflowEditor.tsx` puts nothing but `aria-keyshortcuts` in it.
     *
     * WHAT THIS STUB IS NOT EVIDENCE OF, said plainly: that a node is reachable
     * by Tab. `tabIndex` here is a string this file wrote, so asserting it back
     * would be asserting the stub. Reachability is proven in chromium by
     * `e2e/workflow.spec.ts` ("keyboard-only operator"), which tabs from a real
     * toolbar control into a real canvas.
     */
    ReactFlow: ({ children, nodes }: any) => (
      <div data-testid="react-flow">
        {(nodes ?? []).map((n: any) => (
          <div
            key={n.id}
            className="react-flow__node"
            data-id={n.id}
            tabIndex={0}
            role={n.ariaRole ?? "group"}
            aria-roledescription="node"
            aria-label={n.ariaLabel}
            {...n.domAttributes}
          />
        ))}
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
    t: (key: string) => {
      const map: Record<string, string> = {
        "workflow.editor.template_name_placeholder": "Template name...",
        "workflow.editor.add_node": "Add Node",
        "workflow.editor.auto_layout": "Auto layout",
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
        // The three priority labels are `workflow.detail.*`, reused rather
        // than duplicated: `app/workflow/[id]/page.tsx` shows the *instance*
        // priority with the same keys, and this select sets the template
        // default that instance inherits.
        "workflow.detail.priority": "Priority",
        "workflow.detail.normal": "Normal",
        "workflow.detail.urgent": "Urgent",
        "workflow.detail.critical": "Critical",
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

  // ── template priority ──────────────────────────────────────────────
  //
  // The template-level default urgency. It has to reach the POST body: DRF
  // discards a key the serializer does not declare *without complaining*, and
  // the mirror-image failure here is the editor never sending it at all — in
  // both cases the save answers 201 and the value is gone.

  it("offers the three priority levels, using the same labels as the detail page", () => {
    renderWithProviders(<WorkflowEditor />);
    const select = screen.getByLabelText("Priority");
    expect(select).toHaveValue("0");
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => o.textContent)
    ).toEqual(["Normal", "Urgent", "Critical"]);
  });

  it("opens a preset at the priority the preset declares", () => {
    renderWithProviders(
      <WorkflowEditor
        initialTemplateData={{
          name: "紧急审判流程",
          civilization: "CHINESE",
          case_type: "SPECIAL",
          priority: 1,
          nodes_json: [],
        }}
      />
    );
    expect(screen.getByLabelText("Priority")).toHaveValue("1");
  });

  it("sends the chosen priority in the saved template", async () => {
    const { workflowApi } = require("@soulledger/core/api");
    renderWithProviders(<WorkflowEditor />);

    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "2" } });
    fireEvent.click(screen.getByText(/Save Template/));

    await waitFor(() => expect(workflowApi.templates.create).toHaveBeenCalled());
    expect(workflowApi.templates.create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 2 })
    );
  });

  it("sends 0 rather than omitting the field when the level is left at normal", async () => {
    // Absence: an editor that only forwarded a *changed* priority would keep
    // the case above green while every unchanged template arrived without the
    // key — which the backend reads as "not specified", not as "normal".
    const { workflowApi } = require("@soulledger/core/api");
    const before = workflowApi.templates.create.mock.calls.length;
    renderWithProviders(<WorkflowEditor />);

    fireEvent.click(screen.getByText(/Save Template/));

    // The module-level mock is shared across this file's cases and is not
    // cleared between them, so read *this* render's call rather than the first
    // one ever made.
    await waitFor(() =>
      expect(workflowApi.templates.create.mock.calls.length).toBeGreaterThan(before)
    );
    const payload = workflowApi.templates.create.mock.calls.at(-1)[0];
    expect(payload).toHaveProperty("priority", 0);
  });

  // ── auto layout ────────────────────────────────────────────────────
  //
  // The button is the ONE moment a node that already has a position is
  // allowed to move. Everything else in this editor — loading a saved
  // template, adding a node, drawing an edge — must leave an arranged canvas
  // exactly where the operator left it.
  //
  // Positions are read back out of the SAVE PAYLOAD rather than off the
  // canvas, because this file's `@xyflow/react` mock renders no nodes. That
  // is not a workaround: `getTemplateNodes` is what persists coordinates
  // (`WorkflowEditor.tsx` → `position: { x: Math.round(…) }`), so the payload
  // is the only place a moved node is observable at all, and it is the place
  // that matters. It also means no third copy of the xyflow stub — see the
  // header of `workflowEditorEdgeRouting.test.tsx` for why that is a rule.

  /** Open the editor on a three-node chain that was saved in an arrangement
   *  no layout would produce. */
  function renderArranged() {
    return renderWithProviders(
      <WorkflowEditor
        initialTemplateData={{
          name: "arranged",
          civilization: "CHINESE",
          case_type: "ROUTINE",
          priority: 0,
          nodes_json: [
            { id: "A", node_name: "A", node_type: "TRIAL", node_order: 1, approver_type: "ROLE" },
            { id: "B", node_name: "B", node_type: "TRIAL", node_order: 2, approver_type: "ROLE" },
            { id: "C", node_name: "C", node_type: "FINAL", node_order: 3, approver_type: "ROLE" },
          ],
        }}
      />
    );
  }

  async function savedPositions() {
    const { workflowApi } = require("@soulledger/core/api");
    fireEvent.click(screen.getByText(/Save Template/));
    await waitFor(() => expect(workflowApi.templates.create).toHaveBeenCalled());
    const payload = workflowApi.templates.create.mock.calls.at(-1)[0];
    return Object.fromEntries(
      payload.nodes.map((n: { id: string; position: { x: number; y: number } }) => [
        n.id,
        n.position,
      ])
    );
  }

  it("lays the canvas out on load — a preset does not open as one column at x=250", async () => {
    const { workflowApi } = require("@soulledger/core/api");
    workflowApi.templates.create.mockClear();
    renderArranged();

    const before = await savedPositions();
    // Absence: the coordinates the old fallback produced. A chain is still one
    // column — that is the point of `ranksep` — but it is the layout's column,
    // and the y values are the layout's, not `idx * 160 + nothing`.
    expect(Object.values(before)).not.toContainEqual({ x: 250, y: 0 });
    expect(before.B.y - before.A.y).toBe(160);
  });

  /**
   * A SAVED template, opened by id, whose three nodes were dragged into an
   * arrangement no layout would ever produce: out of order, overlapping ranks,
   * one of them parked 900px down. This is the fixture the two claims that
   * matter most are made against — "loading changes nothing" and "the button
   * changes everything" — and it only works through `templateId`, because the
   * preset path carries no stored coordinates to preserve in the first place.
   */
  const DRAGGED = {
    A: { x: 40, y: 900 },
    B: { x: 900, y: 40 },
    C: { x: 600, y: 500 },
  };

  function renderDragged() {
    const { workflowApi } = require("@soulledger/core/api");
    workflowApi.templates.get.mockResolvedValueOnce({
      data: {
        id: "t-1",
        name: "dragged",
        civilization: "CHINESE",
        case_type: "ROUTINE",
        priority: 0,
        nodes: (["A", "B", "C"] as const).map((id, idx) => ({
          id,
          node_name: id,
          node_type: "TRIAL",
          court_code: "",
          approver_role: "",
          approver_type: "ROLE",
          node_order: idx + 1,
          position: DRAGGED[id],
        })),
      },
    });
    return renderWithProviders(<WorkflowEditor templateId="t-1" />);
  }

  async function savedPositionsForUpdate() {
    const { workflowApi } = require("@soulledger/core/api");
    fireEvent.click(screen.getByText(/Save Template/));
    await waitFor(() => expect(workflowApi.templates.update).toHaveBeenCalled());
    const payload = workflowApi.templates.update.mock.calls.at(-1)[1];
    return Object.fromEntries(
      payload.nodes.map((n: { id: string; position: { x: number; y: number } }) => [
        n.id,
        n.position,
      ])
    );
  }

  it("loading a template with saved positions changes NOT ONE of them", async () => {
    const { workflowApi } = require("@soulledger/core/api");
    workflowApi.templates.update.mockClear();
    renderDragged();
    await screen.findByDisplayValue("dragged");

    // The absence assertion this whole feature turns on. Three coordinates,
    // each of them a place the layout would never choose, all unchanged.
    expect(await savedPositionsForUpdate()).toEqual(DRAGGED);
  });

  it("the auto-layout button moves nodes that already have positions", async () => {
    const { workflowApi } = require("@soulledger/core/api");
    workflowApi.templates.update.mockClear();
    renderDragged();
    await screen.findByDisplayValue("dragged");

    fireEvent.click(screen.getByText("Auto layout"));
    const after = await savedPositionsForUpdate();

    // Every one of the three moved — not just "the set differs".
    for (const id of ["A", "B", "C"] as const) {
      expect(after[id]).not.toEqual(DRAGGED[id]);
    }
    // And moved into the layout: a chain, one column, the 160px pitch.
    expect(new Set(Object.values(after).map((p) => p.x)).size).toBe(1);
    expect(after.B.y - after.A.y).toBe(160);
    expect(after.C.y - after.B.y).toBe(160);
  });

  it("is disabled on an empty canvas and enabled once there is a node", () => {
    renderWithProviders(<WorkflowEditor />);
    const button = screen.getByText("Auto layout");
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByText(/Add Node/));
    expect(screen.getByText("Auto layout")).not.toBeDisabled();
  });

  it("adds a new node BELOW the graph rather than on the old 160px grid", async () => {
    const { workflowApi } = require("@soulledger/core/api");
    workflowApi.templates.create.mockClear();
    renderArranged();

    fireEvent.click(screen.getByText(/Add Node/));
    const positions = await savedPositions();
    const added = Object.entries(positions).find(([id]) => id.startsWith("node-"))!;

    const lowest = Math.max(...["A", "B", "C"].map((id) => positions[id].y));
    // Below the lowest CARD, not merely below the lowest origin — 110 is the
    // measured height of a full card.
    expect(added[1].y).toBeGreaterThanOrEqual(lowest + 110);
    // Absence: `nodes.length * 160 + 80` is what it used to be, and on this
    // three-node chain that is 560 — a coordinate that sits between B and C.
    expect(added[1].y).not.toBe(560);
  });

  // ── keyboard access to the node edit modal ─────────────────────────
  //
  // `onNodeDoubleClick` was the only way into this modal, so a keyboard-only
  // operator could not edit a single node of a template. `E` is the way in.
  //
  // WHAT RUNS HERE AND WHAT DOES NOT. jsdom can show that the listener is
  // wired, scoped and guarded — those are decisions, and decisions are exactly
  // what a stub can hold still. It cannot show that a node is REACHABLE: the
  // `tabIndex` above is this file's own string, and jsdom has no focus ring, no
  // sequential-navigation order worth the name and no `:focus-visible`. The
  // reachability claim lives in `e2e/workflow.spec.ts`, in chromium.

  /** Three nodes with names, types and courts, so an accessible name has all
   *  three fields to be built out of. */
  function renderNamed() {
    return renderWithProviders(
      <WorkflowEditor
        initialTemplateData={{
          name: "named",
          civilization: "CHINESE",
          case_type: "ROUTINE",
          priority: 0,
          nodes_json: [
            { id: "A", node_name: "秦广王 · 分流", node_type: "TRIAL", court_code: "第一殿", node_order: 1, approver_type: "ROLE" },
            { id: "B", node_name: "楚江王 · 初审", node_type: "EVALUATION", court_code: "第二殿", node_order: 2, approver_type: "ROLE" },
            { id: "C", node_name: "转轮王 · 终审", node_type: "FINAL", court_code: "", node_order: 3, approver_type: "ROLE" },
          ],
        }}
      />
    );
  }

  const wrappers = () =>
    Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node"));
  const wrapperFor = (id: string) =>
    document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;

  it("names every node from the three fields its card shows, in that order", () => {
    renderNamed();

    expect(wrappers().map((el) => el.getAttribute("aria-label"))).toEqual([
      // The raw member `TRIAL`, not the translated "Trial": `EditableNode.tsx`
      // prints `data.nodeType` verbatim on the card, and an accessible name
      // that says something the visible label does not is WCAG 2.5.3.
      "秦广王 · 分流, TRIAL, 第一殿",
      "楚江王 · 初审, EVALUATION, 第二殿",
      // No court: the field is dropped, not rendered as an empty slot.
      "转轮王 · 终审, FINAL",
    ]);
  });

  it("never leaves a node with an empty accessible name", () => {
    // Absence, and the reason the fallback is the id rather than "": an empty
    // `aria-label` does not defer to the element's other naming paths, it
    // silences them — the node would announce as nothing at all.
    // `presetTemplateToFlow` defaults `label` to "", so this node is reachable.
    renderWithProviders(
      <WorkflowEditor
        initialTemplateData={{
          name: "blank",
          civilization: "CHINESE",
          case_type: "ROUTINE",
          priority: 0,
          nodes_json: [{ id: "blank-1", node_order: 1 }],
        }}
      />
    );

    const labels = wrappers().map((el) => el.getAttribute("aria-label"));
    expect(labels).toHaveLength(1);
    for (const label of labels) {
      expect(label).toBeTruthy();
      expect(label).not.toBe("");
    }
    // `presetTemplateToFlow` still supplies the "TRIAL" default, so the name is
    // that; a node with nothing at all falls back to its id.
    expect(labels[0]).toBe("TRIAL");
  });

  it("announces the shortcut on the node itself", () => {
    renderNamed();
    // `aria-keyshortcuts` is the half of discoverability a screen reader gets;
    // the `<kbd>E</kbd>` in the hint panel is the half a sighted operator gets.
    for (const el of wrappers()) {
      expect(el.getAttribute("aria-keyshortcuts")).toBe("E");
    }
    // And it did not cost the accessible name: `domAttributes` is spread after
    // xyflow's own `aria-label`, so anything named in it REPLACES what xyflow
    // set. This is the assertion that catches an `aria-label` being added there.
    expect(wrapperFor("A").getAttribute("aria-label")).toBe("秦广王 · 分流, TRIAL, 第一殿");
  });

  it("opens THAT node's edit modal when E is pressed on it", () => {
    renderNamed();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    fireEvent.keyDown(wrapperFor("B"), { key: "e", bubbles: true });

    expect(screen.getByTestId("modal")).toBeInTheDocument();
    // The node, not merely a node — a handler that always opened the first one
    // would satisfy "the modal opened".
    expect(screen.getByLabelText("Node Name")).toHaveValue("楚江王 · 初审");
  });

  it("takes an uppercase E too", () => {
    // Shift is deliberately NOT in the modifier guard: `event.key` is then "E".
    renderNamed();
    fireEvent.keyDown(wrapperFor("C"), { key: "E", shiftKey: true, bubbles: true });
    expect(screen.getByLabelText("Node Name")).toHaveValue("转轮王 · 终审");
  });

  it("does NOT open when E is typed into the template-name input", () => {
    renderNamed();
    const input = screen.getByPlaceholderText("Template name...");
    input.focus();

    fireEvent.keyDown(input, { key: "e", bubbles: true });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("does NOT open on Cmd+E, Ctrl+E or Alt+E", () => {
    renderNamed();
    for (const modifier of ["metaKey", "ctrlKey", "altKey"] as const) {
      fireEvent.keyDown(wrapperFor("A"), { key: "e", [modifier]: true, bubbles: true });
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    }
    // The same press without a modifier does open it — otherwise this test
    // would pass against a shortcut that never works at all.
    fireEvent.keyDown(wrapperFor("A"), { key: "e", bubbles: true });
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  it("does NOT re-seed the form when E is pressed again with the modal open", () => {
    renderNamed();
    fireEvent.keyDown(wrapperFor("B"), { key: "e", bubbles: true });
    const nameField = screen.getByLabelText("Node Name");
    fireEvent.change(nameField, { target: { value: "半路改到一半" } });

    // A different node, while the form is open and dirty.
    fireEvent.keyDown(wrapperFor("A"), { key: "e", bubbles: true });

    // Without the `editModalOpen` guard this reads "秦广王 · 分流": the
    // operator's half-typed rename is silently replaced by another node's data
    // in a modal that never appeared to close.
    expect(screen.getByLabelText("Node Name")).toHaveValue("半路改到一半");
  });

  it("does nothing when E is pressed on the canvas but not on a node", () => {
    renderNamed();
    // The container the listener is bound to — the zoom Controls and the hint
    // panel live here too, and none of them is a node.
    fireEvent.keyDown(screen.getByTestId("react-flow"), { key: "e", bubbles: true });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("re-announces a node under its new name after it is renamed", async () => {
    // Why the accessible name is derived at render and not written into the
    // node when the graph is built: `updateNodeData` does not go through either
    // builder, so a name baked in at build time would keep announcing the old
    // one and nothing would go red.
    renderNamed();
    fireEvent.keyDown(wrapperFor("A"), { key: "e", bubbles: true });
    fireEvent.change(screen.getByLabelText("Node Name"), { target: { value: "改名后的节点" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(wrapperFor("A").getAttribute("aria-label")).toBe("改名后的节点, TRIAL, 第一殿")
    );
    // Absence: the old name is gone from every node, not merely absent from
    // the one that was checked.
    expect(wrappers().map((el) => el.getAttribute("aria-label"))).not.toContain(
      "秦广王 · 分流, TRIAL, 第一殿"
    );
  });
});
