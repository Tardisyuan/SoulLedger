import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

export interface TemplateNode {
  id?: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  node_order: number;
  /**
   * Where the flow goes after this node, by TEMPLATE-LOCAL `id`.
   *
   * Null on both — the default, and what every template written before this
   * existed carries — means the engine's original behaviour: pass advances by
   * `node_order`, refusal ends the workflow REJECTED. The backend enforces
   * that same default (`ApprovalNode.on_pass` / `on_fail`), so a template that
   * says nothing runs exactly as it did.
   *
   * Until these existed, the editor let an operator connect any two nodes and
   * then **discarded the result on save** — `getTemplateNodes` sent only
   * `node_order`, and the reload rebuilt every graph as a straight chain. The
   * canvas offered a capability the model did not have.
   */
  on_pass?: string | null;
  on_fail?: string | null;
  /**
   * Canvas coordinates. Presentational only — the engine never reads them —
   * but without them a dragged arrangement was lost on every reload, because
   * positions were recomputed as `idx * 160`: one tall column, whatever shape
   * the operator had arranged.
   */
  position?: { x: number; y: number } | null;
}

/**
 * Edges for a template, from its declared routing when it has any.
 *
 * Falls back to `chain()` — consecutive `node_order` — when no node declares a
 * route, which is every template written before routing existed. That
 * fallback mirrors the backend's own default rather than restating it: a
 * template with no edges means "advance in order" on both sides, and the two
 * would be a silent contradiction if they disagreed.
 */
function edgesFor(rows: TemplateNode[]): Edge[] {
  const declared = rows.some((n) => n.on_pass || n.on_fail);
  if (!declared) return chain(rows);

  const known = new Set(rows.map((n, idx) => String(n.id ?? `node-${idx}`)));
  const out: Edge[] = [];
  rows.forEach((n, idx) => {
    const source = String(n.id ?? `node-${idx}`);
    for (const [field, target] of [
      ["pass", n.on_pass],
      ["fail", n.on_fail],
    ] as const) {
      // An edge naming an id this template no longer defines is dropped, the
      // same way the backend drops it at instantiation. Deleting a node leaves
      // edges into it dangling, and rendering a line to nothing would be a
      // drawing of a route that cannot run.
      if (!target || !known.has(String(target))) continue;
      out.push({
        id: `e${source}-${field}-${target}`,
        source,
        target: String(target),
        label: field === "pass" ? "通过" : "否决",
        ...edgeArrow(),
      } as Edge);
    }
  });
  return out;
}

/**
 * The arrow every edge in this editor is drawn with.
 *
 * The hex is deliberate and is the reason this module has to stay under
 * `src/components/workflow/`. `markerEnd` is handed to @xyflow/react, which
 * renders it into a standalone SVG `<marker>` defs tree — `hsl(var(--…))` has
 * no custom properties to resolve against in there and the arrowheads come out
 * unpainted. `eslint.config.mjs`'s HEX_ALLOW grants the exception by PATH
 * PREFIX, so moving this file elsewhere turns the exception back into an error.
 *
 * Written once rather than three times: the two hydration paths and `onConnect`
 * used to each carry their own copy, which is three places for one colour to
 * drift in.
 */
const EDGE_ARROW = {
  markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
  style: { stroke: "#f59e0b", strokeWidth: 2 },
} as const;

export function edgeArrow() {
  return {
    markerEnd: { ...EDGE_ARROW.markerEnd },
    style: { ...EDGE_ARROW.style },
  };
}

/**
 * Chain the nodes head to tail.
 *
 * `.filter(idx > 0)` then `.map((n, idx) => rows[idx])` is not an off-by-one:
 * the filter re-bases the index, so inside the map `idx` is already the
 * position of `n`'s predecessor in the ORIGINAL array. Preserved verbatim from
 * the two copies this replaces.
 */
function chain(rows: { id?: unknown }[]): Edge[] {
  return rows
    .filter((_: unknown, idx: number) => idx > 0)
    .map((n, idx: number) => {
      const prevNode = rows[idx];
      return {
        id: `e${prevNode.id}-${n.id}`,
        source: (prevNode.id as string) || `node-${idx}`,
        target: (n.id as string) || `node-${idx + 1}`,
        ...edgeArrow(),
      } as Edge;
    });
}

/**
 * The card's size, MEASURED in a real browser rather than estimated.
 *
 * `EditableNode` declares no size — `px-4 py-3 border-2 min-w-[180px]` — so
 * the box is whatever its content makes it, and dagre needs a number per node
 * or it packs everything on top of everything else. Taken on 2026-09-04 by
 * driving /workflow → 流程编辑器 in chromium and reading `offsetWidth` /
 * `offsetHeight` off the rendered card (`getBoundingClientRect` is wrong here:
 * the react-flow viewport carries a `scale()` transform, so it reports the
 * card at whatever the current zoom is — 90×46 at 0.5):
 *
 *     180 ×  70   name + type                       (a freshly added node)
 *     180 ×  92   name + type + court               (every preset node)
 *     180 × 110   name + type + court + approver    (the full card)
 *     361 × 110   the same, with a 25-character name
 *
 * 110 is the height of the complete card, so no realistic node is TALLER than
 * what dagre is told — a too-small height is what produces overlap, and a
 * too-large one only spends space. Width is the `min-w-[180px]` floor and a
 * long name really does exceed it, which is why `sizeOf` prefers xyflow's own
 * measurement when there is one: after a render `node.measured` holds the true
 * box, and the "auto layout" button always runs against rendered nodes. The
 * two hydration paths run before any of this exists on screen, and fall back.
 *
 * Deliberately NOT fixed in `EditableNode.tsx`: pinning the card to 180×110
 * would clip or wrap operator-entered names to make an arithmetic convenience
 * true, which is a design decision about the card and not a layout one.
 */
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 110;

/**
 * `ranksep: 50` is chosen to reproduce the rhythm it replaces EXACTLY.
 *
 * dagre separates rank BOUNDARIES, so a chain's origin-to-origin pitch is
 * `NODE_HEIGHT + ranksep` = 110 + 50 = 160 — the same 160 the old
 * `{ x: 250, y: idx * 160 }` stack used, to the pixel. So the common case (a
 * template with no branches) is not merely "not worse": it lands on the same
 * y-coordinates it always did, which is why the `[0, 160, 320]` assertion in
 * `workflowRoutingRoundTrip.test.ts` still holds unchanged.
 *
 * `nodesep: 60` is the wider of the two on purpose. It is the gap between
 * SIBLINGS — the two branches of one decision — and the pass/fail edges leave
 * a node from handles at 30% and 70% of its width carrying the 通过 / 否决
 * labels between them. 60 puts siblings 240px apart origin to origin, which
 * keeps those two labels off each other; 50 would read as a tie between two
 * axes that are not doing the same job.
 */
const NODE_SEP = 60;
const RANK_SEP = 50;

function sizeOf(node: Node): { width: number; height: number } {
  return {
    // `measured` is what react-flow read off the DOM after the last render. It
    // is absent on the hydration paths (the nodes have never been on screen)
    // and present for the button, which is exactly the case where a
    // long-named 361px-wide card would otherwise be laid out as if it were
    // 180 and overlap its neighbour.
    //
    // A CONSEQUENCE WORTH KNOWING ABOUT, measured in chromium on the ten-court
    // preset: on load the pitch is 160 (110 assumed + 50), and the first press
    // of the button tightens it to 142, because those cards really are 92 tall
    // and the gutter becomes exactly 50 rather than 68. That is the button
    // doing its job — a uniform gutter whatever a card contains — and not a
    // reason to throw the real measurement away; the alternative is cards that
    // genuinely overlap.
    width: node.measured?.width ?? NODE_WIDTH,
    height: node.measured?.height ?? NODE_HEIGHT,
  };
}

/**
 * Place `nodes` by their EDGES rather than by their index.
 *
 * Top-to-bottom: a branch spreads its two outcomes left and right of the node
 * they leave, and the flow still reads downwards — the direction the cards
 * (wide and short, with the target handle on top and both source handles on
 * the bottom) were already drawn for.
 *
 * `pinned` is the whole of the "never silently move an operator's work" rule.
 * A node whose id is in that set is returned untouched, however the layout
 * would have placed it; it still takes part in the layout as far as its
 * NEIGHBOURS are concerned, because it is entered into the graph with its real
 * size, so the nodes that do get placed are placed around a graph of the right
 * shape. Callers that mean "re-arrange everything" — the button — pass nothing.
 */
/**
 * 大图上它有多慢 —— 量过了,不是估的。
 *
 * 画布审计当时的结论是「先在 100–200 节点的合成模板上量,再决定要不要改」,
 * 而没有人量过 —— 这个仓库里最大的东西是十节点预设,所以此前关于大图的每一句
 * 话都是猜的。2026-09-05 用一条每三个节点分出一个分支的合成图量(中位数,
 * 7 次取样,只计这个函数,不含它之后那次 `flushSync` 的同步渲染):
 *
 *      10 节点   12.5 ms
 *      50 节点   25.1 ms
 *     100 节点   37.6 ms
 *     200 节点   78.5 ms
 *     400 节点  157.3 ms
 *
 * 大致线性,约 0.4ms/节点。**dagre 不是瓶颈** —— 200 节点 78ms 是一次按钮
 * 点击上察觉得到但可接受的开销,而这个产品里最大的模板是 10 个节点。
 *
 * 没量的那一半写在这里而不是省略:`WorkflowEditor` 在这之后做
 * `flushSync(() => setNodes(next))`,强制同步渲染每一个节点,而
 * `onlyRenderVisibleElements` 没有传(默认 false)。那一半要在真浏览器里、
 * 用真的 200 节点模板才量得到,而这样的模板今天不存在。
 *
 * 所以结论是「先别改」,并且把数字留在这里 —— 下一个人要论证的是这些数字,
 * 而不是从零开始猜。
 */
export function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  pinned?: ReadonlySet<string>
): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: NODE_SEP, ranksep: RANK_SEP });
  // Required: without it dagre throws on the first `setEdge` that has no label.
  g.setDefaultEdgeLabel(() => ({}));

  const known = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, sizeOf(n));
  for (const e of edges) {
    // An edge to a node that is not on the canvas would make dagre invent one,
    // and the invented node would take up a rank. `edgesFor` already drops
    // dangling routes; this covers edges drawn by hand and then orphaned.
    if (known.has(e.source) && known.has(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    if (pinned?.has(n.id)) return n;
    const placed = g.node(n.id);
    if (!placed) return n;
    const { width, height } = sizeOf(n);
    return {
      ...n,
      // dagre gives CENTRES; react-flow positions are top-left. Rounded for
      // the same reason `getTemplateNodes` rounds — these are canvas pixels,
      // and unrounded floats make every save a diff even when nothing moved.
      position: {
        x: Math.round(placed.x - width / 2),
        y: Math.round(placed.y - height / 2),
      },
    };
  });
}

/**
 * Where the "+ 添加节点" button drops a node.
 *
 * NOT a layout run, and that is the point: adding a node must not re-arrange
 * the ones already on the canvas, so this cannot call `layoutNodes`. But the
 * formula it replaces — `{ x: 250, y: nodes.length * 160 + 80 }` — assumed the
 * single column that no longer exists, and would drop a new node on top of an
 * arranged graph. Below EVERYTHING (the lowest bottom edge, not the last
 * node's, because a branch puts nodes at equal ranks), in the column of the
 * node it is chained from.
 */
export function appendPosition(nodes: Node[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const lowest = Math.max(...nodes.map((n) => n.position.y + sizeOf(n).height));
  return { x: nodes[nodes.length - 1].position.x, y: Math.round(lowest + RANK_SEP) };
}

/** A template loaded back from the API: snake_case fields, always present. */
export function savedTemplateToFlow(rows: TemplateNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = rows.map((n: TemplateNode, idx: number) => ({
      id: n.id || `node-${idx}`,
      type: "editableNode",
      // The placeholder for a node that has no stored position: `layoutNodes`
      // below overwrites it, and it is never what reaches the canvas. A node
      // that DOES have one keeps it, via `pinned`.
      position: n.position ?? { x: 0, y: 0 },
      data: {
        id: n.id || `node-${idx}`,
        label: n.node_name,
        nodeType: n.node_type,
        courtCode: n.court_code || "",
        approverRole: n.approver_role || "",
        approverType: n.approver_type,
      },
  }));
  const edges = edgesFor(rows);
  // Truthiness, not `in`: the serializer sends `position: null` for a node
  // that has never been dragged, and `{ x: 0, y: 0 }` — a real corner of the
  // canvas — is truthy, so a node parked at the origin stays parked there.
  const pinned = new Set(
    nodes.filter((_, idx) => rows[idx].position).map((n) => n.id)
  );
  return { nodes: layoutNodes(nodes, edges, pinned), edges };
}

/**
 * A preset opened from the template gallery. It accepts BOTH spellings of every
 * field and falls back on each, because a preset can arrive either as this
 * repo's `src/config/workflow-templates.ts` shape or as a template already
 * saved to the backend — and it carries defaults ("TRIAL" / "ROLE") the saved
 * path does not, because a preset may legitimately omit them.
 */
export function presetTemplateToFlow(
  rows: Record<string, unknown>[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = rows.map((n: Record<string, unknown>, idx: number) => ({
      id: (n.id as string) || `node-${idx}`,
      type: "editableNode",
      // Overwritten by `layoutNodes`, unconditionally: a preset carries no
      // stored coordinates at all, so nothing here is an operator's work.
      position: { x: 0, y: 0 },
      data: {
        id: n.id || `node-${idx}`,
        label: n.node_name || n.label || "",
        nodeType: n.node_type || n.nodeType || "TRIAL",
        courtCode: n.court_code || n.courtCode || "",
        approverRole: n.approver_role || n.approverRole || "",
        approverType: n.approver_type || n.approverType || "ROLE",
      },
  }));
  const edges = chain(rows);
  return { nodes: layoutNodes(nodes, edges), edges };
}
