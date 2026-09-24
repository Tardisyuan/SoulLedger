"use client";

import type { ApprovalNode } from "@soulledger/core/api";
import { cn } from "@/lib/utils";

/**
 * 甲 之下的线性预览(Design 第三类 C「模板预览 · 线性」):节点名放进 1 px 边框的
 * 方块,用 → 连起来,末尾一个虚线的终点块。
 *
 *   - 运行中实例的当前节点:左 3 px 墨色内嵌线 + 600。`currentNodeId` 为 null
 *     (已结案、或还没有当前节点)时不标任何一块。
 *   - 条件节点(node_type CONDITION)用等宽 12 px。实例节点今天的五种类型里没有它,
 *     模板里有;写在这里是为了同一条预览放到模板上时不必改。
 *   - 出错的节点(status REJECTED)用危险色边框 —— 颜色之外,节点账里同一行
 *     还有 ✕ 字形,这里不重复。
 *   - 终点块没有对应的节点记录:它是「流程走完」这件事本身,文案用审批流的
 *     COMPLETED 状态名,不另起一个键。
 *
 * 顺序就是传进来的顺序;调用方按 `node_order` 排好。
 */
export function WorkflowLinearPreview({
  nodes,
  currentNodeId,
  endLabel,
  label,
}: {
  nodes: ApprovalNode[];
  currentNodeId: string | null;
  endLabel: string;
  label: string;
}) {
  return (
    <div className="pt-3">
      <p className="font-mono text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{label}</p>
      <ol aria-label={label} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
        {nodes.map((node) => {
          const current = node.id === currentNodeId;
          return (
            <li key={node.id} className="flex items-center gap-1.5">
              <span
                data-preview-chip={node.node_order}
                data-current={current || undefined}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "px-2 py-1 border border-[oklch(var(--color-line))] text-[oklch(var(--color-ink))]",
                  node.node_type.toUpperCase() === "CONDITION" && "font-mono text-xs",
                  node.status === "REJECTED" &&
                    "border-[oklch(var(--color-danger))] text-[oklch(var(--color-danger))]",
                  current && "font-semibold shadow-[inset_3px_0_0_oklch(var(--color-ink))]"
                )}
              >
                {node.node_name}
              </span>
              <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">→</span>
            </li>
          );
        })}
        <li>
          <span
            data-preview-chip="end"
            className="px-2 py-1 border border-dashed border-[oklch(var(--color-line))] text-[oklch(var(--color-ink-subtle))]"
          >
            {endLabel}
          </span>
        </li>
      </ol>
    </div>
  );
}
