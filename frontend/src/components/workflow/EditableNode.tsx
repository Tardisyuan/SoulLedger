"use client";

import { memo } from "react";
import { Handle, Position, type NodeTypes } from "@xyflow/react";
import { Landmark, User } from "lucide-react";

/**
 * A workflow node on the canvas.
 *
 * MEMOISED, and it is the first thing xyflow's own performance guidance asks
 * for. Nodes are real DOM elements and React Flow re-renders every custom node
 * on any viewport change unless the component is wrapped — so without this,
 * dragging one node re-rendered all of them, once per frame. `nodeTypes` is
 * already module-scope (a fresh object each render would defeat this
 * entirely), so the memo was the only piece missing. Today's templates are
 * small enough that nobody would notice; this is the cliff, not the fire.
 *
 * The five type colours were `border-blue-500` / `-purple-500` / `-green-500`
 * / `-red-500` — raw palette, one fixed value for both themes, on a canvas
 * whose surfaces do change. They are status tokens now, chosen for meaning
 * rather than for looking different: evaluation is informational, appeal is a
 * caution, final is a success, execution is the irreversible one.
 */
function EditableNodeComponent({
  data,
  selected,
}: {
  data: { label: string; nodeType: string; courtCode: string; approverRole: string; [key: string]: unknown };
  selected: boolean;
}) {
  const nodeTypeColors: Record<string, string> = {
    TRIAL: "border-[hsl(var(--color-accent))] bg-[hsl(var(--color-surface-3))]",
    EVALUATION: "border-[hsl(var(--color-status-info))] bg-[hsl(var(--color-surface-3))]",
    APPEAL: "border-[hsl(var(--color-status-warning))] bg-[hsl(var(--color-surface-3))]",
    FINAL: "border-[hsl(var(--color-status-success))] bg-[hsl(var(--color-surface-3))]",
    EXECUTION: "border-[hsl(var(--color-status-error))] bg-[hsl(var(--color-surface-3))]",
  };

  const colorClass = nodeTypeColors[data.nodeType] || nodeTypeColors.TRIAL;

  return (
    <div
      className={`px-4 py-3 border-2 min-w-[180px] cursor-pointer transition-colors ${
        selected ? "ring-2 ring-[hsl(var(--color-accent))] ring-offset-2 ring-offset-[hsl(var(--color-surface-2))]" : ""
      } ${colorClass}`}
    >
      <Handle type="target" position={Position.Top} className="bg-[hsl(var(--color-accent))]!" />
      <div className="text-03 font-semibold text-[hsl(var(--color-ink))]">{data.label}</div>
      <div className="text-02 text-[hsl(var(--color-ink-muted))] mt-1">{data.nodeType}</div>
      {data.courtCode && (
        <div className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1 flex items-center gap-1">
          <Landmark aria-hidden="true" className="w-3 h-3" />
          {data.courtCode}
        </div>
      )}
      {data.approverRole && (
        <div className="text-02 text-[hsl(var(--color-ink-subtle))] flex items-center gap-1">
          <User aria-hidden="true" className="w-3 h-3" />
          {data.approverRole}
        </div>
      )}
      {/* TWO source handles, not one, and the ids are the routing.
          A single handle could only ever say "next"; the engine now
          distinguishes where a flow goes when this node PASSES from where it
          goes when it is REFUSED (`ApprovalNode.on_pass` / `on_fail`), and an
          edge has to be able to say which it is. `sourceHandle` is what
          `getTemplateNodes` reads back — without the ids a drawn branch could
          be persisted but not told apart, which is the "stored but meaningless"
          shape this whole feature exists to remove.

          Side by side on the same edge of the node, so neither reads as "the
          default one", and coloured from the status tokens so the pair is
          legible before anyone hovers. */}
      <Handle
        id="pass"
        type="source"
        position={Position.Bottom}
        style={{ left: "30%" }}
        className="bg-[hsl(var(--color-status-success))]!"
        title="通过"
      />
      <Handle
        id="fail"
        type="source"
        position={Position.Bottom}
        style={{ left: "70%" }}
        className="bg-[hsl(var(--color-status-error))]!"
        title="否决"
      />
    </div>
  );
}

const EditableNode = memo(EditableNodeComponent);
EditableNode.displayName = "EditableNode";

export const nodeTypes: NodeTypes = {
  editableNode: EditableNode,
};

