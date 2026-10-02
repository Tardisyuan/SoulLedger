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
import { KIND_GLYPH, ROLE_GLYPH, type Branch, type NodeRole } from "@/src/components/workflow/workflowValidation";

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
 * v3 A1: 168 × 60 on surface-1, 1 px line-strong, padding 8/10. Two lines:
 * the node's ROLE in the flow (▷ entry, □ step, ◇ branch, ■ end — derived, see
 * `workflowValidation.ts`) with the court / timeout or 会签 threshold in mono at
 * the right; then the KIND glyph and the name.
 *
 * States — none of them in the civilization colour (用户 10-02: the canvas is ink):
 *   - selected  → 2 px ink outline, offset 2.
 *   - issues    → danger border and a danger `!` at the end of the name line.
 *                 Never colour alone.
 *   - dragging  → the one shadow on the canvas: a node being carried is a
 *                 floating thing while it is carried.
 *
 * The raw `NodeType` member is no longer printed on the card (v3 shows the
 * role there); it stays in the accessible name `nodeAriaLabel` builds and in
 * the inspector's 节点 tab.
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
  const kind = data.kind === "COUNTERSIGN" || data.kind === "NOTIFY" || data.kind === "END" ? data.kind : "APPROVAL";
  const signers = Array.isArray(data.signers) ? data.signers.length : 0;
  const threshold = typeof data.threshold === "number" ? data.threshold : signers;
  const hours = typeof data.timeoutHours === "number" && data.timeoutHours > 0 ? `${data.timeoutHours}h` : "";
  // 右上等宽小字:殿号 · 超时,会签换成门槛 k/n(v3 A1)。
  const meta = [data.courtCode, kind === "COUNTERSIGN" && signers > 0 ? `${threshold}/${signers}` : hours]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-role={role}
      data-issues={issues > 0 ? issues : undefined}
      className={`relative w-[168px] min-h-[60px] px-3 py-2 border bg-[oklch(var(--color-surface-1))] text-[oklch(var(--color-ink))] cursor-pointer transition-[outline-color] duration-state ${
        issues > 0 ? "border-[oklch(var(--color-danger))]" : "border-[oklch(var(--color-line-strong))]"
      } ${selected ? "outline-2 outline-offset-2 outline-[oklch(var(--color-ink))]" : ""} ${
        dragging ? "shadow-[0_2px_8px_oklch(0_0_0/0.08)]" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className={PORT} />
      {/* 第一行:角色字形 + 角色名(由连线推导),右侧等宽小字 */}
      <div className="flex justify-between gap-2 text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-muted))]">
        <span className="whitespace-nowrap">
          <span aria-hidden="true">{ROLE_GLYPH[role]}</span> {t(`workflow.editor.role.${role}`)}
        </span>
        {meta && <span className="font-mono truncate" title={meta}>{meta}</span>}
      </div>
      {/* 第二行:类型字形 + 名称;有问题时右端 `!` */}
      <div className="mt-0.5 flex justify-between gap-2 text-sm font-medium">
        <span className="truncate" title={data.label}>
          <span aria-hidden="true" title={t(`workflow.editor.kind.${kind}`)}>
            {KIND_GLYPH[kind]}
          </span>{" "}
          {data.label}
        </span>
        {issues > 0 && (
          <span className="font-semibold text-[oklch(var(--color-danger))]" title={t("workflow.editor.issues", { n: String(issues) })}>
            !
          </span>
        )}
      </div>
      {/* TWO source handles, not one, and the ids are the routing.
          A single handle could only ever say "next"; the engine distinguishes
          where a flow goes when this node PASSES from where it goes when it is
          REFUSED (`ApprovalNode.on_pass` / `on_fail`), and an edge has to be
          able to say which it is. `sourceHandle` is what `getTemplateNodes`
          reads back.

          Square ports, as drawn; the FAIL port is dashed because every edge
          leaving it is drawn dashed — the pair is told apart by line, not by
          colour, and by the title on hover. */}
      {/* 结束 has no way out, and 通知 cannot fail — nobody decides it — so
          neither offers a port the engine would never follow. */}
      {kind !== "END" && (
        <Handle
          id="pass"
          type="source"
          position={Position.Bottom}
          style={{ left: kind === "NOTIFY" ? "50%" : "30%" }}
          className={PORT}
          title={t("workflow.editor.branch.pass")}
        />
      )}
      {kind !== "END" && kind !== "NOTIFY" && (
        <Handle
          id="fail"
          type="source"
          position={Position.Bottom}
          style={{ left: "70%" }}
          className={`${PORT} border-dashed!`}
          title={t("workflow.editor.branch.fail")}
        />
      )}
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
type RouteData = { branch?: Branch; labelled?: boolean; conditionText?: string; isDefault?: boolean; active?: boolean };

/**
 * 方向箭头:一个**内联**的 `<polygon>`,尖端落在目标端口上,填充取边自己的 stroke。
 * 不用 `markerEnd`:xyflow 把 marker 放进独立的 `<defs>` 树,`oklch(var(--…))` 在那里
 * 画不出来(p3b 遗留)。内联多边形与边同在文档 `:root` 下,var 解析、随主题实时切换。
 * 下面的角度把「底边朝上、尖朝下」的基形转到从哪一侧进入目标。
 */
const ARROW_ROTATION: Record<string, number> = {
  [Position.Top]: 0,
  [Position.Right]: 90,
  [Position.Bottom]: 180,
  [Position.Left]: 270,
};

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
  // The exit the inspector's 出口 tab is on: 2 px ink, label inverted (v3 A1).
  const stroke = route.active ? "oklch(var(--color-ink))" : style?.stroke;
  const conditional = !fail && (route.conditionText !== undefined || route.isDefault);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, stroke, strokeWidth: route.active ? 2 : style?.strokeWidth, strokeDasharray: fail ? "4 3" : undefined }}
      />
      <polygon
        data-edge-arrow=""
        points={`${targetX - 4},${targetY - 6} ${targetX + 4},${targetY - 6} ${targetX},${targetY}`}
        transform={`rotate(${ARROW_ROTATION[targetPosition] ?? 0} ${targetX} ${targetY})`}
        style={{ fill: stroke }}
      />
      {route.labelled && (
        <EdgeLabelRenderer>
          <span
            className={`absolute pointer-events-none px-1 text-2xs normal-case tracking-normal ${
              conditional
                ? `font-mono border ${
                    route.active
                      ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))] border-[oklch(var(--color-ink))]"
                      : "bg-[oklch(var(--color-surface-1))] text-[oklch(var(--color-ink-muted))] border-[oklch(var(--color-line-strong))]"
                  }`
                : "bg-[oklch(var(--color-canvas))] text-[oklch(var(--color-ink-muted))]"
            }`}
            style={{ transform: `translate(0, -50%) translate(${targetX + 6}px, ${y}px)` }}
          >
            {fail
              ? t("workflow.editor.branch.fail")
              : route.conditionText
                ? `${t("workflow.editor.condition.yes")} · ${route.conditionText}`
                : route.isDefault
                  ? `${t("workflow.editor.condition.no")} · ${t("workflow.editor.condition.default")}`
                  : t("workflow.editor.branch.pass")}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  route: memo(RouteEdgeComponent),
};
