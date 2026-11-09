"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { localNodeName } from "@soulledger/core/domain/localName";
import type { ApprovalNode } from "@soulledger/core/api";
import { JourneyMap } from "@/src/components/journey/JourneyMap";
import { workflowGraph } from "@/src/lib/journeyLayout";

/**
 * 实例详情的节点进度 —— Design 第二十五批 §五.3:和灵魂的行程同一个组件(`JourneyMap`),一线。
 *
 *   - 已决的节点 = 已行(实线、实心带勾);当前节点 = 现在(metal,全图唯一);其余待行。
 *     `currentNodeId` 为 null(已结案、或还没有当前节点)时没有「现在」。
 *   - 跳过的节点没走过:点线小圈,主线从它旁边连过去。
 *   - 「退回重审」画成从被退回到的那一站挂下去的点线支线,标次数(`decision_history` 的 `round`,
 *     见 journeyLayout.returnCounts)。没有退回就不画。
 *   - 末尾的终点没有对应的节点记录:它是「流程走完」这件事本身,文案用 COMPLETED 状态名;
 *     流程走完(`completed`)才算到达。
 *
 * 顺序就是传进来的顺序;调用方按 `node_order` 排好。
 */
export function WorkflowLinearPreview({
  nodes,
  currentNodeId,
  endLabel,
  label,
  completed = false,
}: {
  nodes: ApprovalNode[];
  currentNodeId: string | null;
  endLabel: string;
  label: string;
  completed?: boolean;
}) {
  const { locale, t } = useI18n();
  const graph = workflowGraph(nodes, currentNodeId, { label: endLabel, reached: completed }, {
    name: (n) => localNodeName(n, locale, t),
    returned: (n) => t("realms.journey.returned", { n: String(n) }),
  });
  const order = new Map(nodes.map((n) => [n.id, String(n.node_order)]));
  return (
    <div className="pt-3" data-testid="workflow-journey">
      <p className="font-mono text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{label}</p>
      <div className="mt-2">
        <JourneyMap
          graph={graph}
          label={label}
          plate={{ heading: t("realms.journey.now") }}
          narrow={{ road: graph.stops.filter((s) => !s.spur && s.route === "on").map((s) => s.id) }}
          stopAttrs={(s) => ({ "data-preview-chip": s.id === "end" ? "end" : order.get(s.id) })}
        />
      </div>
    </div>
  );
}
