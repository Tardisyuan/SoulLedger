"use client";

import { type ApprovalNode } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { Badge } from "@/src/components/ui/Badge";
import { EmptyState } from "@/src/components/ui/EmptyState";

/**
 * /workflow/[id] 的「历史」页签面板。原先长在 app/workflow/[id]/page.tsx 的
 * return 里，那个文件越过仓库 500 行的上限之后搬到这里；标记逐字未改，只把页面里的
 * `sortedNodes` 换成 prop `nodes`、`VERDICT_COLORS` 换成 prop `verdictColors`。
 *
 * 那张色表本身**没有**跟着搬：src/__tests__/statusTokenLayering.test.ts
 * 用 `app/workflow/[id]/page.tsx::VERDICT_COLORS` 这个字符串登记它（连同「为什么
 * 还没搬到 verdict 色板」的理由），换个文件就是把那条记录变哑。所以那张表留在
 * 页面里，这里只收它。
 *
 * 切页签的那条 tab 条也留在页面 body 里，不在 PageShell 的 `tabs` 槽 —— 理由写在
 * 页面里那条注释上，别顺手"修正"。
 */
export function WorkflowNodeHistory({
  nodes,
  verdictColors,
}: {
  nodes: ApprovalNode[];
  verdictColors: Record<string, string>;
}) {
  const { t, formatDateTime } = useI18n();

  return (
    <div className="space-y-3">
      {nodes
        .filter((n) => n.status !== "PENDING")
        .sort((a, b) => {
          const aTime = a.decided_at ? new Date(a.decided_at).getTime() : 0;
          const bTime = b.decided_at ? new Date(b.decided_at).getTime() : 0;
          return aTime - bTime;
        })
        .map((node) => (
          <div key={node.id} className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-03 font-medium text-[hsl(var(--color-ink))]">{node.node_name}</span>
              {/* <DomainEnum> sets its own `title` from the raw member —
                  that is the whole point of the component — so this one
                  needs no hand-rolled attribute, unlike the string-form
                  badge in the Nodes tab above. It nests inside Badge for
                  the same reason the status badge does. */}
              <Badge className={verdictColors[node.verdict ?? ""] || ""}>
                <DomainEnum namespace="workflow.verdicts" value={node.verdict} />
              </Badge>
            </div>
            <div className="text-02 text-[hsl(var(--color-ink-muted))]">
              {t("workflow.detail.decided_at")}: <DomainText value={node.decided_at ? formatDateTime(node.decided_at) : null} />
            </div>
            {node.notes && (
              <p className="text-03 text-[hsl(var(--color-ink-muted))] mt-2 italic">&ldquo;{node.notes}&rdquo;</p>
            )}
            {node.approver != null && (
              <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">
                {t("workflow.detail.approver")}:{" "}
                {/* `MissingValue`, not the raw `node.approver` value. That field is
                    the deciding user's integer primary key: `ApprovalNodeSerializer`
                    sends `approver` and **no** `approver_name` — unlike
                    `DispatchRecordSerializer`, which carries `dispatched_by_name`
                    beside the pk. So there is no name to show here, and printing
                    the pk is IDENTIFIER_POLICY clause 4.
                
                    The line is kept rather than hidden because "decided by someone
                    we cannot name" and "not decided" are different facts; the
                    tooltip says which one this is.
                
                    NOTE THE SPELLING: this comment says `node.approver` without
                    braces on purpose. Rule 3 of domainDisplayContract scans line by
                    line and `stripComment` only removes `//` — a JSX block comment
                    survives it, so writing the braced form here would be reported
                    as the very render this comment says was removed. Prose read as
                    code, the trap this repository keeps re-finding.
                
                    THE REAL FIX IS ON THE BACKEND — an `approver_name` field
                    mirroring `dispatched_by_name`. Out of scope for this
                    frontend-only change; recorded here and in the tooltip so it is
                    not lost. */}
                <MissingValue kind="unrecorded" reason={t("workflow.detail.approver_name_absent")} />
              </p>
            )}
          </div>
        ))}
      {nodes.filter((n) => n.status !== "PENDING").length === 0 && (
        /* Was a centred `py-8` (32px — not a step on the ladder) div.
           EmptyState is left-aligned by design: "nothing has been decided
           yet" is a note in the file, not a poster. */
        <EmptyState title={t("workflow.detail.no_history")} />
      )}
    </div>
  );
}
