"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalNode, type ApprovalWorkflow, type WorkflowSegment } from "@soulledger/core/api";
import { workflowKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DomainText } from "@/src/components/ui/DomainValue";
import { TextAreaField } from "@/src/components/ui/Field";
import { StaleSegmentNotice } from "./StaleSegmentNotice";
import { isRestorable, runningJumpSources, segmentNodes, segmentRefusalOf, segmentRefusalText, settleJumpTargets, staleOf, stationNo, type StaleSegment } from "@soulledger/core/domain/workflowSegments";
import { courtLabel } from "@soulledger/core/domain/courts";

const REASON_MAX = 1000;

/** 这一段里哪些站现在能改:当前站之后的(这一段还没开始时:全部),终审与改不回来的跳过除外。 */
export function adjustRows(workflow: ApprovalWorkflow, order: number) {
  const nodes = segmentNodes(workflow, order);
  const at = nodes.findIndex((n) => n.id === workflow.current_node);
  const past = at >= 0 ? nodes.slice(0, at) : [];
  const current = at >= 0 ? nodes[at] : null;
  const after = at >= 0 ? nodes.slice(at + 1) : nodes;
  const editable = (n: ApprovalNode) => !n.is_required && (n.status === "PENDING" || isRestorable(n));
  return { past, current, after, editable };
}

/**
 * 加减站(第四十三批 W-3b):当前站审批人 / 本殿管理员改本域这一段。勾上 = 要走,取消 = 跳过。
 *
 * 当前站与之前的站折成灰的「不能改」两行;终审勾灰「必须走」。别的站驳回时会转到的站,只要来源还要走(当前站,
 * 或之后勾着的站)也勾灰,理由写来源;勾回来源时它一并加回(后端不顺手加回,只拒 `jump_target_required`)。
 * 行尾只标这次的变化(加回 / 跳过),
 * 和底部的计数对得上。没有变化、或理由空着时「保存」不可点。带着这一段的 `version` 保存;
 * 别人刚改过就 409 `segment_changed` —— 拦下(W-5d),「看现在的选择」换成库里现在的样子。
 */
export function AdjustStationsSheet({
  workflow,
  segment,
  isOpen,
  onClose,
}: {
  workflow: ApprovalWorkflow;
  segment: WorkflowSegment;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { past, current, after, editable } = adjustRows(workflow, segment.order);
  // 能走的来源只有当前站与之后的站;之前的已经决定了,不再驳回到哪。
  const live = new Set([...after.map((n) => n.id), ...(current ? [current.id] : [])]);
  const rows = after.map((n) => ({ key: n.id, jumpSources: (n.jump_target_of ?? []).filter((s) => live.has(s.key)) }));
  const skippedNow = (on: ReadonlySet<string>) => new Set(after.filter((n) => !on.has(n.id)).map((n) => n.id));
  /** 要走的站(勾上的)。从库里来;库里的版本一变就重新从库里来(在渲染里对齐,不跟着重取覆盖正在勾的)。 */
  const [going, setGoing] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState<number | null>(null);
  if (seeded !== segment.version) {
    setSeeded(segment.version);
    setGoing(new Set(after.filter((n) => n.status !== "SKIPPED").map((n) => n.id)));
  }
  const [reason, setReason] = useState("");
  const [stale, setStale] = useState<StaleSegment | null>(null);

  const restore = after.filter((n) => n.status === "SKIPPED" && going.has(n.id)).map((n) => n.id);
  const skip = after.filter((n) => n.status !== "SKIPPED" && !going.has(n.id)).map((n) => n.id);
  const changed = restore.length + skip.length > 0;

  const save = useMutation({
    mutationFn: () =>
      workflowApi.adjust(workflow.id, {
        restore_node_ids: restore,
        skip_node_ids: skip,
        reason: reason.trim(),
        version: segment.version,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(workflowKeys.detail(workflow.id), res.data);
      showToast(t("workflow.adjust.saved"), "success");
      onClose();
    },
    onError: (error) => {
      const refusal = segmentRefusalOf(error);
      const changedBy = staleOf(refusal);
      if (changedBy) {
        setStale(changedBy);
        return;
      }
      showToast(segmentRefusalText(t, refusal) ?? t("workflow.segment.error"), "error");
    },
  });

  const toggle = (id: string) => {
    const next = new Set(going);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const skipped = settleJumpTargets(rows, skippedNow(next));
    setGoing(new Set(after.filter((n) => !skipped.has(n.id)).map((n) => n.id)));
  };
  const skippedAll = skippedNow(going);
  const sourcesOf = (id: string) => runningJumpSources(rows.find((r) => r.key === id)?.jumpSources, skippedAll);
  const lockedRow = "flex items-center justify-between gap-2 px-3 py-2 text-sm text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-line))]";

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !save.isPending && onClose()}
      title={t("workflow.adjust.title")}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span data-testid="adjust-summary" className="mr-auto text-sm text-[oklch(var(--color-ink))]">
            {t("workflow.adjust.summary", { added: String(restore.length), skipped: String(skip.length) })}
          </span>
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={save.isPending}
            disabled={!changed || !reason.trim() || stale !== null}
            onClick={() => save.mutate()}
          >
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.adjust.hint")}</p>
        {stale && (
          <StaleSegmentNotice
            stale={stale}
            onView={() => {
              setStale(null);
              void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(workflow.id) });
            }}
          />
        )}
        <ul data-testid="adjust-stations" className="border border-[oklch(var(--color-line))]">
          {past.length > 0 && (
            <li data-locked="past" className={lockedRow}>
              <span>
                {t("workflow.adjust.locked_past", {
                  range:
                    past.length === 1
                      ? String(stationNo(past[0]))
                      : `${stationNo(past[0])}–${stationNo(past[past.length - 1])}`,
                })}
              </span>
              <span className="text-xs">{t("workflow.adjust.locked")}</span>
            </li>
          )}
          {current && (
            <li data-locked="current" className={lockedRow}>
              <span>{t("workflow.adjust.locked_current", { node: `${stationNo(current)} ${current.node_name}` })}</span>
              <span className="text-xs">{t("workflow.adjust.locked")}</span>
            </li>
          )}
          {after.map((n) => {
            const sources = n.is_required ? [] : sourcesOf(n.id);
            const on = n.is_required || sources.length > 0 || going.has(n.id);
            const mark = n.status === "SKIPPED" ? (on ? "add" : null) : on ? null : "skip";
            return (
              <li
                key={n.id}
                data-station={n.id}
                data-jump-target={sources.length > 0 ? "" : undefined}
                className="border-b last:border-b-0 border-[oklch(var(--color-line))]"
              >
                <label
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${
                    on ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-subtle))]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!editable(n) || sources.length > 0}
                    onChange={() => toggle(n.id)}
                    className="h-4 w-4 shrink-0 accent-[oklch(var(--color-accent))]"
                  />
                  <span className={`min-w-0 flex-1 break-words ${on ? "" : "line-through"}`}>
                    <span className="font-mono">{stationNo(n)}</span> {n.node_name}
                    {n.court_code ? (
                      <span className="text-xs">
                        {" · "}
                        <DomainText value={courtLabel(t, n.court_code, locale)} />
                      </span>
                    ) : null}
                    {sources.length > 0 ? (
                      <span className="block text-xs text-[oklch(var(--color-ink-muted))]">
                        {t("workflow.pick.jump_target_reason", { source: sources.map((s) => s.node_name).join("、") })}
                      </span>
                    ) : null}
                  </span>
                  {/* 一并加回的目标先标「加回」,和底部计数对得上;没有变化时才标「必须走」。 */}
                  {n.is_required || (sources.length > 0 && !mark) ? (
                    <Badge tone="neutral">{t("workflow.pick.final_badge")}</Badge>
                  ) : mark ? (
                    <span data-mark={mark} className="text-xs font-medium">
                      {t(mark === "add" ? "workflow.adjust.mark_add" : "workflow.adjust.mark_skip")}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
        <TextAreaField
          label={t("workflow.adjust.reason")}
          required
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </BaseModal>
  );
}
