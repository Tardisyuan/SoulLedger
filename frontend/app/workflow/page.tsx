"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import Link from "next/link";
import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { BaseModal } from "@/src/components/ui/Modal";
import { WORKFLOW_TEMPLATES, type TemplateKey } from "@/src/config/workflow-templates";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

// ── Types for template data ──────────────────────────────────────

// Node that can be rendered in React Flow - unified shape
interface FlowNode {
  id: string | number;
  node_name: string;
  status?: string;
  node_type?: string;
  court_code?: string;
  approver_role?: string;
}

// Backend template from workflow API
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
  nodes_json?: FlowNode[];
  nodes?: FrontendNode[];
}

// Custom node component for workflow visualization
function WorkflowNodeComponent({ data }: { data: { label: string; status: string; nodeType: string; courtCode: string } }) {
  const statusColors: Record<string, string> = {
    PENDING: "bg-[hsl(var(--color-status-warning)/0.2)] border-[hsl(var(--color-status-warning)/0.5)]",
    APPROVED: "bg-[hsl(var(--color-status-success)/0.2)] border-[hsl(var(--color-status-success)/0.5)]",
    REJECTED: "bg-[hsl(var(--color-status-error)/0.2)] border-[hsl(var(--color-status-error)/0.5)]",
    SKIPPED: "bg-[hsl(var(--color-status-lost)/0.2)] border-[hsl(var(--color-status-lost)/0.5)]",
    ESCALATED: "bg-[hsl(var(--color-verdict-retry)/0.2)] border-[hsl(var(--color-verdict-retry)/0.5)]",
  };

  const colorClass = statusColors[data.status] || statusColors.PENDING;

  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${colorClass} min-w-[160px]`}>
      <Handle type="target" position={Position.Top} className="!bg-[hsl(var(--color-accent))]" />
      <div className="text-sm font-semibold text-[hsl(var(--color-ink))]">{data.label}</div>
      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">{data.nodeType}</div>
      {data.courtCode && (
        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">{data.courtCode}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-[hsl(var(--color-accent))]" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeComponent,
};


const CASE_TYPE_KEYS: Record<string, string> = {
  ROUTINE: "workflow.case_types.ROUTINE",
  APPEAL: "workflow.case_types.APPEAL",
  CROSS_REALM: "workflow.case_types.CROSS_REALM",
  SPECIAL: "workflow.case_types.SPECIAL",
  HEART_WEIGHING: "workflow.case_types.HEART_WEIGHING",
  DIVINE_TRIAL: "workflow.case_types.DIVINE_TRIAL",
  CANONIZATION: "workflow.case_types.CANONIZATION",
  PURGATORY_REVIEW: "workflow.case_types.PURGATORY_REVIEW",
  HERESY_TRIAL: "workflow.case_types.HERESY_TRIAL",
};

export default function WorkflowPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
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

  const workflows = (workflowsData?.results ?? workflowsData ?? []) as ApprovalWorkflow[];
  const templates = (templatesData?.results ?? templatesData ?? []) as BackendTemplate[];
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

  // Build nodes and edges for React Flow
  const flowNodes = useMemo(() => {
    const nodesToRender = workflowInstance?.nodes?.length
      ? workflowInstance.nodes.map((n): FlowNode => ({
          id: n.id,
          node_name: n.node_name,
          status: n.status,
          node_type: n.node_type,
          court_code: n.court_code,
        }))
      : (currentTemplate?.nodes || []).map((n): FlowNode => ({
          id: n.id,
          node_name: n.name,
          status: undefined,
          node_type: n.type,
          court_code: n.court,
        }));

    return nodesToRender.map((n, idx) => ({
      id: String(n.id),
      type: "workflowNode",
      position: { x: 250, y: idx * 150 },
      data: {
        label: n.node_name,
        status: n.status || "PENDING",
        nodeType: n.node_type || "",
        courtCode: n.court_code || "",
      },
    }));
  }, [currentTemplate, workflowInstance]);

  const flowEdges = useMemo(() => {
    const nodesToRender = workflowInstance?.nodes?.length
      ? workflowInstance.nodes
      : currentTemplate?.nodes || [];

    return nodesToRender.slice(0, -1).map((n, idx) => {
      const nextNode = nodesToRender[idx + 1];
      return {
        id: `e${n.id}-${nextNode?.id}`,
        source: String(n.id),
        target: String(nextNode?.id),
        markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
        animated: workflowInstance?.current_node === n.id,
        style: { stroke: "#f59e0b", strokeWidth: 2 },
      };
    });
  }, [currentTemplate, workflowInstance]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Update nodes/edges when template changes
  useEffect(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

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
    { key: "editor", label: t("workflow.editor") },
    { key: "instances", label: t("workflow.instances") },
  ] as const;
  const [tab, setTab] = useState<"existing" | "editor" | "instances">("existing");

  return (
    <div className="text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("workflow.title")}
        </h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-[hsl(var(--color-hairline))]/50">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === tabItem.key
                  ? "text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent))]"
                  : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        {tab === "existing" ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))]">{t("workflow.templates")}</h2>
                <p className="text-sm text-[hsl(var(--color-ink-muted))]">{t("workflow.select_template")}</p>
              </div>
              <RequirePermission permissions="workflow.create">
                <button
                  onClick={() => {
                    setEditingTemplateId(null);
                    setTab("editor");
                  }}
                  className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium transition-colors"
                >
                  + {t("workflow.new_template")}
                </button>
              </RequirePermission>
            </div>

            {/* 左右布局 */}
            <div className="flex gap-6">
              {/* 左侧：模板列表 */}
              <div className="w-80 shrink-0 space-y-4">
                {/* 后端模板列表 */}
                {isTemplatesLoading ? (
                  <ListSkeleton count={3} />
                ) : templates.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[hsl(var(--color-ink-muted))] px-2">{t("workflow.custom_templates")}</div>
                    {templates.map((tmpl: BackendTemplate) => (
                      <button
                        key={tmpl.id}
                        onClick={() => {
                          setEditingTemplateId(String(tmpl.id));
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          editingTemplateId === String(tmpl.id)
                            ? "bg-[hsl(var(--color-accent))]/10 border-[hsl(var(--color-accent))] text-[hsl(var(--color-ink))]"
                            : "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:border-[hsl(var(--color-accent))]/50"
                        }`}
                      >
                        <div className="text-sm font-medium truncate">{tmpl.name}</div>
                        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-0.5">
                          {tmpl.civilization} · {t(CASE_TYPE_KEYS[tmpl.case_type || '']) || tmpl.case_type}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* 预定义模板列表 */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[hsl(var(--color-ink-muted))] px-2">{t("workflow.predefined_templates")}</div>
                  {Object.entries(templatesByCiv).map(([civ, civTemplates]) => (
                    <div key={civ} className="space-y-1">
                      <div className="text-xs text-[hsl(var(--color-accent))] px-2 py-1 font-medium">
                        {t(`workflow.civilizations.${civ}`)}
                      </div>
                      {civTemplates.map((tmpl) => (
                        <button
                          key={tmpl.key}
                          onClick={() => {
                            setSelectedTemplate(tmpl.key);
                            setEditingTemplateId(null); // 预定义模板用selectedTemplate
                          }}
                          className={`w-full text-left px-3 py-1.5 rounded border transition-colors text-sm ${
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
                  <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-4">
                    {/* 后端模板预览 */}
                    {editingTemplateId && templates.find((tpl: BackendTemplate) => String(tpl.id) === editingTemplateId) && (() => {
                      const tmpl = templates.find((tpl: BackendTemplate) => String(tpl.id) === editingTemplateId)!;
                      return (
                        <>
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h3 className="text-lg font-semibold text-[hsl(var(--color-ink))]">{tmpl.name}</h3>
                              <div className="flex gap-2 mt-1">
                                <span className="px-2 py-0.5 bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] rounded text-xs">
                                  {tmpl.civilization}
                                </span>
                                <span className="px-2 py-0.5 bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] rounded text-xs">
                                  {t(CASE_TYPE_KEYS[tmpl.case_type || '']) || tmpl.case_type}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
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
                                className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink-muted))]"
                              >
                                {t("workflow.view")}
                              </button>
                              <RequirePermission permissions="workflow.update">
                                <button
                                  onClick={() => {
                                    setEditingTemplateId(String(tmpl.id));
                                    setTab("editor");
                                  }}
                                  className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium"
                                >
                                  {t("common.edit")}
                                </button>
                              </RequirePermission>
                              <RequirePermission permissions="workflow.delete">
                                <button
                                  onClick={() => {
                                    setConfirmingTemplate(tmpl);
                                    setConfirmModalOpen(true);
                                  }}
                                  className="px-3 py-1.5 bg-[hsl(var(--color-status-error)/0.2)] hover:bg-[hsl(var(--color-status-error)/0.3)] text-[hsl(var(--color-status-error))] border border-[hsl(var(--color-status-error)/0.3)] rounded text-sm font-medium"
                                >
                                  {t("common.delete")}
                                </button>
                              </RequirePermission>
                            </div>
                          </div>
                          <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">{tmpl.description || t("workflow.no_description")}</p>
                          <div className="text-xs text-[hsl(var(--color-ink-subtle))] mb-3">
                            {t("workflow.nodes_count", { count: String((tmpl.nodes_json || []).length) })}
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto">
                            {(tmpl.nodes_json || []).map((node: FlowNode, idx: number) => (
                              <div key={idx} className="flex items-center gap-3 p-2 bg-[hsl(var(--color-surface-2))] rounded">
                                <span className="w-6 h-6 rounded-full bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] flex items-center justify-center text-xs font-bold shrink-0">
                                  {idx + 1}
                                </span>
                                <span className="text-sm text-[hsl(var(--color-ink))]">{node.node_name}</span>
                                <span className="text-[hsl(var(--color-ink-subtle))]">·</span>
                                <span className="text-xs text-[hsl(var(--color-ink-muted))]">{node.court_code}</span>
                                <span className="text-[hsl(var(--color-ink-subtle))]">·</span>
                                <span className="text-xs text-[hsl(var(--color-ink-muted))]">{node.node_type}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}

                    {/* 预定义模板预览 */}
                    {!editingTemplateId && selectedTemplate && currentTemplate && (
                      <>
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-[hsl(var(--color-ink))]">{currentTemplate.name}</h3>
                            <div className="flex gap-2 mt-1">
                              <span className="px-2 py-0.5 bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] rounded text-xs">
                                {currentTemplate.civilization}
                              </span>
                              <span className="px-2 py-0.5 bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] rounded text-xs">
                                {t(CASE_TYPE_KEYS[currentTemplate.caseType || '']) || currentTemplate.caseType}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setViewingTemplate({
                                  ...currentTemplate,
                                  nodes_json: currentTemplate.nodes.map((n: FrontendNode) => ({
                                    id: n.id,
                                    node_name: n.name,
                                    court_code: n.court,
                                    node_type: n.type,
                                  })),
                                });
                                setViewModalOpen(true);
                              }}
                              className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink-muted))]"
                            >
                              {t("workflow.view")}
                            </button>
                            <RequirePermission permissions="workflow.update">
                              <button
                                onClick={() => {
                                  setEditingTemplateData({
                                    name: currentTemplate.name,
                                    description: currentTemplate.description,
                                    civilization: currentTemplate.civilization,
                                    case_type: currentTemplate.caseType,
                                    nodes_json: currentTemplate.nodes.map((n: FrontendNode) => ({
                                      id: n.id,
                                      node_name: n.name,
                                      court_code: n.court,
                                      node_type: n.type,
                                    })),
                                  });
                                  setTab("editor");
                                }}
                                className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium"
                              >
                                {t("common.edit")}
                              </button>
                            </RequirePermission>
                          </div>
                        </div>
                        <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">{currentTemplate.description}</p>
                        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mb-3">
                          {t("workflow.nodes_count", { count: String(currentTemplate.nodes.length) })}
                        </div>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {currentTemplate.nodes.map((node: FrontendNode, idx: number) => (
                            <div key={idx} className="flex items-center gap-3 p-2 bg-[hsl(var(--color-surface-2))] rounded">
                              <span className="w-6 h-6 rounded-full bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] flex items-center justify-center text-xs font-bold shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-sm text-[hsl(var(--color-ink))]">{node.name}</span>
                              <span className="text-[hsl(var(--color-ink-subtle))]">·</span>
                              <span className="text-xs text-[hsl(var(--color-ink-muted))]">{node.court}</span>
                              <span className="text-[hsl(var(--color-ink-subtle))]">·</span>
                              <span className="text-xs text-[hsl(var(--color-ink-muted))]">{node.type}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 未选中状态 */}
                {!editingTemplateId && !selectedTemplate && (
                  <div className="text-center text-[hsl(var(--color-ink-muted))] py-16 bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))]">
                    {t("workflow.select_from_left")}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : tab === "editor" ? (
          /* Editor tab */
          <div className="h-[calc(100vh-220px)]">
            <WorkflowEditor
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
              <div className="text-center text-[hsl(var(--color-ink-subtle))] py-12">
                {t("workflow.no_instances")}
              </div>
            ) : (
              workflows.map((wf) => (
                <div
                  key={wf.id}
                  className="bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))] hover:border-[hsl(var(--color-accent))]/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/workflow/${wf.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-[hsl(var(--color-ink))]">{wf.workflow_name}</div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                        {wf.case_type} · {wf.soul}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          wf.status === "COMPLETED"
                            ? "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]"
                            : wf.status === "IN_PROGRESS"
                            ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                            : "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"
                        }`}
                      >
                        {wf.status}
                      </span>
                      {wf.is_appeal && (
                        <span className="px-2 py-0.5 rounded text-xs bg-[hsl(var(--color-verdict-retry)/0.2)] text-[hsl(var(--color-verdict-retry))]">
                          {t("workflow.appeal_badge")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
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
                  <span className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("souls.civilization")}</span>
                  <p className="text-sm text-[hsl(var(--color-ink))] font-medium">{viewingTemplate.civilization}</p>
                </div>
                <div>
                  <span className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("workflow.detail.case_type")}</span>
                  <p className="text-sm text-[hsl(var(--color-ink))] font-medium">
                    {t(CASE_TYPE_KEYS[viewingTemplate.case_type || viewingTemplate.caseType || '']) || viewingTemplate.case_type || viewingTemplate.caseType || "—"}
                  </p>
                </div>
              </div>
              <div>
                <span className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("workflow.detail.notes")}</span>
                <p className="text-sm text-[hsl(var(--color-ink))]">{viewingTemplate.description || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-[hsl(var(--color-ink-subtle))]">{t("workflow.detail.nodes")}</span>
                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                  {(viewingTemplate.nodes_json || []).map((node: FlowNode, idx: number) => (
                    <div key={idx} className="bg-[hsl(var(--color-surface-3))] rounded p-2 text-sm">
                      <div className="font-medium text-[hsl(var(--color-ink))]">{node.node_name}</div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                        {node.court_code && <span>🏛 {node.court_code}</span>}
                        <span className="ml-2">{node.node_type}</span>
                      </div>
                      {node.approver_role && (
                        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                          {node.approver_role}
                        </div>
                      )}
                    </div>
                  ))}
                  {(viewingTemplate.nodes_json || []).length === 0 && (
                    <p className="text-sm text-[hsl(var(--color-ink-muted))]">{t("workflow.no_node_data")}</p>
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
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="px-4 py-2 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink-muted))]"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  if (confirmingTemplate) {
                    deleteMutation.mutate(String(confirmingTemplate.id));
                  }
                  setConfirmModalOpen(false);
                }}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.8)] text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {deleteMutation.isPending ? (t("common.deleting")) : (t("common.confirm_delete"))}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-[hsl(var(--color-ink))]">{t("workflow.delete_confirm_msg", { name: confirmingTemplate?.name || "" })}</p>
            <p className="text-sm text-[hsl(var(--color-status-error))]">{t("workflow.delete_irreversible")}</p>
          </div>
        </BaseModal>
      </div>
    </div>
  );
}
