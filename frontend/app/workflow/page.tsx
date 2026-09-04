"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { LazyWorkflowEditor } from "@/src/components/charts/LazyWorkflowEditor";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { WORKFLOW_TEMPLATES, type TemplateKey } from "@soulledger/core/config/workflow-templates";
import { nodeTypeFor } from "@soulledger/core/config/workflow-node-types";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { WorkflowInstanceList } from "@/src/components/workflow/page/WorkflowInstanceList";
import { TemplateDetailModal } from "@/src/components/workflow/page/TemplateDetailModal";
import { DeleteTemplateModal } from "@/src/components/workflow/page/DeleteTemplateModal";
import {
  TemplatePreview,
  backendPreviewModel,
  presetPreviewModel,
} from "@/src/components/workflow/page/TemplatePreview";
import { QueryError } from "@/src/components/ui/PageError";
import type {
  BackendTemplate,
  FrontendNode,
  TemplatePreviewData,
} from "@/src/components/workflow/page/types";

export default function WorkflowPage() {
  const { t } = useI18n();
  const { showToast } = useToast();

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("CHINESE_ROUTINE");
  const [workflowInstance, setWorkflowInstance] = useState<ApprovalWorkflow | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateData, setEditingTemplateData] = useState<TemplatePreviewData | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<TemplatePreviewData | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmingTemplate, setConfirmingTemplate] = useState<BackendTemplate | null>(null);

  // `isError` / `refetch` 拿出来:这个 tab 此前对「加载失败」和「一条都没有」
  // 渲染**同一段文案**(「暂无审批实例」)。两条 e2e 测试因此共用一个可观察量 ——
  // 一个让实例列表永久为空的变异会让两条都通过。
  const {
    data: workflowsData,
    isLoading: isWorkflowsLoading,
    isError: isWorkflowsError,
    refetch: refetchWorkflows,
  } = useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await workflowApi.list();
      return res.data;
    },
  });

  // Fetch templates from backend
  // `isError` / `refetch` here too, for the same reason they were pulled out
  // for `workflows` above and by the same measurement. This query had neither,
  // and its render branch ended `: null` — so a FAILED templates fetch drew
  // **nothing at all**: no error, no "you have no custom templates yet", just
  // the predefined list below it where the operator's own templates should be.
  // Silently missing is the worst of the three, because there is nothing on
  // screen to disbelieve.
  //
  // The `workflows` query on this same page was fixed in an earlier round and
  // this one was not. Two queries, one page, one of them corrected — which is
  // exactly the per-QUERY shape the guard's per-FILE rules cannot see.
  const {
    data: templatesData,
    isLoading: isTemplatesLoading,
    isError: isTemplatesError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: async () => {
      const res = await workflowApi.templates.list();
      return res.data;
    },
  });

  const workflows = workflowsData?.results ?? [];
  // WorkflowTemplateViewSet sets pagination_class = None, so this list is a
  // bare array — there was never a `.results` on it to unwrap.
  const templates = templatesData ?? [];
  const queryClient = useQueryClient();

  // Delete template mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await workflowApi.templates.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
      setEditingTemplateId(null);
    },
    onError: () => showToast(t("workflow.delete_error"), "error"),
  });

  const selectedCivilization = selectedTemplate.split("_")[0];
  const currentTemplate = WORKFLOW_TEMPLATES[selectedTemplate];

  // Group templates by civilization
  const templatesByCiv = useMemo(() => {
    const groups: Record<string, { key: TemplateKey; name: string; description: string }[]> = {};
    for (const [key, template] of Object.entries(WORKFLOW_TEMPLATES)) {
      const civ = template.civilization;
      if (!groups[civ]) groups[civ] = [];
      groups[civ].push({ key: key as TemplateKey, name: template.name, description: template.description });
    }
    return groups;
  }, []);

  const tabs = [
    { key: "existing", label: t("workflow.existing") },
    { key: "editor", label: t("workflow.editor.title") },
    { key: "instances", label: t("workflow.instances") },
  ] as const;
  const [tab, setTab] = useState<"existing" | "editor" | "instances">("existing");

  return (
    /* `page` (1200px), up from the `max-w-6xl` (1152) this page chose for
       itself. */
    <PageShell
      variant="page"
      title={
        <>
          {t("workflow.title")}
          <MenuGloss path="/workflow" />
        </>
      }
      /* These three ARE page-level tabs — they decide what the whole page is
         showing — so unlike the strip on /workflow/[id] they belong in the
         shell's slot. They stay plain <button>s rather than becoming `Button`;
         that reading of the cva is written once, in `src/lib/tabClasses.ts`
         beside the classes themselves. */
      tabs={tabs.map((tabItem) => (
        <button
          key={tabItem.key}
          type="button"
          onClick={() => setTab(tabItem.key)}
          className={`${TAB_BASE} ${tab === tabItem.key ? TAB_ON : TAB_OFF}`}
        >
          {tabItem.label}
        </button>
      ))}
    >
        {tab === "existing" ? (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div>
                {/* 06 是区块标题那一档。 */}
                <h2 className="text-06 text-[hsl(var(--color-ink))]">{t("workflow.templates")}</h2>
                <p className="text-03 text-[hsl(var(--color-ink-muted))]">{t("workflow.select_template")}</p>
              </div>
              <RequirePermission permissions="workflow.create">
                <Button
                  type="button"
                  variant="primary"
                  className="shrink-0"
                  onClick={() => {
                    setEditingTemplateId(null);
                    setTab("editor");
                  }}
                >
                  + {t("workflow.new_template")}
                </Button>
              </RequirePermission>
            </div>

            {/* 左右布局：窄屏改为上下堆叠。
                固定的 `w-80 shrink-0` 在 393px 视口下会吃掉整行宽度
                （345px 可用 − 320px 列 − 24px gap = 1px），右侧预览被压成
                一条竖线；lg 以下先竖排，lg 起才回到双栏。 */}
            <div className="flex flex-col gap-6 lg:flex-row">
              {/* 左侧：模板列表 */}
              <div className="w-full space-y-4 lg:w-80 lg:shrink-0">
                {/* 后端模板列表 */}
                {isTemplatesError ? (
                  <QueryError onRetry={() => void refetchTemplates()} />
                ) : isTemplatesLoading ? (
                  <ListSkeleton count={3} />
                ) : templates.length === 0 ? (
                  <EmptyState
                    title={t("workflow.custom_templates")}
                    reason={t("workflow.no_custom_templates")}
                  />
                ) : (
                  <div className="space-y-2">
                    {/* 01 是 uppercase 小标签那一档，这两行原本是 `text-xs
                        font-semibold` 拼出来的同一个东西。 */}
                    <div className="text-01 uppercase text-[hsl(var(--color-ink-muted))] px-2">{t("workflow.custom_templates")}</div>
                    {templates.map((tmpl: BackendTemplate) => (
                      /* Stays a plain <button>, not `Button`. These are
                         selectable list rows: full-width, left-aligned, two
                         lines of content with a truncating title. `Button`'s
                         base is `inline-flex justify-center` on one line — the
                         three overrides it would take to undo that are the
                         signal that this is not the same control. */
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => {
                          setEditingTemplateId(String(tmpl.id));
                        }}
                        className={`w-full text-left px-3 py-2 border transition-colors ${
                          editingTemplateId === String(tmpl.id)
                            ? "bg-[hsl(var(--color-accent))]/10 border-[hsl(var(--color-accent))] text-[hsl(var(--color-ink))]"
                            : "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:border-[hsl(var(--color-accent))]/50"
                        }`}
                      >
                        <div title={tmpl.name} className="text-03 font-medium truncate">{tmpl.name}</div>
                        <div className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">
                          <DomainEnum namespace="workflow.civilizations" value={tmpl.civilization} /> · <DomainEnum namespace="workflow.case_types" value={tmpl.case_type} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* 预定义模板列表 */}
                <div className="space-y-2">
                  <div className="text-01 uppercase text-[hsl(var(--color-ink-muted))] px-2">{t("workflow.predefined_templates")}</div>
                  {Object.entries(templatesByCiv).map(([civ, civTemplates]) => (
                    <div key={civ} className="space-y-1">
                      <div className="text-02 text-[hsl(var(--color-accent-ink))] px-2 py-1 font-medium">
                        {t(`workflow.civilizations.${civ}`)}
                      </div>
                      {civTemplates.map((tmpl) => (
                        <button
                          key={tmpl.key}
                          type="button"
                          onClick={() => {
                            setSelectedTemplate(tmpl.key);
                            setEditingTemplateId(null); // 预定义模板用selectedTemplate
                          }}
                          className={`w-full text-left px-3 py-2 border transition-colors text-03 ${
                            selectedTemplate === tmpl.key && !editingTemplateId
                              ? "bg-[hsl(var(--color-accent))]/10 border-[hsl(var(--color-accent))] text-[hsl(var(--color-ink))]"
                              : "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:border-[hsl(var(--color-accent))]/50"
                          }`}
                        >
                          {tmpl.name}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* 右侧：预览 */}
              <div className="flex-1 min-w-0">
                {/* 预览内容 */}
                {(editingTemplateId || selectedTemplate) && (
                  <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
                    {/* 后端模板预览。标记在 `TemplatePreview`，两种来源共用一份；
                        差在字段名的部分收在 `backendPreviewModel` 这个适配器里。
                        按钮不进组件——这里有三颗且「查看」要发一次请求，预设那份
                        只有两颗且「查看」是纯本地构造。 */}
                    {editingTemplateId && templates.find((tpl: BackendTemplate) => String(tpl.id) === editingTemplateId) && (() => {
                      const tmpl = templates.find((tpl: BackendTemplate) => String(tpl.id) === editingTemplateId)!;
                      return (
                        <TemplatePreview
                          model={backendPreviewModel(tmpl)}
                          actions={
                            <>
                              <Button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await workflowApi.templates.get(String(tmpl.id));
                                    setViewingTemplate(res.data);
                                    setViewModalOpen(true);
                                  } catch (e) {
                                    setViewingTemplate(tmpl);
                                    setViewModalOpen(true);
                                  }
                                }}
                              >
                                {t("workflow.view")}
                              </Button>
                              <RequirePermission permissions="workflow.update">
                                <Button
                                  type="button"
                                  variant="primary"
                                  onClick={() => {
                                    setEditingTemplateId(String(tmpl.id));
                                    setTab("editor");
                                  }}
                                >
                                  {t("common.edit")}
                                </Button>
                              </RequirePermission>
                              <RequirePermission permissions="workflow.delete">
                                <Button
                                  type="button"
                                  variant="danger"
                                  onClick={() => {
                                    setConfirmingTemplate(tmpl);
                                    setConfirmModalOpen(true);
                                  }}
                                >
                                  {t("common.delete")}
                                </Button>
                              </RequirePermission>
                            </>
                          }
                        />
                      );
                    })()}

                    {/* 预定义模板预览。同一个 `TemplatePreview`，适配器换成
                        `presetPreviewModel`——`nodeTypeFor` 那一步就在它里面。 */}
                    {!editingTemplateId && selectedTemplate && currentTemplate && (
                      <TemplatePreview
                        model={presetPreviewModel(currentTemplate)}
                        actions={
                          <>
                            <Button
                              type="button"
                              onClick={() => {
                                setViewingTemplate({
                                  ...currentTemplate,
                                  nodes_json: currentTemplate.nodes.map((n: FrontendNode) => ({
                                    id: n.id,
                                    node_name: n.name,
                                    court_code: n.court,
                                    // `n.type` 是中文步骤名，不是 NodeType 成员——
                                    // 原样放进 node_type 是「编辑预设必定 400」的
                                    // 源头（见 src/config/workflow-node-types.ts）。
                                    // 预览走的是同一个映射，好让预览看到的类型和
                                    // 保存后存下的类型是同一个。
                                    node_type: nodeTypeFor(n.type),
                                  })),
                                });
                                setViewModalOpen(true);
                              }}
                            >
                              {t("workflow.view")}
                            </Button>
                            <RequirePermission permissions="workflow.update">
                              <Button
                                type="button"
                                variant="primary"
                                onClick={() => {
                                  setEditingTemplateData({
                                    name: currentTemplate.name,
                                    description: currentTemplate.description,
                                    civilization: currentTemplate.civilization,
                                    case_type: currentTemplate.caseType,
                                    // Carried through, or the three 紧急审判流程
                                    // presets would arrive in the editor as
                                    // ordinary ones and be saved back at 0 —
                                    // the preset's `priority: 1` would be a
                                    // value nothing could ever read.
                                    priority: currentTemplate.priority,
                                    nodes_json: currentTemplate.nodes.map((n: FrontendNode) => ({
                                      id: n.id,
                                      node_name: n.name,
                                      court_code: n.court,
                                      // 这一行就是缺陷所在：原本是 `n.type`，把
                                      //「分流」「初审」「终审」…送进 WorkflowEditor，
                                      // getTemplateNodes() 再 POST 成 node_type，而
                                      // WorkflowTemplateNodeSerializer 的 ChoiceField
                                      // 只收五个 NodeType 成员 → 400。
                                      node_type: nodeTypeFor(n.type),
                                    })),
                                  });
                                  setTab("editor");
                                }}
                              >
                                {t("common.edit")}
                              </Button>
                            </RequirePermission>
                          </>
                        }
                      />
                    )}
                  </div>
                )}

                {/* 未选中状态 */}
                {!editingTemplateId && !selectedTemplate && (
                  <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-4">
                    <EmptyState title={t("workflow.select_from_left")} />
                  </div>
                )}
              </div>
            </div>
          </>
        ) : tab === "editor" ? (
          /* Editor tab */
          <div className="h-[calc(100vh-220px)]">
            <LazyWorkflowEditor
              templateId={editingTemplateId || undefined}
              initialTemplateData={editingTemplateData}
              onClose={() => {
                setTab("existing");
                setEditingTemplateId(null);
                setEditingTemplateData(null);
              }}
              onSave={() => {
                setTab("existing");
                setEditingTemplateId(null);
                setEditingTemplateData(null);
              }}
            />
          </div>
        ) : (
          /* Instances tab */
          isWorkflowsError ? (
            <QueryError onRetry={() => refetchWorkflows()} />
          ) : (
            <WorkflowInstanceList workflows={workflows} isLoading={isWorkflowsLoading} />
          )
        )}

        {/* 查看模板详情弹窗 */}
        <TemplateDetailModal
          isOpen={viewModalOpen}
          onClose={() => setViewModalOpen(false)}
          template={viewingTemplate}
        />

        {/* 删除确认弹窗 */}
        <DeleteTemplateModal
          isOpen={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          onConfirm={(id) => deleteMutation.mutate(id)}
          template={confirmingTemplate}
          isPending={deleteMutation.isPending}
        />
    </PageShell>
  );
}
