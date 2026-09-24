"use client";

import { type ApprovalWorkflow } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { LedgerHeading } from "@/src/components/souls/detail/SoulLedgerSections";

/**
 * /workflow/[id] 左栏的「甲 · 审批流信息」(原是一张卡)。原先长在 app/workflow/[id]/page.tsx 的
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

  const DT = "py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))]";
  const DD = "py-1.5 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0";

  return (
    <section>
      {/* 甲 · 区块标压线,dt / dd 行线分隔(规范 v1 详情页原型,与灵魂详情「甲 · 身份」同一写法)。 */}
      <LedgerHeading mark="甲" title={t("workflow.detail.info")} />
      <dl className="grid grid-cols-[7rem_1fr] text-sm">
        <dt className={DT}>{t("workflow.detail.soul")}</dt>
        <dd className={`${DD} font-medium`}>{workflow.soul_name || workflow.soul}</dd>
        <dt className={DT}>{t("workflow.detail.case_type")}</dt>
        <dd className={DD}><DomainEnum namespace="workflow.case_types" value={workflow.case_type} /></dd>
        <dt className={DT}>{t("workflow.detail.judgment_verdict")}</dt>
        <dd className={DD}><DomainEnum namespace="workflow.verdicts" value={workflow.judgment_verdict} /></dd>
        <dt className={DT}>{t("workflow.detail.priority")}</dt>
        <dd className={DD}>
          {workflow.priority === 0 ? t("workflow.detail.normal") :
           workflow.priority === 1 ? t("workflow.detail.urgent") :
           t("workflow.detail.critical")}
        </dd>
        <dt className={DT}>{t("workflow.detail.created_at")}</dt>
        <dd className={`${DD} font-mono text-xs`}>{formatDateTime(workflow.created_at)}</dd>
        <dt className={DT}>{t("workflow.detail.completed_at")}</dt>
        <dd className={`${DD} font-mono text-xs`}><DomainText value={workflow.completed_at ? formatDateTime(workflow.completed_at) : null} missingKind={workflow.status === "COMPLETED" ? "unrecorded" : "inapplicable"} missingReason={statusLabel(workflow.status)} /></dd>
      </dl>
    </section>
  );
}
