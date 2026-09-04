/**
 * A branch drawn on the canvas survives the save.
 *
 * WHAT IT DID BEFORE. `getTemplateNodes` sent `node_order` and nothing else,
 * and `savedTemplateToFlow` rebuilt every graph as `chain(rows)` at
 * `{ x: 250, y: idx * 160 }`. So `onConnect` let an operator connect any two
 * nodes, and **the connection was discarded on save** — the reload produced a
 * straight vertical column whatever shape had been arranged. The canvas
 * offered a capability the model did not have.
 *
 * Three pieces had to line up for this to work, and each one alone was enough
 * to make it silently not:
 *   - `ApprovalNode.on_pass` / `on_fail` on the backend, plus the engine
 *     following them;
 *   - the three fields declared on `WorkflowTemplateNodeSerializer` — it is a
 *     `serializers.Serializer` with an explicit field list, so DRF DROPS any
 *     key it does not name;
 *   - `CARRIED_NODE_KEYS` in `node_shape.py` — `normalize_template_node`
 *     rebuilds its result from that table alone and would otherwise strip them
 *     at the next normalization.
 *
 * This file covers the frontend end: what the editor emits, and what it reads
 * back.
 */
import { savedTemplateToFlow, type TemplateNode } from "@/src/components/workflow/workflowEditorGraph";

const base = (over: Partial<TemplateNode> & { id: string; node_order: number }): TemplateNode => ({
  node_name: `节点 ${over.node_order}`,
  node_type: "TRIAL",
  court_code: "",
  approver_role: "",
  approver_type: "ROLE",
  ...over,
});

describe("a template with no routing behaves as it always did", () => {
  const rows: TemplateNode[] = [
    base({ id: "a", node_order: 1 }),
    base({ id: "b", node_order: 2 }),
    base({ id: "c", node_order: 3 }),
  ];

  it("chains consecutive nodes", () => {
    const { edges } = savedTemplateToFlow(rows);
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual(["a->b", "b->c"]);
  });

  it("stacks them, because there is no stored position to honour", () => {
    const { nodes } = savedTemplateToFlow(rows);
    expect(nodes.map((n) => n.position.y)).toEqual([0, 160, 320]);
  });
});

describe("a template that declares routing draws what it declares", () => {
  const rows: TemplateNode[] = [
    base({ id: "a", node_order: 1, on_pass: "c", on_fail: "b" }),
    base({ id: "b", node_order: 2 }),
    base({ id: "c", node_order: 3 }),
  ];

  it("draws both outcomes, labelled", () => {
    const { edges } = savedTemplateToFlow(rows);
    const drawn = edges.map((e) => `${e.source}-${String(e.label)}->${e.target}`);
    expect(drawn).toEqual(["a-通过->c", "a-否决->b"]);
  });

  it("does NOT also draw the implicit chain", () => {
    // The fallback is all-or-nothing on purpose: mixing declared edges with
    // order-derived ones would draw routes the engine will not take.
    const { edges } = savedTemplateToFlow(rows);
    expect(edges.map((e) => `${e.source}->${e.target}`)).not.toContain("b->c");
  });

  it("drops an edge into a node the template no longer defines", () => {
    // Deleting a node leaves edges into it dangling. The backend drops such an
    // edge at instantiation rather than refusing to build the workflow; the
    // canvas has to agree, or it draws a route that cannot run.
    const { edges } = savedTemplateToFlow([
      base({ id: "a", node_order: 1, on_pass: "gone", on_fail: "b" }),
      base({ id: "b", node_order: 2 }),
    ]);
    expect(edges.map((e) => e.target)).toEqual(["b"]);
  });
});

describe("stored positions are honoured", () => {
  it("uses the stored coordinates rather than the index stack", () => {
    const { nodes } = savedTemplateToFlow([
      base({ id: "a", node_order: 1, position: { x: 40, y: 900 } }),
      base({ id: "b", node_order: 2 }),
    ]);
    expect(nodes[0].position).toEqual({ x: 40, y: 900 });
    // A node with no stored position is PLACED BY THE LAYOUT, so a template
    // written before positions existed does not collapse to the origin. It
    // used to read `{ x: 250, y: 160 }` — the hand-rolled column that dagre
    // replaced. The y is unchanged, because `ranksep` was chosen to reproduce
    // that 160px pitch exactly; only the column moved, from 250 to the
    // layout's own left edge. See `workflowEditorLayout.test.ts`.
    expect(nodes[1].position).toEqual({ x: 0, y: 160 });
  });
});
