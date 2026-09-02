"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { type FlowNode, type TemplatePreviewData } from "@/src/components/workflow/page/types";
import { Landmark } from "lucide-react";

/**
 * /workflow 的「查看模板详情」弹窗。原先长在 app/workflow/page.tsx 的 return 里，
 * 那个文件越过仓库 500 行的上限之后搬到这里。
 *
 * 标记逐字未改，只把 `viewModalOpen` / `setViewModalOpen(false)` / `viewingTemplate`
 * 换成 prop `isOpen` / `onClose` / `template`。
 */
export function TemplateDetailModal({
  isOpen,
  onClose,
  template,
}: {
  isOpen: boolean;
  onClose: () => void;
  template: TemplatePreviewData | null;
}) {
  const { t } = useI18n();

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => onClose()}
      title={template?.name || t("workflow.template_detail")}
    >
      {template && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              {/* 01 是 uppercase 小标签那一档 —— 这些是字段名，不是正文。 */}
              <span className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("souls.civilization")}</span>
              <p className="text-03 text-[hsl(var(--color-ink))] font-medium"><DomainEnum namespace="workflow.civilizations" value={template.civilization} /></p>
            </div>
            <div>
              <span className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("workflow.detail.case_type")}</span>
              <p className="text-03 text-[hsl(var(--color-ink))] font-medium">
                <DomainEnum namespace="workflow.case_types" value={template.case_type || template.caseType} />
              </p>
            </div>
          </div>
          <div>
            <span className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("workflow.detail.notes")}</span>
            <p className="text-03 text-[hsl(var(--color-ink))]"><DomainText value={template.description} /></p>
          </div>
          <div>
            <span className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{t("workflow.detail.nodes")}</span>
            <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
              {/* Backend templates arrive here via WorkflowTemplateSerializer's
                  `nodes` (source='nodes_json'); predefined templates are
                  built locally with a `nodes_json` key. Read both. */}
              {((template.nodes_json || template.nodes || []) as FlowNode[]).map((node: FlowNode, idx: number) => (
                <div key={idx} className="bg-[hsl(var(--color-surface-3))] p-2 text-03">
                  <div className="font-medium text-[hsl(var(--color-ink))]">{node.node_name}</div>
                  <div className="text-02 text-[hsl(var(--color-ink-muted))] mt-1">
                    {node.court_code && (
                  <span className="inline-flex items-center gap-1">
                    <Landmark aria-hidden="true" className="w-3.5 h-3.5" />
                    {node.court_code}
                  </span>
                )}
                    <span className="ml-2"><DomainEnum namespace="workflow.node_type" value={node.node_type} /></span>
                  </div>
                  {node.approver_role && (
                    <div className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">
                      {node.approver_role}
                    </div>
                  )}
                </div>
              ))}
              {(template.nodes_json || template.nodes || []).length === 0 && (
                <p className="text-03 text-[hsl(var(--color-ink-muted))]">{t("workflow.no_node_data")}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
