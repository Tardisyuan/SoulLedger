"use client";

import type { ApprovalWorkflow, WorkflowHistoryEntry } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";

type Translate = (key: string, params?: Record<string, string>) => string;

/**
 * 一条「选站」/「加减站」/「按默认流程走」记录的句子(W-3a 历史页签新增的两类)。加回 / 跳过为空时去掉那一半句,
 * 不写「无」。别的域的人名后端不给(`actor` 为 null),这时写那个域的名字。
 */
export function historyLine(entry: WorkflowHistoryEntry, realmName: string, t: Translate): string {
  const actor = entry.actor ?? realmName;
  const join = (names: string[]) => names.join("、");
  if (entry.kind === "default") return t("workflow.history.default", { actor, realm: realmName, reason: entry.reason });
  if (entry.kind === "picked") {
    return entry.skipped.length
      ? t("workflow.history.picked", { actor, realm: realmName, nodes: join(entry.skipped) })
      : t("workflow.history.picked_all", { actor, realm: realmName });
  }
  if (entry.restored.length && entry.skipped.length) {
    return t("workflow.history.adjusted", {
      actor,
      added: join(entry.restored),
      skipped: join(entry.skipped),
      reason: entry.reason,
    });
  }
  return entry.restored.length
    ? t("workflow.history.adjusted_added", { actor, added: join(entry.restored), reason: entry.reason })
    : t("workflow.history.adjusted_skipped", { actor, skipped: join(entry.skipped), reason: entry.reason });
}

/** 历史页签上半:选站与加减站记录,时间顺序(后端给的次序)。没有就不占位。 */
export function WorkflowSegmentHistory({ workflow }: { workflow: ApprovalWorkflow }) {
  const { t, formatDateTime } = useI18n();
  const entries = workflow.history ?? [];
  if (entries.length === 0) return null;
  const realmOf = (code: string) => workflow.segments?.find((s) => s.tenant_code === code)?.realm_name ?? "";
  return (
    <ol data-testid="segment-history">
      {entries.map((entry, i) => (
        <li key={`${entry.at}-${i}`} className="py-3 border-b border-[oklch(var(--color-rule))]">
          <p className="text-sm text-[oklch(var(--color-ink))] break-words">{historyLine(entry, realmOf(entry.realm), t)}</p>
          <p className="mt-1 font-mono text-xs text-[oklch(var(--color-ink-muted))]">{formatDateTime(entry.at)}</p>
        </li>
      ))}
    </ol>
  );
}
