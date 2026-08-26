"use client";

import { Handle, Position, type NodeTypes } from "@xyflow/react";

// Custom editable node component
function EditableNodeComponent({
  data,
  selected,
}: {
  data: { label: string; nodeType: string; courtCode: string; approverRole: string; [key: string]: unknown };
  selected: boolean;
}) {
  const nodeTypeColors: Record<string, string> = {
    TRIAL: "border-[hsl(var(--color-accent))] bg-[hsl(var(--color-surface-3))]",
    EVALUATION: "border-blue-500 bg-[hsl(var(--color-surface-3))]",
    APPEAL: "border-purple-500 bg-[hsl(var(--color-surface-3))]",
    FINAL: "border-green-500 bg-[hsl(var(--color-surface-3))]",
    EXECUTION: "border-red-500 bg-[hsl(var(--color-surface-3))]",
  };

  const colorClass = nodeTypeColors[data.nodeType] || nodeTypeColors.TRIAL;

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 min-w-[180px] cursor-pointer transition-all ${
        selected ? "ring-2 ring-[hsl(var(--color-accent))] ring-offset-2 ring-offset-[hsl(var(--color-surface-2))]" : ""
      } ${colorClass}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-[hsl(var(--color-accent))]" />
      <div className="text-sm font-semibold text-[hsl(var(--color-ink))]">{data.label}</div>
      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">{data.nodeType}</div>
      {data.courtCode && (
        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">🏛 {data.courtCode}</div>
      )}
      {data.approverRole && (
        <div className="text-xs text-[hsl(var(--color-ink-subtle))]">👤 {data.approverRole}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-[hsl(var(--color-accent))]" />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  editableNode: EditableNodeComponent,
};

