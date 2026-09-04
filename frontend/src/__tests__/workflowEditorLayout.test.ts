/**
 * The editor's graph has a LAYOUT, not a stack.
 *
 * WHAT IT DID BEFORE. Both hydration paths placed every node at
 * `{ x: 250, y: idx * 160 }` — one column, in `node_order`, whatever shape the
 * template actually had. `on_pass` / `on_fail` had already made the graph
 * genuinely branch (see `workflowRoutingRoundTrip.test.ts`), so a two-way
 * decision was drawn as two nodes stacked one above the other with an edge
 * doubling back. The routing was correct and unreadable.
 *
 * WHAT IS ASSERTED HERE, AND WHAT DELIBERATELY IS NOT. Every assertion in this
 * file is a RELATION — same column, opposite sides, below everything,
 * unchanged. Not one pins a coordinate dagre computed, because a version bump
 * that shifts a graph by a few pixels is not a regression and a test that goes
 * red for it teaches the next person to delete it. The two exact numbers that
 * do appear (`160`, and the stored `{ x: 40, y: 900 }`) are ours, not dagre's:
 * 160 is the pitch this layout was tuned to reproduce, and 900 is a value the
 * layout must never be allowed to compute.
 */
import {
  appendPosition,
  layoutNodes,
  presetTemplateToFlow,
  savedTemplateToFlow,
  type TemplateNode,
} from "@/src/components/workflow/workflowEditorGraph";
import type { Edge, Node } from "@xyflow/react";

const base = (over: Partial<TemplateNode> & { id: string; node_order: number }): TemplateNode => ({
  node_name: `节点 ${over.node_order}`,
  node_type: "TRIAL",
  court_code: "",
  approver_role: "",
  approver_type: "ROLE",
  ...over,
});

const byId = (nodes: Node[]) => new Map(nodes.map((n) => [n.id, n.position]));

/** Horizontal centre of a default-width card. Every node in the cases below is
 *  one, so this is `position.x + 90`; it is written out because "which side of
 *  its parent is this node on" is a claim about centres, and a reader should
 *  not have to re-derive that corners happen to give the same answer here. */
const centreX = (n: Node) => n.position.x + 180 / 2;

describe("a branch is drawn as a branch", () => {
  // 秦广王 decides; a pass goes one way and a refusal the other, and the two
  // outcomes rejoin at the final node.
  const rows: TemplateNode[] = [
    base({ id: "decide", node_order: 1, on_pass: "pass", on_fail: "fail" }),
    base({ id: "pass", node_order: 2, on_pass: "final" }),
    base({ id: "fail", node_order: 3, on_pass: "final" }),
    base({ id: "final", node_order: 4, node_type: "FINAL" }),
  ];

  it("puts the two outcomes on OPPOSITE sides of the node they leave", () => {
    const { nodes } = savedTemplateToFlow(rows);
    const at = (id: string) => nodes.find((n) => n.id === id)!;

    const offsets = [at("pass"), at("fail")].map((n) => centreX(n) - centreX(at("decide")));
    // One negative, one positive. `Math.sign` rather than the raw numbers:
    // which branch goes left is dagre's business, that they are not on the
    // same side is ours.
    expect(offsets.map(Math.sign).sort()).toEqual([-1, 1]);
  });

  it("does not stack them, which is the whole defect", () => {
    // Absence. The old fallback gave the two outcomes the SAME x and
    // consecutive y — an assertion that only checked "they have different
    // positions" would have passed on it.
    const { nodes } = savedTemplateToFlow(rows);
    const pass = nodes.find((n) => n.id === "pass")!;
    const fail = nodes.find((n) => n.id === "fail")!;
    expect(pass.position.x).not.toBe(fail.position.x);
    expect(pass.position.y).toBe(fail.position.y);
  });

  it("puts the node both outcomes rejoin at below both of them", () => {
    const { nodes } = savedTemplateToFlow(rows);
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect(at("final").position.y).toBeGreaterThan(at("pass").position.y);
    expect(at("final").position.y).toBeGreaterThan(at("fail").position.y);
  });
});

describe("a plain chain is not made worse than the column it replaces", () => {
  const rows: TemplateNode[] = [
    base({ id: "a", node_order: 1 }),
    base({ id: "b", node_order: 2 }),
    base({ id: "c", node_order: 3 }),
  ];

  it("stays in ONE column", () => {
    const { nodes } = savedTemplateToFlow(rows);
    expect(new Set(nodes.map((n) => n.position.x)).size).toBe(1);
  });

  it("keeps the 160px pitch the stack had, to the pixel", () => {
    // `ranksep: 50` was picked for this: 110 (the measured card height) + 50.
    // The number is load-bearing rather than incidental — it is the reason the
    // common case reads identically before and after.
    const ys = savedTemplateToFlow(rows).nodes.map((n) => n.position.y);
    expect(ys.map((y) => y - ys[0])).toEqual([0, 160, 320]);
  });

  it("holds for a preset too, which has no stored positions at all", () => {
    const { nodes } = presetTemplateToFlow([
      { id: "a", node_name: "一", node_order: 1 },
      { id: "b", node_name: "二", node_order: 2 },
    ]);
    expect(new Set(nodes.map((n) => n.position.x)).size).toBe(1);
    expect(nodes[1].position.y - nodes[0].position.y).toBe(160);
  });
});

describe("a stored position is never overwritten on load", () => {
  it("leaves EVERY stored coordinate exactly as it was", () => {
    // The arrangement below is deliberately one no layout would produce:
    // out of order, overlapping ranks, and a node parked far down the canvas.
    // If anything in the load path re-ran the layout over it, at least one of
    // these numbers would move.
    const stored: Record<string, { x: number; y: number }> = {
      a: { x: 40, y: 900 },
      b: { x: 900, y: 40 },
      c: { x: 0, y: 0 },
    };
    const rows: TemplateNode[] = [
      base({ id: "a", node_order: 1, on_pass: "b", on_fail: "c", position: stored.a }),
      base({ id: "b", node_order: 2, position: stored.b }),
      base({ id: "c", node_order: 3, position: stored.c }),
    ];

    const positions = byId(savedTemplateToFlow(rows).nodes);
    expect(positions.get("a")).toEqual(stored.a);
    expect(positions.get("b")).toEqual(stored.b);
    // `{ x: 0, y: 0 }` is the placeholder the un-stored branch also uses, so
    // this one is the case a "did it change?" check cannot tell apart from a
    // layout run. It is here because the origin is a real corner of a real
    // canvas and an operator may genuinely have dragged a node there.
    expect(positions.get("c")).toEqual(stored.c);
  });

  it("lays out only the node that has none, when a template is half-placed", () => {
    const rows: TemplateNode[] = [
      base({ id: "a", node_order: 1, position: { x: 40, y: 900 } }),
      base({ id: "b", node_order: 2 }),
    ];
    const positions = byId(savedTemplateToFlow(rows).nodes);

    expect(positions.get("a")).toEqual({ x: 40, y: 900 });
    // `b` is placed by the layout — which is NOT the same claim as "b moved":
    // it must not be left at the `{ 0, 0 }` placeholder by accident, and it
    // must not land on the old `{ x: 250 }` column either.
    expect(positions.get("b")).toEqual({ x: 0, y: 160 });
  });
});

describe("layoutNodes with nothing pinned — what the button calls", () => {
  const nodes: Node[] = [
    { id: "a", position: { x: 40, y: 900 }, data: {} },
    { id: "b", position: { x: 900, y: 40 }, data: {} },
  ];
  const edges: Edge[] = [{ id: "e", source: "a", target: "b" }];

  it("moves nodes that already have a position", () => {
    const out = layoutNodes(nodes, edges);
    expect(out.map((n) => n.position)).not.toEqual(nodes.map((n) => n.position));
    expect(out[0].position.x).toBe(out[1].position.x);
    expect(out[1].position.y - out[0].position.y).toBe(160);
  });

  it("respects a node's real measured size rather than the 180×110 default", () => {
    // A card with a long name measures 361 wide in a real browser. Laying it
    // out as if it were 180 is what puts it on top of its neighbour.
    //
    // THE FIRST VERSION OF THIS TEST WAS WORTHLESS and is worth recording:
    // it asserted `centreX(a) - a.position.x === 180.5`, where the helper's
    // own `n.measured?.width ?? 180` supplied the 361. Deleting `measured`
    // from `sizeOf` — the exact defect — left it GREEN, because both sides of
    // the comparison came from the fixture rather than from the layout.
    //
    // What is actually observable is the placement: a node dagre knows to be
    // 361 wide is set down further LEFT than a 180-wide one would be, because
    // its centre still has to land between its two children.
    const measured: Node[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {}, measured: { width: 361, height: 110 } },
      { id: "b", position: { x: 0, y: 0 }, data: {} },
      { id: "c", position: { x: 0, y: 0 }, data: {} },
    ];
    const branch: Edge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "a", target: "c" },
    ];
    const unmeasured: Node[] = measured.map(({ measured: _drop, ...rest }) => rest as Node);

    const xOf = (nodes: Node[]) => layoutNodes(nodes, branch).find((n) => n.id === "a")!.position.x;
    expect(xOf(measured)).toBeLessThan(xOf(unmeasured));
    // By about half the extra width — the amount that keeps the two centres in
    // the same place. `>=` and a floor rather than an equality, because the
    // positions are rounded to whole pixels on the way out.
    expect(xOf(unmeasured) - xOf(measured)).toBeGreaterThanOrEqual(Math.floor((361 - 180) / 2));
    // The children are where they were either way: this is about the card, not
    // about the shape of the graph.
    const children = (nodes: Node[]) =>
      layoutNodes(nodes, branch)
        .filter((n) => n.id !== "a")
        .map((n) => n.position);
    expect(children(measured)).toEqual(children(unmeasured));
  });

  it("survives an edge pointing at a node that is not on the canvas", () => {
    const out = layoutNodes(nodes, [...edges, { id: "x", source: "a", target: "ghost" }]);
    expect(out).toHaveLength(2);
    expect(out[1].position.y - out[0].position.y).toBe(160);
  });

  it("returns an empty canvas unchanged", () => {
    expect(layoutNodes([], [])).toEqual([]);
  });
});

describe("a newly added node lands below the graph, not on top of it", () => {
  it("clears the LOWEST node, not the last one in the array", () => {
    // The array order is `node_order`, and a branch puts two nodes at the same
    // rank — so "the last one" and "the lowest one" are different nodes as
    // soon as the graph is not a chain. The formula this replaces used the
    // count times 160, which is neither.
    const nodes: Node[] = [
      { id: "a", position: { x: 100, y: 0 }, data: {} },
      { id: "deep", position: { x: 300, y: 640 }, data: {} },
      { id: "last", position: { x: 500, y: 160 }, data: {} },
    ];
    const at = appendPosition(nodes);
    expect(at.y).toBeGreaterThan(640 + 110);
    // In the column of the node it will be chained from — `addNode` draws the
    // edge from the last node in the array.
    expect(at.x).toBe(500);
  });

  it("starts at the origin on an empty canvas", () => {
    expect(appendPosition([])).toEqual({ x: 0, y: 0 });
  });
});
