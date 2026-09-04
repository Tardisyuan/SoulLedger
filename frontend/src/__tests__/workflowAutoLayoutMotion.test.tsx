/**
 * WHAT THIS FILE CAN PIN, AND WHAT IT CANNOT.
 *
 * The auto-layout transition is a GSAP Flip animation over the wrappers
 * `@xyflow/react` puts a positioning `transform` on. jsdom has no layout, so
 * every `getBoundingClientRect` here is zeroes, no `transform` is ever
 * computed, and a real Flip run would derive a zero delta and animate nothing
 * while every assertion below stayed green. **Nothing in this file is evidence
 * that anything moves.** That evidence is in
 * `e2e/workflow-auto-layout-motion.spec.ts`, which drives chromium, samples
 * one `transform` per card per animation frame, and compares where the cards
 * stop against the coordinates the save payload carries.
 *
 * What is left over is worth a file anyway, because it is the one class of
 * defect a browser CANNOT show: **how many times the animation is entered.**
 * A `Flip.from` per node, or per render, produces a screen that looks exactly
 * like a correct one — ten tweens each moving one card is indistinguishable
 * from one tween moving ten — while quietly making the in-flight `kill()` in
 * `WorkflowEditor.tsx` govern only the last card, so a second press strands
 * the other nine. So the subject here is the CALL, not the motion:
 *
 *   - one press → exactly one `getState` and one `from`, over all cards at once
 *   - a press with nothing to move → neither
 *   - loading a template → neither
 *   - `prefers-reduced-motion: reduce` → neither, and the layout still happens
 *
 * WHY A THIRD `@xyflow/react` STUB. `WorkflowEditor.test.tsx`'s stub renders
 * `{children}` and no nodes at all, so `querySelectorAll(".react-flow__node")`
 * comes back empty there and every call below would be made over nothing —
 * `Flip.getState([])` is not a claim about anything. This stub renders one
 * wrapper per node, carrying the class and `data-id` the real one carries and
 * nothing else. It is the same reason `workflowEditorEdgeRouting.test.tsx` has
 * its own: a stub exists to expose the one thing its file is about.
 *
 * THE STUB RENDERS NO TRANSFORMS, DELIBERATELY. Faking `transform` here would
 * make a Flip run look meaningful when it is not — the "test double that
 * behaves like the bug" shape. `Flip` is mocked out instead, so what is
 * asserted is unambiguously the editor's decision to call it and never the
 * library's behaviour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@xyflow/react", () => {
  const React = require("react");
  return {
    // The one difference from the sibling stubs: a wrapper per node, with the
    // class `WorkflowEditor` looks for and the `data-id` the real wrapper
    // carries. No `transform` — see the header.
    ReactFlow: ({ children, nodes }: any) => (
      <div data-testid="react-flow">
        {(nodes ?? []).map((n: any) => (
          <div key={n.id} className="react-flow__node" data-id={n.id} />
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
      return [nodes, setNodes, jest.fn()];
    },
    useEdgesState: (initial: any[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, jest.fn()];
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

const flipTimeline = { kill: jest.fn() };
const flipState = { __flipState: true };

jest.mock("gsap", () => ({ gsap: { registerPlugin: jest.fn() } }));
jest.mock("gsap/Flip", () => ({
  Flip: {
    getState: jest.fn(() => flipState),
    from: jest.fn(() => flipTimeline),
  },
}));

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
        "workflow.editor.auto_layout": "Auto layout",
        "workflow.editor.add_node": "Add Node",
        "workflow.editor.delete_selected": "Delete Selected",
        "workflow.editor.save_template": "Save Template",
        "workflow.editor.template_name_placeholder": "Template name...",
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

import { Flip } from "gsap/Flip";
import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";

const getState = Flip.getState as unknown as jest.Mock;
const from = Flip.from as unknown as jest.Mock;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/**
 * A saved template whose three nodes sit where no layout would put them, so
 * the button really does move all three. The preset path would NOT do: with no
 * `measured` sizes anywhere in jsdom, `layoutNodes` produces the same answer at
 * load and at press, nothing moves, and the editor correctly declines to
 * animate — which would make every count below zero for the wrong reason.
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

async function savedPositions() {
  const { workflowApi } = require("@soulledger/core/api");
  fireEvent.click(screen.getByText("Save Template"));
  await waitFor(() => expect(workflowApi.templates.update).toHaveBeenCalled());
  const payload = workflowApi.templates.update.mock.calls.at(-1)[1];
  return Object.fromEntries(
    payload.nodes.map((n: { id: string; position: { x: number; y: number } }) => [
      n.id,
      n.position,
    ])
  );
}

beforeEach(() => {
  const { workflowApi } = require("@soulledger/core/api");
  workflowApi.templates.update.mockClear();
  getState.mockClear();
  from.mockClear();
  flipTimeline.kill.mockClear();
});

describe("a mutation mid-travel stops the travel", () => {
  /**
   * THE DEFECT THIS PINS, WHICH SHIPPED IN `e966f15`. `.kill()` lived in
   * exactly two places — the unmount cleanup and `autoLayout` itself — while
   * four other handlers mutate the very nodes gsap is animating: `addNode`,
   * `deleteSelectedNode`, `updateNodeData` and `onConnect` each
   * `setNodes`/`setEdges` and none stopped the tween. Delete a node 200ms into
   * a travel and gsap keeps writing transforms toward the old target, on a
   * wrapper xyflow has since re-keyed or removed.
   *
   * TWO TESTS, BECAUSE THE DEFECT HAS TWO HALVES. The runtime one proves the
   * mechanism works at all; the source scan proves it was not wired into some
   * entry points and forgotten in others — which is precisely what happened,
   * and which no single runtime test can show. Only `addNode` is reachable
   * through this file's stub (selection arrives via `onNodesChange`, and edges
   * via a real drag), so a per-entry-point runtime test would mean growing the
   * stub until it is a second react-flow. The scan is the honest instrument
   * for "these four all call it".
   */
  it("adding a node kills the tween the press started", async () => {
    renderDragged();
    await screen.findByDisplayValue("dragged");

    fireEvent.click(screen.getByText("Auto layout"));
    // The tween has to exist to be killed; without this the assertion below
    // could pass on a press that never animated.
    expect(from).toHaveBeenCalledTimes(1);
    expect(flipTimeline.kill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Add Node", { exact: false }));
    expect(flipTimeline.kill).toHaveBeenCalledTimes(1);
  });

  it("does not kill anything when no travel is running", async () => {
    renderDragged();
    await screen.findByDisplayValue("dragged");

    // Absence, so the test above cannot be satisfied by a `stopLayoutTravel`
    // that fires unconditionally on every render.
    fireEvent.click(screen.getByText("Add Node", { exact: false }));
    expect(from).not.toHaveBeenCalled();
    expect(flipTimeline.kill).not.toHaveBeenCalled();
  });

  it("every handler that mutates the animated nodes stops the travel first", () => {
    const src = readFileSync(
      join(__dirname, "../components/workflow/WorkflowEditor.tsx"),
      "utf8"
    );

    // The subject list is the handlers that call `setNodes` or `setEdges`.
    // Derived from the source rather than written down, so a fifth one added
    // later joins the population instead of quietly sitting outside it.
    // Deliberately the SIMPLEST pattern that cannot miss one. A cleverer
    // version of this line — matching the arrow and its parameter list too —
    // silently skipped `getTemplateNodes`, which made the slice for the
    // handler before it run past its own end and swallow a `setNodes` that
    // belonged to its neighbour. The scan then reported a handler that does
    // not mutate as one that does. An incomplete subject list does not fail
    // loudly; it produces a confident wrong answer.
    const handlers = [...src.matchAll(/const (\w+) = useCallback\(/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThan(4);

    // Balanced-paren scan from the handler's own `useCallback(`, NOT a slice
    // to wherever the next handler happens to start. The slice version put
    // everything BETWEEN two handlers into the first one's body — including
    // the template-loading effect and its `setNodes` — so `stopLayoutTravel`,
    // which mutates nothing, was reported as a mutator that forgot to call
    // itself. The wrong answer looked exactly like a real finding.
    const bodyOf = (name: string) => {
      const decl = src.indexOf(`const ${name} = useCallback(`);
      expect(decl).toBeGreaterThan(-1);
      let i = src.indexOf("(", decl + `const ${name} = useCallback`.length);
      let depth = 0;
      for (let j = i; j < src.length; j += 1) {
        if (src[j] === "(") depth += 1;
        else if (src[j] === ")") {
          depth -= 1;
          if (depth === 0) return src.slice(i, j + 1);
        }
      }
      throw new Error(`unbalanced useCallback for ${name}`);
    };

    const mutators = handlers.filter((h) => {
      const body = bodyOf(h);
      return /\bsetNodes\(|\bsetEdges\(/.test(body);
    });
    // `autoLayout` mutates too and calls it; the others are the four that did
    // not. Naming the floor stops an empty derivation from passing quietly.
    expect(mutators).toEqual(expect.arrayContaining([
      "addNode",
      "autoLayout",
      "deleteSelectedNode",
      "updateNodeData",
      "onConnect",
    ]));

    const missing = mutators.filter((h) => !/stopLayoutTravel\(\)/.test(bodyOf(h)));
    expect(missing).toEqual([]);
  });
});

describe("the auto-layout transition is entered once per press", () => {
  it("captures once and animates once, over every card in a single call", async () => {
    renderDragged();
    await screen.findByDisplayValue("dragged");
    // The three wrappers exist; without them the editor takes its instant path
    // and this file would be asserting nothing.
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(3);

    fireEvent.click(screen.getByText("Auto layout"));

    // ONE, not three and not one-per-render. A `Flip.from` per node looks
    // identical on screen and is the defect this file exists for.
    expect(getState).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);

    // And the single call really did carry all three cards, rather than one
    // card three times or the container.
    const captured = getState.mock.calls[0][0] as HTMLElement[];
    expect(captured).toHaveLength(3);
    expect(captured.map((el) => el.getAttribute("data-id")).sort()).toEqual(["A", "B", "C"]);

    // The animation runs FROM the state that was captured — a `Flip.from` fed
    // anything else would animate from nowhere.
    expect(from.mock.calls[0][0]).toBe(getState.mock.results[0].value);
  });

  it("a second press, with nothing left to move, enters nothing", async () => {
    renderDragged();
    await screen.findByDisplayValue("dragged");

    fireEvent.click(screen.getByText("Auto layout"));
    expect(from).toHaveBeenCalledTimes(1);
    const settled = await savedPositions();

    fireEvent.click(screen.getByText("Auto layout"));

    // Absence, and not a cosmetic one. Entering Flip here would kill the tween
    // that may still be running and then animate a zero delta, which in a real
    // browser leaves the cards stranded wherever the kill caught them.
    expect(getState).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(await savedPositions()).toEqual(settled);
  });

  it("loading a template enters nothing", async () => {
    renderDragged();
    await screen.findByDisplayValue("dragged");

    // The load path lays out every node that has no saved position. It is not
    // the button, so it narrates nothing.
    expect(getState).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("prefers-reduced-motion", () => {
  const original = window.matchMedia;

  afterEach(() => {
    if (original) window.matchMedia = original;
    else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  function setReducedMotion(reduce: boolean) {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  it("takes the instant path, and still re-lays the canvas out", async () => {
    setReducedMotion(true);
    renderDragged();
    await screen.findByDisplayValue("dragged");

    fireEvent.click(screen.getByText("Auto layout"));

    expect(getState).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();

    // The half that stops this passing on a button that does nothing at all.
    // The preference removes the motion, not the feature.
    const after = await savedPositions();
    for (const id of ["A", "B", "C"] as const) {
      expect(after[id]).not.toEqual(DRAGGED[id]);
    }
    expect(after.B.y - after.A.y).toBe(160);
  });

  it("with the preference NOT set, the same press does animate", async () => {
    // The control. Without it, a guard that had simply broken — matching every
    // query, or throwing — would satisfy the case above and look correct.
    setReducedMotion(false);
    renderDragged();
    await screen.findByDisplayValue("dragged");

    fireEvent.click(screen.getByText("Auto layout"));

    expect(getState).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
