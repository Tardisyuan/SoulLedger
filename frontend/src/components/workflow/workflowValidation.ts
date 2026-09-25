import type { Edge, Node } from "@xyflow/react";

/**
 * What the canvas can say about a flow before it is saved — and ONLY what the
 * backend or the engine would itself act on. Design C · 03 draws 「! 校验 · N」
 * beside a disabled 发布; the rules below are the subset of that idea this
 * model actually has.
 *
 * NOT a rule, on purpose:
 *   - "a node with no exit". The engine (`ApprovalWorkflow.complete_node`,
 *     backend/apps/workflow/models.py) sends an unrouted PASS to the next node
 *     by `node_order` and ends the flow on an unrouted FAIL. A node without an
 *     edge is the normal case, not an error.
 *   - "a node with no approver". `WorkflowService._resolve_approver` fills the
 *     approver from court and civilization when the template names none, so
 *     an empty role is a default, not a defect.
 *   - "the template has no name". The backend does 400 on it, but the editor's
 *     save path has always been callable with an empty form (the jest suite
 *     pins that), and the toast on a 400 already says it failed.
 */

/** Which outcome an edge carries — the handle it leaves from. Unset reads as PASS, as `getTemplateNodes` reads it. */
export type Branch = "pass" | "fail";

export function branchOf(edge: Pick<Edge, "sourceHandle">): Branch {
  return edge.sourceHandle === "fail" ? "fail" : "pass";
}

/**
 * The part a node plays in the flow, DERIVED from order and edges — the model
 * has no start / end / condition node kinds (`NodeType` is TRIAL, EVALUATION,
 * APPEAL, FINAL, EXECUTION: every node is an approval step). The glyph says
 * where the engine will enter, branch and stop; the raw `NodeType` member stays
 * beside it on the card.
 *
 * - entry  ▷  node_order 1, where `create_from_template` points `current_node`.
 * - branch ◇  has a FAIL route, so the two outcomes go different places.
 * - end    ■  last by order with no PASS route: passing it completes the flow.
 * - step   □  everything else.
 */
export type NodeRole = "entry" | "step" | "branch" | "end";

export const ROLE_GLYPH: Record<NodeRole, string> = {
  entry: "▷",
  step: "□",
  branch: "◇",
  end: "■",
};

export function nodeRoles(nodes: readonly Node[], edges: readonly Edge[]): Map<string, NodeRole> {
  const out = new Map<string, NodeRole>();
  nodes.forEach((n, idx) => {
    const outgoing = edges.filter((e) => e.source === n.id);
    let role: NodeRole = "step";
    if (idx === 0) role = "entry";
    else if (outgoing.some((e) => branchOf(e) === "fail")) role = "branch";
    else if (idx === nodes.length - 1 && !outgoing.some((e) => branchOf(e) === "pass")) role = "end";
    out.set(n.id, role);
  });
  return out;
}

export type FlowIssueCode = "name_empty" | "self_route" | "duplicate_route";

export interface FlowIssue {
  nodeId: string;
  code: FlowIssueCode;
  branch?: Branch;
  /** How many edges leave the same outcome (duplicate_route only). */
  count?: number;
}

/**
 * - name_empty: `WorkflowTemplateNodeSerializer.node_name` is a required
 *   CharField — the save 400s.
 * - self_route: the engine only follows a route into a PENDING node, and the
 *   node just decided is not one, so the edge is never taken.
 * - duplicate_route: `getTemplateNodes` keeps the LAST edge per (node,
 *   outcome), because the model holds one target. The others vanish on save.
 *
 * Ordered by node order, then by the order above, so the list reads top-down.
 */
export function validateFlow(nodes: readonly Node[], edges: readonly Edge[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  for (const n of nodes) {
    const label = typeof n.data.label === "string" ? n.data.label : "";
    if (label.trim() === "") issues.push({ nodeId: n.id, code: "name_empty" });

    const outgoing = edges.filter((e) => e.source === n.id);
    if (outgoing.some((e) => e.target === n.id)) issues.push({ nodeId: n.id, code: "self_route" });
    for (const branch of ["pass", "fail"] as const) {
      const count = outgoing.filter((e) => branchOf(e) === branch).length;
      if (count > 1) issues.push({ nodeId: n.id, code: "duplicate_route", branch, count });
    }
  }
  return issues;
}
