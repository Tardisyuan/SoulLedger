"use client";

import { type ApprovalWorkflow } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { CaseNumber, DomainEnum, DomainText, MissingValue } from "@/src/components/ui/DomainValue";

/**
 * /workflow/[id] 右栏的「信息」卡(v3 A1 实例详情):`surface-1` 卡,h2「信息」,
 * `72px 1fr` 的 dt/dd 网格。
 *
 * `statusLabel` 是 prop 而不是在这里重算：页面里那一份是
 * `resolveEnumDisplay(t, "workflow.status", …)` 加一个 `common.value.unrecorded`
 * 兜底，两处各写一遍就是两处可以分头改坏。字形同理(`statusGlyph`)。
 *
 * 稿里还有一行「余额」—— 审批流的 API 不带余额,这一行不画(不造字段)。
 */
export function WorkflowInfoCard({
  workflow,
  statusLabel,
  statusGlyph,
}: {
  workflow: ApprovalWorkflow;
  statusLabel: (status?: string | null) => string;
  statusGlyph?: string;
}) {
  const { t, formatDateTime } = useI18n();

  const DT = "py-2 text-xs text-[oklch(var(--color-ink-muted))]";
  const DD = "py-2 text-sm text-[oklch(var(--color-ink))] min-w-0 break-words";
  const priorityLabel =
    workflow.priority === 0 ? t("workflow.detail.normal") : workflow.priority === 1 ? t("workflow.detail.urgent") : t("workflow.detail.critical");

  return (
    <section className="px-6 py-4 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]">
      <h2 className="font-title text-lg text-[oklch(var(--color-ink))]">{t("workflow.detail.info")}</h2>
      <dl className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3">
        <dt className={DT}>{t("workflow.detail.soul")}</dt>
        <dd className={`${DD} font-medium`}>{workflow.soul_name || workflow.soul}</dd>
        <dt className={DT}>{t("workflow.detail.template")}</dt>
        <dd className={DD}>
          {workflow.workflow_name}
          {workflow.template_version_number != null && (
            <span className="ml-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">v{workflow.template_version_number}</span>
          )}
        </dd>
        <dt className={DT}>{t("workflow.detail.case_type")}</dt>
        <dd className={DD}><DomainEnum namespace="workflow.case_types" value={workflow.case_type} /></dd>
        {/* 所属审判的案号(CASE_NUMBER_POLICY);没挂审判的流程(如转生申请)不适用。 */}
        <dt className={DT}>{t("judgment.case_number")}</dt>
        <dd className={DD}>
          {workflow.judgment ? <CaseNumber value={workflow.judgment_case_number} /> : <MissingValue kind="inapplicable" />}
        </dd>
        <dt className={DT}>{t("workflow.detail.judgment_verdict")}</dt>
        <dd className={DD}><DomainEnum namespace="workflow.verdicts" value={workflow.judgment_verdict} /></dd>
        <dt className={DT}>{t("workflow.detail.priority")}</dt>
        <dd className={DD}>
          <span className="font-mono">{workflow.priority}</span> · {priorityLabel}
        </dd>
        <dt className={DT}>{t("workflow.detail.created_at")}</dt>
        <dd className={`${DD} font-mono text-xs`}>{formatDateTime(workflow.created_at)}</dd>
        <dt className={DT}>{t("workflow.detail.completed_at")}</dt>
        <dd className={`${DD} font-mono text-xs`}><DomainText value={workflow.completed_at ? formatDateTime(workflow.completed_at) : null} missingKind={workflow.status === "COMPLETED" ? "unrecorded" : "inapplicable"} missingReason={statusLabel(workflow.status)} /></dd>
        <dt className={DT}>{t("workflow.detail.status")}</dt>
        <dd className={DD} title={workflow.status}>
          {statusGlyph && <span aria-hidden="true">{statusGlyph} </span>}
          {statusLabel(workflow.status)}
        </dd>
      </dl>
    </section>
  );
}
