import { MarkerType, type Edge, type Node } from "@xyflow/react";

export interface TemplateNode {
  id?: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  node_order: number;
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

/** A template loaded back from the API: snake_case fields, always present. */
export function savedTemplateToFlow(rows: TemplateNode[]): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: rows.map((n: TemplateNode, idx: number) => ({
      id: n.id || `node-${idx}`,
      type: "editableNode",
      position: { x: 250, y: idx * 160 },
      data: {
        id: n.id || `node-${idx}`,
        label: n.node_name,
        nodeType: n.node_type,
        courtCode: n.court_code || "",
        approverRole: n.approver_role || "",
        approverType: n.approver_type,
      },
    })),
    edges: chain(rows),
  };
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
  return {
    nodes: rows.map((n: Record<string, unknown>, idx: number) => ({
      id: (n.id as string) || `node-${idx}`,
      type: "editableNode",
      position: { x: 250, y: idx * 160 },
      data: {
        id: n.id || `node-${idx}`,
        label: n.node_name || n.label || "",
        nodeType: n.node_type || n.nodeType || "TRIAL",
        courtCode: n.court_code || n.courtCode || "",
        approverRole: n.approver_role || n.approverRole || "",
        approverType: n.approver_type || n.approverType || "ROLE",
      },
    })),
    edges: chain(rows),
  };
}
