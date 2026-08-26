"use client";

import { type ApprovalWorkflow } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";

/**
 * /workflow/[id] 顶部那张「审批流信息」卡。原先长在 app/workflow/[id]/page.tsx 的
 * return 里，那个文件越过仓库 500 行的上限之后搬到这里；标记逐字未改。
 *
 * `statusLabel` 是 prop 而不是在这里重算：页面里那一份是
 * `resolveEnumDisplay(t, "workflow.status", …)` 加一个 `common.value.unrecorded`
 * 兜底，两处各写一遍就是两处可以分头改坏。
 *
 * 放在 `detail/` 子目录里，和 `../WorkflowEditor.tsx`（画布编辑器）分开。
 */
export function WorkflowInfoCard({
  workflow,
  statusLabel,
}: {
  workflow: ApprovalWorkflow;
  statusLabel: (status?: string | null) => string;
}) {
  const { t, formatDateTime } = useI18n();

  return (
    <>
    {/* Workflow Info Card. `p-5` (20px) was off the spacing ladder in all
        three cards on this page; `p-4` is the step below it. */}
    <div className="bg-surface-1 p-4 border border-hairline">
      {/* 01 是 uppercase 小标签那一档 —— 区块标题原本用 `text-sm` +
          `font-semibold` + `uppercase` 三个类拼出这个效果。 */}
      <h2 className="text-01 uppercase text-ink-muted mb-3">
        {t("workflow.detail.info")}
      </h2>
      <dl className="grid grid-cols-2 gap-4 text-03">
        <div>
          <dt className="text-ink-muted">{t("workflow.detail.soul")}</dt>
          <dd className="text-ink font-medium">{workflow.soul_name || workflow.soul}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("workflow.detail.case_type")}</dt>
          <dd className="text-ink"><DomainEnum namespace="workflow.case_types" value={workflow.case_type} /></dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("workflow.detail.judgment_verdict")}</dt>
          <dd className="text-ink"><DomainEnum namespace="workflow.verdicts" value={workflow.judgment_verdict} /></dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("workflow.detail.priority")}</dt>
          <dd className="text-ink">
            {workflow.priority === 0 ? t("workflow.detail.normal") :
             workflow.priority === 1 ? t("workflow.detail.urgent") :
             t("workflow.detail.critical")}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("workflow.detail.created_at")}</dt>
          <dd className="text-ink">{formatDateTime(workflow.created_at)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t("workflow.detail.completed_at")}</dt>
          <dd className="text-ink"><DomainText value={workflow.completed_at ? formatDateTime(workflow.completed_at) : null} missingKind={workflow.status === "COMPLETED" ? "unrecorded" : "inapplicable"} missingReason={statusLabel(workflow.status)} /></dd>
        </div>
      </dl>
    </div>
    </>
  );
}
