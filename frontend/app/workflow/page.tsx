"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode, type WorkflowTemplateNode } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import Link from "next/link";
import { LazyWorkflowEditor } from "@/src/components/charts/LazyWorkflowEditor";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { BaseModal } from "@/src/components/ui/Modal";
import { WORKFLOW_TEMPLATES, type TemplateKey } from "@/src/config/workflow-templates";
import { nodeTypeFor } from "@/src/config/workflow-node-types";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { EmptyState } from "@/src/components/ui/EmptyState";

// ── Types for template data ──────────────────────────────────────

// Node that can be rendered in React Flow - unified shape
interface FlowNode {
  // Optional: WorkflowTemplateNode.id is `required=False` on the serializer,
  // so a node persisted without one comes back without the key.
  id?: string | number;
  node_name: string;
  status?: string;
  node_type?: string;
  court_code?: string;
  approver_role?: string;
}

// Backend template from workflow API.
// NOTE: `nodes_json` is the WorkflowTemplate *model* field name. The API
// exposes that data as `nodes` (source='nodes_json'), so `nodes_json` is
// always undefined here and every node list rendered off it is empty.
interface BackendTemplate {
  id: string | number;
  name: string;
  description?: string;
  civilization: string;
  case_type?: string;
  nodes_json?: FlowNode[];
}

// Frontend template node (from WORKFLOW_TEMPLATES)
interface FrontendNode {
  id: string;
  name: string;
  court: string;
  type: string;
  order: number;
}

// Flexible template type for preview/display (handles both backend and frontend shapes)
interface TemplatePreviewData {
  id?: string | number;
  name: string;
  description?: string;
  civilization: string;
  case_type?: string;
  caseType?: string;
  // The template-level default urgency (0/1/2). Optional here because this
  // shape also stands in for backend templates fetched before the column
  // existed; `WorkflowEditor` treats undefined as 0.
  priority?: number;
  nodes_json?: FlowNode[];
  // Either shape: the preset templates in WORKFLOW_TEMPLATES use FrontendNode,
  // while a template fetched from the API uses the serializer's node shape.
  nodes?: FrontendNode[] | WorkflowTemplateNode[];
}

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

  const { data: workflowsData, isLoading: isWorkflowsLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await workflowApi.list();
      return res.data;
    },
  });

  // Fetch templates from backend
  const { data: templatesData, isLoading: isTemplatesLoading } = useQuery({
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
         shell's slot. They stay plain <button>s rather than becoming `Button`:
         that cva writes `border` on all four sides and an `active:translate-y-px`
         press nudge, both of which fight a strip whose entire visual language
         is a single 2px bottom rule that has to line up with the container's
         hairline. */
      tabs={tabs.map((tabItem) => (
        <button
          key={tabItem.key}
          type="button"
          onClick={() => setTab(tabItem.key)}
          className={`px-4 py-2 text-03 font-medium transition-colors border-b-2 -mb-px ${
            tab === tabItem.key
              ? "text-[hsl(var(--color-accent-ink))] border-accent"
              : "text-ink-muted border-transparent hover:text-ink"
          }`}
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
                <h2 className="text-06 text-ink">{t("workflow.templates")}</h2>
                <p className="text-03 text-ink-muted">{t("workflow.select_template")}</p>
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
                {isTemplatesLoading ? (
                  <ListSkeleton count={3} />
                ) : templates.length > 0 ? (
                  <div className="space-y-2">
                    {/* 01 是 uppercase 小标签那一档，这两行原本是 `text-xs
                        font-semibold` 拼出来的同一个东西。 */}
                    <div className="text-01 uppercase text-ink-muted px-2">{t("workflow.custom_templates")}</div>
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
                            ? "bg-[hsl(var(--color-accent))]/10 border-accent text-ink"
                            : "bg-surface-1 border-hairline text-ink-muted hover:border-[hsl(var(--color-accent))]/50"
                        }`}
                      >
                        <div className="text-03 font-medium truncate">{tmpl.name}</div>
                        <div className="text-02 text-ink-subtle mt-1">
                          <DomainEnum namespace="workflow.civilizations" value={tmpl.civilization} /> · <DomainEnum namespace="workflow.case_types" value={tmpl.case_type} />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* 预定义模板列表 */}
                <div className="space-y-2">
                  <div className="text-01 uppercase text-ink-muted px-2">{t("workflow.predefined_templates")}</div>
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
                              ? "bg-[hsl(var(--color-accent))]/10 border-accent text-ink"
                              : "bg-surface-1 border-hairline text-ink-muted hover:border-[hsl(var(--color-accent))]/50"
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
                  <div className="bg-surface-1 border border-hairline p-4">
                    {/* 后端模板预览 */}
                    {editingTemplateId && templates.find((tpl: BackendTemplate) => String(tpl.id) === editingTemplateId) && (() => {
                      const tmpl = templates.find((tpl: BackendTemplate) => String(tpl.id) === editingTemplateId)!;
                      return (
                        <>
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h3 className="text-06 text-ink">{tmpl.name}</h3>
                              <div className="flex gap-2 mt-1">
                                {/* A civilization is an identity, which is the
                                    documented meaning of `pill` here; the case
                                    type is a classification and stays square. */}
                                <Badge tone="accent" shape="pill">
                                  <DomainEnum namespace="workflow.civilizations" value={tmpl.civilization} />
                                </Badge>
                                <Badge>
                                  <DomainEnum namespace="workflow.case_types" value={tmpl.case_type} />
                                </Badge>
                              </div>
                            </div>
                            <div className="flex gap-2">
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
                            </div>
                          </div>
                          <p className="text-03 text-ink-muted mb-4">{tmpl.description || t("workflow.no_description")}</p>
                          <div className="text-02 text-ink-subtle mb-3">
                            {t("workflow.nodes_count", { count: String(tmpl.node_count ?? (tmpl.nodes_json || []).length) })}
                          </div>
                          {tmpl.nodes_json ? (
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                              {tmpl.nodes_json.map((node: FlowNode, idx: number) => (
                                <div key={idx} className="flex items-center gap-3 p-2 bg-surface-2">
                                  {/* `rounded-full` survives the corner purge:
                                      a round mark is an identity token, which
                                      an ordinal step number is. */}
                                  <span className="w-6 h-6 rounded-full bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))] flex items-center justify-center text-02 font-medium shrink-0">
                                    {idx + 1}
                                  </span>
                                  <span className="text-03 text-ink">{node.node_name}</span>
                                  <span className="text-ink-subtle">·</span>
                                  <span className="text-02 text-ink-muted">{node.court_code}</span>
                                  <span className="text-ink-subtle">·</span>
                                  <span className="text-02 text-ink-muted"><DomainEnum namespace="workflow.node_type" value={node.node_type} /></span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            // Saved backend templates arrive from WorkflowTemplateListSerializer,
                            // which carries node_count but not the node graph itself — a per-list-row
                            // node breakdown would mean shipping every template's full graph on one
                            // list request. Predefined (not-yet-saved) templates still come with
                            // nodes_json inline and keep the detail list above.
                            <p className="text-02 text-ink-subtle">
                              {t("workflow.view_to_see_nodes")}
                            </p>
                          )}
                        </>
                      );
                    })()}

                    {/* 预定义模板预览 */}
                    {!editingTemplateId && selectedTemplate && currentTemplate && (
                      <>
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-06 text-ink">{currentTemplate.name}</h3>
                            <div className="flex gap-2 mt-1">
                              <Badge tone="accent" shape="pill">
                                <DomainEnum namespace="workflow.civilizations" value={currentTemplate.civilization} />
                              </Badge>
                              <Badge>
                                <DomainEnum namespace="workflow.case_types" value={currentTemplate.caseType} />
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-2">
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
                          </div>
                        </div>
                        <p className="text-03 text-ink-muted mb-4">{currentTemplate.description}</p>
                        <div className="text-02 text-ink-subtle mb-3">
                          {t("workflow.nodes_count", { count: String(currentTemplate.nodes.length) })}
                        </div>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {currentTemplate.nodes.map((node: FrontendNode, idx: number) => (
                            <div key={idx} className="flex items-center gap-3 p-2 bg-surface-2">
                              <span className="w-6 h-6 rounded-full bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent-ink))] flex items-center justify-center text-02 font-medium shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-03 text-ink">{node.name}</span>
                              <span className="text-ink-subtle">·</span>
                              <span className="text-02 text-ink-muted">{node.court}</span>
                              <span className="text-ink-subtle">·</span>
                              {/* `workflow.node_type` 这个 bundle 只有 trial/
                                  evaluation/appeal/final/execution 五个键，所以
                                  直接传 `node.type`（「分流」…）时 <DomainEnum> 一律
                                  判为 unrecognized，这一格 56 个预设节点全部显示
                                 「未识别取值」。映射之后它显示的是真正的类型，也和
                                  保存下去的值是同一个。 */}
                              <span className="text-02 text-ink-muted"><DomainEnum namespace="workflow.node_type" value={nodeTypeFor(node.type)} /></span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 未选中状态 */}
                {!editingTemplateId && !selectedTemplate && (
                  <div className="bg-surface-1 border border-hairline px-4">
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
          <div className="space-y-4">
            {isWorkflowsLoading ? (
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
        )}

        {/* 查看模板详情弹窗 */}
        <BaseModal
          isOpen={viewModalOpen}
          onClose={() => setViewModalOpen(false)}
          title={viewingTemplate?.name || t("workflow.template_detail")}
        >
          {viewingTemplate && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  {/* 01 是 uppercase 小标签那一档 —— 这些是字段名，不是正文。 */}
                  <span className="text-01 uppercase text-ink-subtle">{t("souls.civilization")}</span>
                  <p className="text-03 text-ink font-medium"><DomainEnum namespace="workflow.civilizations" value={viewingTemplate.civilization} /></p>
                </div>
                <div>
                  <span className="text-01 uppercase text-ink-subtle">{t("workflow.detail.case_type")}</span>
                  <p className="text-03 text-ink font-medium">
                    <DomainEnum namespace="workflow.case_types" value={viewingTemplate.case_type || viewingTemplate.caseType} />
                  </p>
                </div>
              </div>
              <div>
                <span className="text-01 uppercase text-ink-subtle">{t("workflow.detail.notes")}</span>
                <p className="text-03 text-ink"><DomainText value={viewingTemplate.description} /></p>
              </div>
              <div>
                <span className="text-01 uppercase text-ink-subtle">{t("workflow.detail.nodes")}</span>
                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                  {/* Backend templates arrive here via WorkflowTemplateSerializer's
                      `nodes` (source='nodes_json'); predefined templates are
                      built locally with a `nodes_json` key. Read both. */}
                  {((viewingTemplate.nodes_json || viewingTemplate.nodes || []) as FlowNode[]).map((node: FlowNode, idx: number) => (
                    <div key={idx} className="bg-surface-3 p-2 text-03">
                      <div className="font-medium text-ink">{node.node_name}</div>
                      <div className="text-02 text-ink-muted mt-1">
                        {node.court_code && <span>🏛 {node.court_code}</span>}
                        <span className="ml-2"><DomainEnum namespace="workflow.node_type" value={node.node_type} /></span>
                      </div>
                      {node.approver_role && (
                        <div className="text-02 text-ink-subtle mt-1">
                          {node.approver_role}
                        </div>
                      )}
                    </div>
                  ))}
                  {(viewingTemplate.nodes_json || viewingTemplate.nodes || []).length === 0 && (
                    <p className="text-03 text-ink-muted">{t("workflow.no_node_data")}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </BaseModal>

        {/* 删除确认弹窗 */}
        <BaseModal
          isOpen={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          title={t("common.confirm_delete")}
          footer={
            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setConfirmModalOpen(false)}>
                {t("common.cancel")}
              </Button>
              {/* Was `bg-status-error` + `text-white`, which measures 3.59:1 in
                  the dark theme — under AA, on the one control in this dialog
                  that destroys something. `Button`'s danger variant is the
                  10%-tint recipe that clears AA in both themes. */}
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  if (confirmingTemplate) {
                    deleteMutation.mutate(String(confirmingTemplate.id));
                  }
                  setConfirmModalOpen(false);
                }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (t("common.deleting")) : (t("common.confirm_delete"))}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-03 text-ink">{t("workflow.delete_confirm_msg", { name: confirmingTemplate?.name || "" })}</p>
            <p className="text-03 text-[hsl(var(--color-status-error))]">{t("workflow.delete_irreversible")}</p>
          </div>
        </BaseModal>
    </PageShell>
  );
}
