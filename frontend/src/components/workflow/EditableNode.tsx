"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  type EdgeProps,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { useI18n } from "@/src/contexts/I18nContext";
import { ROLE_GLYPH, type Branch, type NodeRole } from "@/src/components/workflow/workflowValidation";

/**
 * A workflow node on the canvas — design C · 03 「画布节点 FlowNode」.
 *
 * MEMOISED, and it is the first thing xyflow's own performance guidance asks
 * for. Nodes are real DOM elements and React Flow re-renders every custom node
 * on any viewport change unless the component is wrapped — so without this,
 * dragging one node re-rendered all of them, once per frame. `nodeTypes` is
 * already module-scope (a fresh object each render would defeat this
 * entirely), so the memo was the only piece missing.
 *
 * A square box on the canvas, 1 px block border, no fill of its own: the five
 * per-type border colours are gone, because 规范 v1 keeps colour for state and
 * the type is already printed in the header. What the header adds is the
 * mono glyph of the node's ROLE in the flow (▷ entry, □ step, ◇ branch,
 * ■ end — see `workflowValidation.ts` for why that is derived and not stored),
 * followed by the raw `NodeType` member exactly as before.
 *
 * States:
 *   - selected  → the focus ring (2 px `--color-focus`, offset 2, square).
 *   - issues    → 3 px danger inset on the left, danger border, and `!` in
 *                 place of the ordinal. Never colour alone.
 *   - dragging  → the one shadow on the canvas (规范 v1 §2.9 exception: a node
 *                 being carried is a floating thing while it is carried).
 *
 * The text lines stay the three fields `nodeAriaLabel` in `WorkflowEditor.tsx`
 * builds the accessible name from, in that order — name, type, court — plus
 * the approver, which is not in the name (it never was).
 */
type CardData = {
  label: string;
  nodeType: string;
  courtCode: string;
  approverRole: string;
  role?: NodeRole;
  ordinal?: number;
  issueCount?: number;
  [key: string]: unknown;
};

const PORT =
  "w-[7px]! h-[7px]! min-w-0! min-h-0! rounded-none! border! border-[oklch(var(--color-block))]! bg-[oklch(var(--color-canvas))]!";

function EditableNodeComponent({
  data,
  selected,
  dragging,
}: {
  data: CardData;
  selected: boolean;
  dragging?: boolean;
}) {
  const { t } = useI18n();
  const role = data.role ?? "step";
  const issues = data.issueCount ?? 0;

  return (
    <div
      data-role={role}
      data-issues={issues > 0 ? issues : undefined}
      className={`relative min-w-[180px] px-3 py-2 border bg-[oklch(var(--color-canvas))] text-[oklch(var(--color-ink))] cursor-pointer transition-[outline-color,box-shadow] duration-state ${
        issues > 0 ? "border-[oklch(var(--color-danger))]" : "border-[oklch(var(--color-block))]"
      } ${selected ? "outline-2 outline-offset-2 outline-[oklch(var(--color-focus))]" : ""} ${
        dragging ? "shadow-overlay" : ""
      }`}
    >
      {issues > 0 && (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-[oklch(var(--color-danger))]" />
      )}
      <Handle type="target" position={Position.Top} className={PORT} />
      <div className="flex justify-between gap-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        <span>
          <span aria-hidden="true" title={t(`workflow.editor.role.${role}`)}>
            {ROLE_GLYPH[role]}
          </span>{" "}
          {data.nodeType}
        </span>
        {issues > 0 ? (
          <span className="font-semibold text-[oklch(var(--color-danger))]" title={t("workflow.editor.issues", { n: String(issues) })}>
            !
          </span>
        ) : data.ordinal ? (
          <span>N{data.ordinal}</span>
        ) : null}
      </div>
      <div className="mt-0.5 text-sm font-medium whitespace-nowrap">{data.label}</div>
      {(data.courtCode || data.approverRole) && (
        <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))] whitespace-nowrap">
          {[data.courtCode, data.approverRole].filter(Boolean).join(" · ")}
        </div>
      )}
      {/* TWO source handles, not one, and the ids are the routing.
          A single handle could only ever say "next"; the engine distinguishes
          where a flow goes when this node PASSES from where it goes when it is
          REFUSED (`ApprovalNode.on_pass` / `on_fail`), and an edge has to be
          able to say which it is. `sourceHandle` is what `getTemplateNodes`
          reads back.

          Square ports, as drawn; the FAIL port is dashed because every edge
          leaving it is drawn dashed — the pair is told apart by line, not by
          colour, and by the title on hover. */}
      <Handle
        id="pass"
        type="source"
        position={Position.Bottom}
        style={{ left: "30%" }}
        className={PORT}
        title={t("workflow.editor.branch.pass")}
      />
      <Handle
        id="fail"
        type="source"
        position={Position.Bottom}
        style={{ left: "70%" }}
        className={`${PORT} border-dashed!`}
        title={t("workflow.editor.branch.fail")}
      />
    </div>
  );
}

const EditableNode = memo(EditableNodeComponent);
EditableNode.displayName = "EditableNode";

export const nodeTypes: NodeTypes = {
  editableNode: EditableNode,
};

/**
 * 「连线 Edge」: a 1 px right-angle polyline. PASS solid, FAIL dashed — the
 * FAIL route is the conditional one (an unrouted FAIL ends the flow, so a FAIL
 * edge exists only where someone chose a branch). The colour and width come
 * from `edgeArrow()` in `workflowEditorGraph.ts`, the one source for both.
 *
 * Labelled beside the LAST vertical segment, the one that drops into the
 * target, so a label never sits on the horizontal run two branches share.
 * Only branches are labelled: every FAIL edge, and a PASS edge whose source
 * also has a FAIL edge (`data.labelled`, computed in the editor). A plain
 * chain carries no words.
 */
type RouteData = { branch?: Branch; labelled?: boolean };

function RouteEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const { t } = useI18n();
  const route = (data ?? {}) as RouteData;
  const [path, , labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
  });
  const fail = route.branch === "fail";
  const y = (labelY + targetY) / 2;

  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, strokeDasharray: fail ? "4 4" : undefined }} />
      {route.labelled && (
        <EdgeLabelRenderer>
          <span
            className="absolute font-mono text-2xs text-[oklch(var(--color-ink-muted))] pointer-events-none"
            style={{ transform: `translate(0, -50%) translate(${targetX + 6}px, ${y}px)` }}
          >
            {t(fail ? "workflow.editor.branch.fail" : "workflow.editor.branch.pass")}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  route: memo(RouteEdgeComponent),
};
