"use client";

import Link from "next/link";
import { type ApprovalWorkflowListItem } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Badge } from "@/src/components/ui/Badge";
import { EmptyState } from "@/src/components/ui/EmptyState";

/**
 * /workflow 的「实例」页签：审批流实例列表。原先长在 app/workflow/page.tsx 的
 * return 里，那个文件越过仓库 500 行的上限之后搬到这里。
 *
 * 每一行仍然是 `<Link>`，不是 `<div onClick>` —— 那一行下面的注释记着为什么，
 * 而 src/__tests__/WorkflowPage.test.tsx 钉着锚点的 `href` 和「没有
 * tabindex="-1"」。标记逐字未改，只把 `isWorkflowsLoading` 换成 prop `isLoading`。
 */
export function WorkflowInstanceList({
  workflows,
  isLoading,
}: {
  workflows: ApprovalWorkflowListItem[];
  isLoading: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      {isLoading ? (
        <ListSkeleton count={5} />
      ) : workflows.length === 0 ? (
        /* `py-12` (48px) is not a step on the ladder, and a centred
           "nothing here" reads as the page's subject rather than as the
           absence of one. EmptyState is left-aligned for that reason. */
        <EmptyState title={t("workflow.no_instances")} />
      ) : (
        workflows.map((wf) => (
          /* This row used to be a <div onClick={router.push}> with
             cursor-pointer and nothing else: no role, no tabIndex, no
             key handler. It looked clickable and was clickable, but Tab
             never reached it and Enter was bound to nothing, so the
             instance detail page had no keyboard route in at all. A
             <Link> is the fix rather than role="button" + tabIndex +
             onKeyDown, because this is navigation: the anchor is
             focusable natively, announces as a link, and restores
             middle-click-to-new-tab and copy-link-address, none of which
             a keyboard-emulating div gives back. The card holds no other
             interactive element, so there is no nested-<a> problem.
             `block` is what keeps the layout identical — an <a> is
             inline by default and p-4 would collapse. */
          <Link
            key={wf.id}
            href={`/workflow/${wf.id}`}
            className="block bg-surface-1 p-4 border border-hairline hover:border-[hsl(var(--color-accent))]/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-03 font-medium text-ink">{wf.workflow_name}</div>
                <div className="text-02 text-ink-muted mt-1">
                  <DomainEnum namespace="workflow.case_types" value={wf.case_type} /> · {wf.soul}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Tints unchanged, geometry moved onto Badge — which is
                    also what keeps the row's `py-0.5` legal, since that
                    class is granted to Badge.tsx alone. <DomainEnum>
                    still renders the inner span carrying title={raw},
                    which `WorkflowPage.test.tsx` selects on
                    (`getByTitle("IN_PROGRESS")`). */}
                <Badge
                  className={
                    wf.status === "COMPLETED"
                      ? "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))]"
                      : wf.status === "IN_PROGRESS"
                      ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))]"
                      : "bg-[hsl(var(--color-surface-3))] text-ink-muted"
                  }
                >
                  <DomainEnum namespace="workflow.status" value={wf.status} />
                </Badge>
                {wf.is_appeal && (
                  <Badge className="bg-[hsl(var(--color-verdict-retry)/0.1)] text-[hsl(var(--color-verdict-retry))]">
                    {t("workflow.appeal_badge")}
                  </Badge>
                )}
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
