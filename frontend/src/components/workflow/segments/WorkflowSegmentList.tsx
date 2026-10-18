"use client";

import { useState } from "react";
import type { ApprovalNode, ApprovalWorkflow, WorkflowSegment } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { PickStationsSheet } from "./PickStationsSheet";
import { AdjustStationsSheet } from "./AdjustStationsSheet";
import { adjustableSegment, circled, segmentNodes, stationNo } from "@soulledger/core/domain/workflowSegments";

/** 两种跳过同一个符号 ⤼,文字区分(Design W-3a)。 */
const SKIP_KEY: Record<string, string> = {
  AT_PICK: "workflow.node_state.skipped_at_pick",
  LATER: "workflow.node_state.skipped_later",
};

/** 一站的样子:字形 + 文字。当前 ◇、待走 ·、已通过 ✓、已驳回 ✕、跳过 ⤼。状态名走 `DomainEnum`(它自己带 title)。 */
function nodeState(node: ApprovalNode, isCurrent: boolean, t: (key: string, p?: Record<string, string>) => string) {
  const status = <DomainEnum namespace="workflow.status" value={node.status} />;
  if (isCurrent) return { glyph: "◇", text: t("workflow.detail.current"), skipped: false };
  if (node.status === "SKIPPED") {
    const key = SKIP_KEY[node.skip_kind ?? ""];
    return { glyph: "⤼", text: key ? <span title={node.skip_kind ?? undefined}>{t(key)}</span> : status, skipped: true };
  }
  if (node.status === "PENDING") return { glyph: "·", text: t("workflow.detail.not_reached"), skipped: false };
  return {
    glyph: node.status === "REJECTED" || node.verdict === "FAILED" || node.verdict === "REJECTED" ? "✕" : "✓",
    text: status,
    skipped: false,
  };
}

/**
 * 流程详情左栏「节点」,按域分段(第四十三批 W-3a,替换没有分段时的那张平铺列表)。
 *
 * 每一域一个分段头:序号 + 域名 +「要走 / 默认」站数;站号在段内从 1 重排。跳过的站划线、最浅,但不隐藏。
 * 还没选站的外域只占一行(在门口时写第几天)。「加减站」在标题行右侧,只对 `can_adjust` 的人显示;
 * 本域能选站的段给「选站」/「改选」。
 */
export function WorkflowSegmentList({ workflow, myTenant }: { workflow: ApprovalWorkflow; myTenant: string | null }) {
  const { t } = useI18n();
  const [adjusting, setAdjusting] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const segments = [...(workflow.segments ?? [])].sort((a, b) => a.order - b.order);
  const running = workflow.status !== "COMPLETED" && workflow.status !== "REJECTED";
  const adjustable = workflow.can_adjust && running ? adjustableSegment(workflow, myTenant) : null;
  const stationCount = segments.reduce((sum, s) => sum + s.total, 0);

  const segmentMeta = (s: WorkflowSegment) =>
    s.state === "AWAITING_PICK"
      ? t("workflow.segment.not_picked")
      : s.state === "DONE"
        ? t("workflow.segment.done")
        : t("workflow.segment.count", { go: String(s.go), total: String(s.total) });

  return (
    <div data-testid="workflow-segments">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[oklch(var(--color-line))] text-xs text-[oklch(var(--color-ink-muted))]">
        <span className="font-mono">
          {segments.length} · {stationCount}
        </span>
        {adjustable && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setAdjusting(true)}>
            {t("workflow.adjust.open")}
          </Button>
        )}
      </div>
      {segments.map((s) => {
        const nodes = segmentNodes(workflow, s.order);
        const pickable = s.can_pick && (s.state === "AWAITING_PICK" || s.state === "PICKED");
        return (
          <section key={s.order} data-segment={s.order} aria-label={s.realm_name}>
            <header className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 bg-[oklch(var(--color-surface-2))] border-b border-[oklch(var(--color-line))]">
              <span className="text-sm font-medium text-[oklch(var(--color-ink))]">
                <span aria-hidden="true">{circled(s.order)} </span>
                {/* 「本域」是读的人自己的域(外域判官看到的第 1 段不是他的本域)。 */}
                {s.tenant_code === myTenant ? `${t("workflow.segment.local")} · ` : ""}
                {s.realm_name}
              </span>
              <span className="ml-auto text-xs text-[oklch(var(--color-ink-muted))]">{segmentMeta(s)}</span>
              {s.at_gate && <span className="w-full text-xs font-medium text-[oklch(var(--color-ink))]">{t("workflow.gate.stopped_here")}</span>}
            </header>
            {s.state === "AWAITING_PICK" ? (
              <p data-awaiting-pick="" className="flex items-center gap-2 px-3 py-3 text-sm text-[oklch(var(--color-ink-muted))] border-b border-[oklch(var(--color-line))]">
                <span aria-hidden="true">◌</span>
                <span className="min-w-0 flex-1">
                  {s.at_gate && s.gate_days != null
                    ? t("workflow.gate.waiting_title", { realm: s.realm_name, n: String(s.gate_days) })
                    : t("workflow.node_state.awaiting_pick", { n: String(s.default_node_count) })}
                </span>
                {pickable && (
                  <Button type="button" size="sm" variant="primary" onClick={() => setPicking(s.order)}>
                    {t("workflow.pick_group.action")}
                  </Button>
                )}
              </p>
            ) : (
              <ol>
                {nodes.map((node) => {
                  const isCurrent = workflow.current_node === node.id && running;
                  const state = nodeState(node, isCurrent, t);
                  return (
                    <li
                      key={node.id}
                      data-node-state={state.skipped ? "skipped" : isCurrent ? "current" : undefined}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2 border-b border-[oklch(var(--color-line))] ${
                        isCurrent
                          ? "bg-[oklch(var(--color-ink)/0.07)] font-medium text-[oklch(var(--color-ink))]"
                          : state.skipped
                            ? "text-[oklch(var(--color-ink-subtle))]"
                            : "text-[oklch(var(--color-ink-muted))]"
                      }`}
                    >
                      <span aria-hidden="true" className="text-center">{state.glyph}</span>
                      <span className="min-w-0 text-sm">
                        <span className={state.skipped ? "line-through" : undefined}>
                          <span className="font-mono">{stationNo(node)}</span> {node.node_name}
                        </span>
                        {node.court_code ? (
                          <span className="text-xs font-normal">
                            {" · "}
                            <DomainText value={node.court_code} />
                          </span>
                        ) : null}
                        {state.skipped && node.skip_reason ? (
                          <span className="block text-xs font-normal text-[oklch(var(--color-ink-muted))] break-words">{node.skip_reason}</span>
                        ) : null}
                      </span>
                      <span className="text-xs font-normal text-right">
                        {state.text}
                        {node.is_required ? ` · ${t("workflow.pick.final_badge")}` : ""}
                      </span>
                    </li>
                  );
                })}
                {pickable && (
                  <li className="px-3 py-2 border-b border-[oklch(var(--color-line))]">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(s.order)}>
                      {t("workflow.pick.repick")}
                    </Button>
                  </li>
                )}
              </ol>
            )}
          </section>
        );
      })}
      <p className="px-3 py-2 text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-subtle))]">{t("workflow.legend")}</p>
      {adjusting && adjustable && (
        <AdjustStationsSheet workflow={workflow} segment={adjustable} isOpen onClose={() => setAdjusting(false)} />
      )}
      {picking !== null && (
        <PickStationsSheet workflowId={workflow.id} order={picking} isOpen onClose={() => setPicking(null)} />
      )}
    </div>
  );
}
