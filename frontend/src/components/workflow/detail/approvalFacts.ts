import type { ApprovalNode } from "@soulledger/core/api";

/** 通知 / 结束 are passed through by the engine: nobody decides them, so they are not a step (`AUTOMATIC_KINDS`). */
const AUTOMATIC = new Set(["NOTIFY", "END"]);

/**
 * 「第 k / n 步」 counted over the decision steps only -- the officer App's `facts.node.index / total`
 * (`officer_app/facts.py::workflow_facts`), not the raw `node_order`. A current node that is not itself a
 * decision step reads as the last one, as the server does. null without a current node.
 */
export function decisionStepPosition(
  nodes: Pick<ApprovalNode, "id" | "kind" | "node_order">[],
  currentId: string | null | undefined
): { k: number; n: number } | null {
  if (!currentId) return null;
  const steps = nodes
    .filter((node) => !AUTOMATIC.has(node.kind ?? "APPROVAL"))
    .sort((a, b) => a.node_order - b.node_order);
  const at = steps.findIndex((node) => node.id === currentId);
  return { k: at >= 0 ? at + 1 : steps.length, n: steps.length };
}

/** When the current node's time runs out: `activated_at + timeout_hours` (`officer_app/facts.py::_deadline`). */
export function nodeDeadline(node: Pick<ApprovalNode, "activated_at" | "timeout_hours"> | null | undefined): string | null {
  if (!node?.timeout_hours || !node.activated_at) return null;
  const start = new Date(node.activated_at).getTime();
  return Number.isNaN(start) ? null : new Date(start + node.timeout_hours * 3_600_000).toISOString();
}

const HOUR = 3_600_000;

/**
 * 「还有 {left}」 / 「已过截止 {late}」 (第五十九批 N11): how far `deadline` is from `now`, in the largest unit that
 * still reads as a whole number -- minutes under an hour, hours under two days, else days -- rounded down
 * (「还有 23 小时」 at 23 h 40 min, never a promise of 24). The words are `common.duration.*` (第六十批 P9: 「24 小时」 /
 * 「Unut 24」, egy's unit before its number); the sentence keys say 「还有」 / 「已过」, so the duration carries no 「后」.
 */
export function deadlineDistance(
  deadline: string,
  now: number,
  t: (key: string, vars?: Record<string, string>) => string
): { overdue: boolean; text: string } {
  const ms = new Date(deadline).getTime() - now;
  const abs = Math.abs(ms);
  const [n, unit] =
    abs < HOUR ? [Math.max(1, Math.floor(abs / 60_000)), "minutes"] : abs < 48 * HOUR ? [Math.floor(abs / HOUR), "hours"] : [Math.floor(abs / (24 * HOUR)), "days"];
  return { overdue: ms < 0, text: t(`common.duration.${unit}`, { n: String(n) }) };
}

/** 第六十批 P8: the deadline line says what happens when it runs out -- one pair of keys per timeout action. */
const DEADLINE_KEYS: Record<string, { line: string; overdue: string }> = {
  ESCALATE: { line: "workflow.detail.deadline_line", overdue: "workflow.detail.deadline_overdue" },
  AUTO_REJECT: { line: "workflow.detail.deadline_line_auto_reject", overdue: "workflow.detail.deadline_overdue_auto_reject" },
  NOTIFY: { line: "workflow.detail.deadline_line_notify", overdue: "workflow.detail.deadline_overdue_notify" },
};
export function deadlineKeys(action: string | null | undefined): { line: string; overdue: string } | null {
  return (action && DEADLINE_KEYS[action]) || null;
}
