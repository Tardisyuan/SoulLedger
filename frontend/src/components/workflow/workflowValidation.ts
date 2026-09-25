import type { Edge, Node } from "@xyflow/react";
import type { ConditionClause, TemplateSigner, WorkflowNodeKind } from "@soulledger/core/api";
import { clauseError, overlaps, region } from "@/src/components/workflow/workflowConditions";

/**
 * What the canvas can say about a flow before it is saved or published — the
 * client half of `backend/apps/workflow/validation.py`, same rules, same codes
 * (the codes are the last segment of `workflow.editor.issue.*`). The backend
 * runs the Python original on `POST publish/` and refuses with the same list,
 * so this decides only what the operator is shown first, never what gets in.
 *
 * TWO GATES, because there are now two buttons (design C · 03: 「! 校验 · N」
 * beside 存草稿 and 发布):
 *
 *   - SAVE_BLOCKING: a draft saved past these would store something other
 *     than what is drawn, or be refused outright — `name_empty` (the
 *     serializer's `node_name` is required, 400), `duplicate_route` (the model
 *     holds one target per outcome; the other edges vanish on save),
 *     `self_route` (an edge the engine never takes, stored as if it would be).
 *   - everything else blocks 发布 only. A half-drawn flow is a normal thing to
 *     keep as a draft; putting it into service is what has to be right.
 *
 * THE DESIGN RULES NOW APPLY. This comment used to list "a node with no exit"
 * and "a node with no approver" as deliberately NOT rules, because the model
 * had no end node and every node's exit was the order itself. Both halves of
 * that have changed: 结束 (END) and condition branches exist, and a template
 * that uses either is a GRAPH — "the branch not taken does not run" — which
 * holds only if every path is explicit. So in a graph:
 *
 *   - unreachable  no explicit edge path from the entry (first node);
 *   - no_exit      no PASS edge out, or no PASS path to any 结束;
 *   - no_end       a graph with no 结束 at all.
 *
 * A LINEAR template (no 结束, no condition) is still what it always was: the
 * engine's default PASS successor is the first PENDING node by order, so every
 * node is reached and the order is every node's exit — those three rules
 * cannot fire there and are not run. "A node with no approver" is still not a
 * rule: `_resolve_approver` falls back to SYSTEM, which `escalate` gets past
 * with an audit row; the inspector's approver preview is where the operator
 * sees who a node will actually go to.
 */

/** Which outcome an edge carries — the handle it leaves from. Unset reads as PASS, as `getTemplateNodes` reads it. */
export type Branch = "pass" | "fail";

export function branchOf(edge: Pick<Edge, "sourceHandle">): Branch {
  return edge.sourceHandle === "fail" ? "fail" : "pass";
}

/** The condition a PASS edge carries, or undefined for the default (unconditional) exit. */
export function whenOf(edge: Pick<Edge, "data">): ConditionClause[] | undefined {
  const when = (edge.data as { when?: unknown } | undefined)?.when;
  return Array.isArray(when) ? (when as ConditionClause[]) : undefined;
}

export function kindOf(node: Pick<Node, "data">): WorkflowNodeKind {
  const kind = node.data.kind;
  return kind === "COUNTERSIGN" || kind === "NOTIFY" || kind === "END" ? kind : "APPROVAL";
}

/**
 * The part a node plays in the flow. 结束 is now a KIND the operator places;
 * the other three are still DERIVED from order and edges, because `NodeType`
 * (TRIAL, EVALUATION, …) is a stage, not a shape.
 *
 * - entry  ▷  node_order 1, where the engine starts.
 * - branch ◇  has a FAIL route or a condition, so outcomes go different places.
 * - end    ■  a 结束 node; or, in a linear template, last by order with no PASS route.
 * - step   □  everything else.
 */
export type NodeRole = "entry" | "step" | "branch" | "end";

export const ROLE_GLYPH: Record<NodeRole, string> = {
  entry: "▷",
  step: "□",
  branch: "◇",
  end: "■",
};

/** Canvas C's palette glyphs for the kinds a node can be. */
export const KIND_GLYPH: Record<WorkflowNodeKind, string> = {
  APPROVAL: "□",
  COUNTERSIGN: "⧉",
  NOTIFY: "✉",
  END: "■",
};

export function isGraph(nodes: readonly Node[], edges: readonly Edge[]): boolean {
  return nodes.some((n) => kindOf(n) === "END") || edges.some((e) => whenOf(e) !== undefined);
}

export function nodeRoles(nodes: readonly Node[], edges: readonly Edge[]): Map<string, NodeRole> {
  const out = new Map<string, NodeRole>();
  const hasEndKind = nodes.some((n) => kindOf(n) === "END");
  nodes.forEach((n, idx) => {
    const outgoing = edges.filter((e) => e.source === n.id);
    let role: NodeRole = "step";
    if (kindOf(n) === "END") role = "end";
    else if (idx === 0) role = "entry";
    else if (outgoing.some((e) => branchOf(e) === "fail" || whenOf(e) !== undefined)) role = "branch";
    else if (!hasEndKind && idx === nodes.length - 1 && !outgoing.some((e) => branchOf(e) === "pass")) role = "end";
    out.set(n.id, role);
  });
  return out;
}

export type FlowIssueCode =
  | "name_empty"
  | "self_route"
  | "duplicate_route"
  | "reject_not_earlier"
  | "reject_and_fail_route"
  | "timeout_incomplete"
  | "timeout_role_missing"
  | "countersign_no_signers"
  | "threshold_out_of_range"
  | "end_has_exit"
  | "condition_empty"
  | "condition_invalid"
  | "condition_overlap"
  | "unreachable"
  | "no_exit"
  | "no_end";

export const SAVE_BLOCKING: ReadonlySet<FlowIssueCode> = new Set(["name_empty", "self_route", "duplicate_route"]);

export interface FlowIssue {
  /** "" for a template-level issue (`no_end`). */
  nodeId: string;
  code: FlowIssueCode;
  branch?: Branch;
  /** How many edges leave the same outcome (duplicate_route only). */
  count?: number;
  /** The conditional edge an issue is about (condition_* only). */
  edgeId?: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Ordered by node order, then by the order of the rules below, then the
 * template-level ones — so the list reads top-down.
 */
export function validateFlow(nodes: readonly Node[], edges: readonly Edge[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const order = new Map(nodes.map((n, idx) => [n.id, idx]));

  for (const n of nodes) {
    const label = str(n.data.label);
    if (label.trim() === "") issues.push({ nodeId: n.id, code: "name_empty" });

    const outgoing = edges.filter((e) => e.source === n.id);
    if (outgoing.some((e) => e.target === n.id)) issues.push({ nodeId: n.id, code: "self_route" });
    for (const branch of ["pass", "fail"] as const) {
      // Conditional PASS edges are branches, each its own target; only the
      // unconditional ones compete for the node's one `on_pass`.
      const count = outgoing.filter((e) => branchOf(e) === branch && whenOf(e) === undefined).length;
      if (count > 1) issues.push({ nodeId: n.id, code: "duplicate_route", branch, count });
    }

    const rejectTo = str(n.data.rejectTo);
    if (rejectTo && order.has(rejectTo) && rejectTo !== n.id) {
      if ((order.get(rejectTo) ?? 0) >= (order.get(n.id) ?? 0)) issues.push({ nodeId: n.id, code: "reject_not_earlier" });
      if (outgoing.some((e) => branchOf(e) === "fail")) issues.push({ nodeId: n.id, code: "reject_and_fail_route" });
    }

    const hours = n.data.timeoutHours;
    const action = str(n.data.timeoutAction);
    if (hours || action) {
      if (!hours || !action) issues.push({ nodeId: n.id, code: "timeout_incomplete" });
      else if (action === "ESCALATE" && !str(n.data.timeoutRole)) issues.push({ nodeId: n.id, code: "timeout_role_missing" });
    }

    const kind = kindOf(n);
    if (kind === "COUNTERSIGN") {
      const signers = (Array.isArray(n.data.signers) ? n.data.signers : []) as TemplateSigner[];
      const threshold = n.data.threshold as number | null | undefined;
      if (signers.length === 0) issues.push({ nodeId: n.id, code: "countersign_no_signers" });
      else if (threshold != null && (threshold < 1 || threshold > signers.length))
        issues.push({ nodeId: n.id, code: "threshold_out_of_range" });
    }
    if (kind === "END" && (outgoing.length > 0 || rejectTo)) issues.push({ nodeId: n.id, code: "end_has_exit" });

    const boxes: { edgeId: string; box: NonNullable<ReturnType<typeof region>> }[] = [];
    for (const e of outgoing) {
      const when = whenOf(e);
      if (when === undefined) continue;
      if (when.length === 0) {
        issues.push({ nodeId: n.id, code: "condition_empty", edgeId: e.id });
        continue;
      }
      if (when.some((c) => clauseError(c) !== null)) {
        issues.push({ nodeId: n.id, code: "condition_invalid", edgeId: e.id });
        continue;
      }
      const box = region(when);
      if (box === null) {
        issues.push({ nodeId: n.id, code: "condition_empty", edgeId: e.id });
        continue;
      }
      if (boxes.some((b) => overlaps(b.box, box))) issues.push({ nodeId: n.id, code: "condition_overlap", edgeId: e.id });
      boxes.push({ edgeId: e.id, box });
    }
  }

  issues.push(...graphIssues(nodes, edges));
  return issues;
}

function graphIssues(nodes: readonly Node[], edges: readonly Edge[]): FlowIssue[] {
  if (nodes.length === 0 || !isGraph(nodes, edges)) return [];
  const out: FlowIssue[] = [];
  const ends = new Set(nodes.filter((n) => kindOf(n) === "END").map((n) => n.id));
  const passTargets = (id: string) =>
    edges.filter((e) => e.source === id && branchOf(e) === "pass").map((e) => e.target);

  const seen = new Set<string>();
  const stack = [nodes[0].id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...edges.filter((e) => e.source === id).map((e) => e.target));
    const node = nodes.find((n) => n.id === id);
    const rejectTo = node ? str(node.data.rejectTo) : "";
    if (rejectTo) stack.push(rejectTo);
  }

  const reachesEnd = new Set(ends);
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of nodes) {
      if (!reachesEnd.has(n.id) && passTargets(n.id).some((t) => reachesEnd.has(t))) {
        reachesEnd.add(n.id);
        changed = true;
      }
    }
  }

  for (const n of nodes) {
    if (!seen.has(n.id)) out.push({ nodeId: n.id, code: "unreachable" });
    const unconditional = edges.some((e) => e.source === n.id && branchOf(e) === "pass" && whenOf(e) === undefined);
    if (kindOf(n) !== "END" && (!unconditional || !reachesEnd.has(n.id))) out.push({ nodeId: n.id, code: "no_exit" });
  }
  if (ends.size === 0) out.push({ nodeId: "", code: "no_end" });
  return out;
}
