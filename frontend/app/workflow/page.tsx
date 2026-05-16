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
import Link from "next/link";
import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";
import { BaseModal } from "@/src/components/ui/Modal";

// Custom node component for workflow visualization
function WorkflowNodeComponent({ data }: { data: { label: string; status: string; nodeType: string; courtCode: string } }) {
  const statusColors: Record<string, string> = {
    PENDING: "bg-amber-500/20 border-amber-500/50",
    APPROVED: "bg-green-500/20 border-green-500/50",
    REJECTED: "bg-red-500/20 border-red-500/50",
    SKIPPED: "bg-gray-500/20 border-gray-500/50",
    ESCALATED: "bg-purple-500/20 border-purple-500/50",
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

// Workflow templates by civilization and case type
const WORKFLOW_TEMPLATES = {
  // ========== 中国地府 ==========
  // 常规审判 - 十殿完整流程
  CHINESE_ROUTINE: {
    civilization: "CHINESE",
    caseType: "ROUTINE",
    name: "十殿审判流程",
    description: "完整十殿审判，根据罪行裁定轮回",
    nodes: [
      { id: "n1", name: "秦广王 · 分流", court: "第一殿", type: "分流", order: 1 },
      { id: "n2", name: "楚江王 · 初审", court: "第二殿", type: "初审", order: 2 },
      { id: "n3", name: "宋帝王 · 二审", court: "第三殿", type: "二审", order: 3 },
      { id: "n4", name: "五官王 · 三审", court: "第四殿", type: "三审", order: 4 },
      { id: "n5", name: "阎罗王 · 四审", court: "第五殿", type: "四审", order: 5 },
      { id: "n6", name: "卞城王 · 五审", court: "第六殿", type: "五审", order: 6 },
      { id: "n7", name: "泰山王 · 六审", court: "第七殿", type: "六审", order: 7 },
      { id: "n8", name: "都市王 · 七审", court: "第八殿", type: "七审", order: 8 },
      { id: "n9", name: "平等王 · 八审", court: "第九殿", type: "八审", order: 9 },
      { id: "n10", name: "转轮王 · 终审", court: "第十殿", type: "终审", order: 10 },
    ],
  },
  // 申诉流程 - 本殿→上一殿→酆都大帝
  CHINESE_APPEAL: {
    civilization: "CHINESE",
    caseType: "APPEAL",
    name: "申诉审判流程",
    description: "察查司审核 → 原殿复核 → 上级殿 → 酆都大帝终审",
    nodes: [
      { id: "n1", name: "魏征 · 察查司", court: "察查司", type: "申诉受理", order: 1 },
      { id: "n2", name: "原殿阎王 · 复核", court: "原审判殿", type: "原殿复核", order: 2 },
      { id: "n3", name: "上级殿阎王", court: "上一殿", type: "上级复核", order: 3 },
      { id: "n4", name: "酆都大帝 · 终审", court: "酆都", type: "终审", order: 4 },
    ],
  },
  // 跨域审判
  CHINESE_CROSS_REALM: {
    civilization: "CHINESE",
    caseType: "CROSS_REALM",
    name: "跨域审判流程",
    description: "涉及多地区协调的复杂案件",
    nodes: [
      { id: "n1", name: "案件分类", court: "第一殿", type: "分流", order: 1 },
      { id: "n2", name: "城隍初审", court: "城隍体系", type: "地方初审", order: 2 },
      { id: "n3", name: "十殿联审", court: "十殿", type: "联审", order: 3 },
      { id: "n4", name: "酆都大帝 · 终审", court: "酆都", type: "终审", order: 4 },
    ],
  },
  // 枉死城流程
  CHINESE_WANG_SI: {
    civilization: "CHINESE",
    caseType: "SPECIAL",
    name: "枉死城流程",
    description: "冤死灵魂申诉 → 城隍/地藏王处理",
    nodes: [
      { id: "n1", name: "枉死城登记", court: "枉死城", type: "登记", order: 1 },
      { id: "n2", name: "城隍申诉审理", court: "城隍", type: "申诉", order: 2 },
      { id: "n3", name: "地藏王超度", court: "九华山", type: "超度", order: 3 },
      { id: "n4", name: "寿数折抵", court: "枉死城", type: "等待", order: 4 },
    ],
  },
  // 阿鼻地狱 - 重大罪行直接入狱
  CHINESE_ABYSS: {
    civilization: "CHINESE",
    caseType: "SPECIAL",
    name: "阿鼻地狱流程",
    description: "五逆十恶直接入阿鼻地狱，永不轮回",
    nodes: [
      { id: "n1", name: "罪行核定", court: "第一殿", type: "罪行评定", order: 1 },
      { id: "n2", name: "阿鼻地狱入狱", court: "阿鼻地狱", type: "入狱执行", order: 2 },
    ],
  },
  // 直送轮回 - 大善人
  CHINESE_REINCARNATION: {
    civilization: "CHINESE",
    caseType: "ROUTINE",
    name: "直送轮回流程",
    description: "大善人(功德≥500)直接轮回",
    nodes: [
      { id: "n1", name: "功德核定", court: "第一殿", type: "分流", order: 1 },
      { id: "n2", name: "转轮王安排", court: "第十殿", type: "安排轮回", order: 2 },
    ],
  },

  // ========== 欧洲天堂地狱 ==========
  // 基督教末日审判
  EUROPEAN_LAST_JUDGMENT: {
    civilization: "EUROPEAN",
    caseType: "ROUTINE",
    name: "末日审判流程",
    description: "末日审判，灵魂分流至天堂/地狱/炼狱",
    nodes: [
      { id: "n1", name: "米迦勒称量灵魂", court: "审判庭", type: "初审判", order: 1 },
      { id: "n2", name: "四天使投票", court: "天堂", type: "投票", order: 2 },
      { id: "n3", name: "上帝 · 终审", court: "天堂", type: "终审", order: 3 },
    ],
  },
  // 希腊冥界三法官
  EUROPEAN_GREEK: {
    civilization: "EUROPEAN",
    caseType: "ROUTINE",
    name: "希腊冥界审判",
    description: "米诺斯、拉达曼迪斯、埃阿斯三法官审判",
    nodes: [
      { id: "n1", name: "米诺斯初审", court: "冥界", type: "初审", order: 1 },
      { id: "n2", name: "拉达曼迪斯复核", court: "冥界", type: "复核", order: 2 },
      { id: "n3", name: "埃阿斯终审", court: "冥界", type: "终审", order: 3 },
      { id: "n4", name: "分流执行", court: "冥界", type: "执行", order: 4 },
    ],
  },
  // 北欧分流 - 无统一审判所，按死亡类型分流
  EUROPEAN_NORDIC: {
    civilization: "EUROPEAN",
    caseType: "ROUTINE",
    name: "北欧灵魂分流",
    description: "按死亡类型分流至英灵殿/海姆冥界/纳斯特隆德",
    nodes: [
      { id: "n1", name: "死亡类型判定", court: "北欧", type: "分流", order: 1 },
      { id: "n2", name: "英灵殿遴选", court: "瓦尔哈拉", type: "英灵殿", order: 2 },
      { id: "n3", name: "海姆冥界", court: "海姆", type: "普通死亡", order: 3 },
    ],
  },
  // 地狱圈层审判 - 但丁神曲
  EUROPEAN_HELL: {
    civilization: "EUROPEAN",
    caseType: "SPECIAL",
    name: "地狱圈层流程",
    description: "根据罪行分配至九层地狱",
    nodes: [
      { id: "n1", name: "罪行分类", court: "地狱边境", type: "分类", order: 1 },
      { id: "n2", name: "但丁引导", court: "地狱第一层", type: "引导", order: 2 },
      { id: "n3", name: "各层处罚执行", court: "各层地狱", type: "执行", order: 3 },
    ],
  },

  // ========== 埃及冥界 ==========
  // 心脏称重 - 常规流程
  EGYPTIAN_WEIGHING: {
    civilization: "EGYPTIAN",
    caseType: "HEART_WEIGHING",
    name: "心脏称重仪式",
    description: "阿努比斯初审 → 四十二神祇陪审 → 欧西里斯终审",
    nodes: [
      { id: "n1", name: "阿努比斯初审", court: "杜阿特", type: "初审", order: 1 },
      { id: "n2", name: "四十二神祇陪审", court: "真理大厅", type: "陪审", order: 2 },
      { id: "n3", name: "欧西里斯终审", court: "真理大厅", type: "终审", order: 3 },
    ],
  },
  // 阿米特吞噬 - 称重失败
  EGYPTIAN_AMMIT: {
    civilization: "EGYPTIAN",
    caseType: "SPECIAL",
    name: "阿米特吞噬流程",
    description: "心脏比羽毛重，称重失败，被阿米特吞噬",
    nodes: [
      { id: "n1", name: "称重失败记录", court: "真理大厅", type: "记录", order: 1 },
      { id: "n2", name: "阿米特吞噬", court: "真理大厅", type: "执行", order: 2 },
    ],
  },
  // 杜阿特穿越 - 生前旅程
  EGYPTIAN_DUAT: {
    civilization: "EGYPTIAN",
    caseType: "ROUTINE",
    name: "杜阿特穿越流程",
    description: "穿越十二门，最终到达真理大厅",
    nodes: [
      { id: "n1", name: "第一门", court: "杜阿特", type: "穿越", order: 1 },
      { id: "n2", name: "中间各门", court: "杜阿特", type: "穿越", order: 2 },
      { id: "n3", name: "最终门", court: "杜阿特", type: "穿越", order: 3 },
      { id: "n4", name: "真理大厅", court: "真理大厅", type: "到达", order: 4 },
    ],
  },
  // 芦苇原接纳 - 通过审判后
  EGYPTIAN_AARU: {
    civilization: "EGYPTIAN",
    caseType: "ROUTINE",
    name: "芦苇原接纳流程",
    description: "通过审判后进入芦苇原，永生之地",
    nodes: [
      { id: "n1", name: "审判通过", court: "真理大厅", type: "确认", order: 1 },
      { id: "n2", name: "芦苇原接纳", court: "芦苇原", type: "接纳", order: 2 },
      { id: "n3", name: "永恒安息", court: "芦苇原", type: "安息", order: 3 },
    ],
  },
  // 神判流程 - 涉及神力
  EGYPTIAN_DIVINE: {
    civilization: "EGYPTIAN",
    caseType: "DIVINE_TRIAL",
    name: "神判流程",
    description: "托特神谕 → 九神会终审",
    nodes: [
      { id: "n1", name: "托特神谕", court: "真理大厅", type: "神谕", order: 1 },
      { id: "n2", name: "九神会审议", court: "赫利奥波利斯", type: "审议", order: 2 },
      { id: "n3", name: "终审裁决", court: "赫利奥波利斯", type: "终审", order: 3 },
    ],
  },
};

type TemplateKey = keyof typeof WORKFLOW_TEMPLATES;

const CIVILIZATION_LABELS: Record<string, string> = {
  CHINESE: "中国地府",
  EUROPEAN: "欧洲天堂地狱",
  EGYPTIAN: "埃及冥界",
};

const CIVILIZATION_DESCRIPTIONS: Record<string, string> = {
  CHINESE: "十殿阎王 · 城隍体系 · 枉死城",
  EUROPEAN: "末日审判 · 希腊三法官 · 北欧分流",
  EGYPTIAN: "心脏称重 · 阿米特吞噬 · 芦苇原",
};

const CASE_TYPE_LABELS: Record<string, string> = {
  ROUTINE: "常规审判",
  APPEAL: "申诉审判",
  CROSS_REALM: "跨域审判",
  SPECIAL: "特案审判",
  HEART_WEIGHING: "心脏称重",
  DIVINE_TRIAL: "神判",
  CANONIZATION: "封圣审查",
  PURGATORY_REVIEW: "炼狱复核",
  HERESY_TRIAL: "异端审判",
};

export default function WorkflowPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("CHINESE_ROUTINE");
  const [workflowInstance, setWorkflowInstance] = useState<ApprovalWorkflow | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateData, setEditingTemplateData] = useState<any>(null);
  const [viewingTemplate, setViewingTemplate] = useState<any>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmingTemplate, setConfirmingTemplate] = useState<any>(null);

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
  const templates = (templatesData?.results ?? templatesData ?? []) as any[];
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
  });

  const selectedCivilization = selectedTemplate.split("_")[0];
  const currentTemplate = WORKFLOW_TEMPLATES[selectedTemplate];

  // Build nodes and edges for React Flow
  const flowNodes = useMemo(() => {
    const nodesToRender = workflowInstance?.nodes?.length
      ? workflowInstance.nodes
      : currentTemplate?.nodes || [];

    return nodesToRender.map((n: any, idx: number) => ({
      id: n.id,
      type: "workflowNode",
      position: { x: 250, y: idx * 150 },
      data: {
        label: n.node_name || n.name,
        status: n.status || "PENDING",
        nodeType: n.node_type || n.type,
        courtCode: n.court_code || n.court,
      },
    }));
  }, [currentTemplate, workflowInstance]);

  const flowEdges = useMemo(() => {
    const nodesToRender = workflowInstance?.nodes?.length
      ? workflowInstance.nodes
      : currentTemplate?.nodes || [];

    return nodesToRender.slice(0, -1).map((n: any, idx: number) => {
      const nextNode = nodesToRender[idx + 1];
      return {
        id: `e${n.id}-${nextNode?.id}`,
        source: n.id,
        target: nextNode?.id,
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
    { key: "existing", label: "现有流程" },
    { key: "editor", label: "模板编辑器" },
    { key: "instances", label: t("workflow.instances") || "审批实例" },
  ] as const;
  const [tab, setTab] = useState<"existing" | "editor" | "instances">("existing");

  return (
    <div className="text-ink">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("workflow.title") || "审批流程"}
        </h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-hairline/50">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t.key
                  ? "text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent))]"
                  : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "existing" ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))]">流程模板</h2>
                <p className="text-sm text-[hsl(var(--color-ink-muted))]">选择模板进行编辑</p>
              </div>
              <button
                onClick={() => {
                  setEditingTemplateId(null);
                  setTab("editor");
                }}
                className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium transition-colors"
              >
                + 新建模板
              </button>
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
                    <div className="text-xs font-semibold text-[hsl(var(--color-ink-muted))] px-2">自定义模板</div>
                    {templates.map((tmpl: any) => (
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
                          {tmpl.civilization} · {CASE_TYPE_LABELS[tmpl.case_type] || tmpl.case_type}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* 预定义模板列表 */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-[hsl(var(--color-ink-muted))] px-2">预定义模板</div>
                  {Object.entries(templatesByCiv).map(([civ, civTemplates]) => (
                    <div key={civ} className="space-y-1">
                      <div className="text-xs text-[hsl(var(--color-accent))] px-2 py-1 font-medium">
                        {CIVILIZATION_LABELS[civ]}
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
                    {editingTemplateId && templates.find((t: any) => String(t.id) === editingTemplateId) && (() => {
                      const tmpl = templates.find((t: any) => String(t.id) === editingTemplateId);
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
                                  {CASE_TYPE_LABELS[tmpl.case_type] || tmpl.case_type}
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
                                查看
                              </button>
                              <button
                                onClick={() => {
                                  setEditingTemplateId(String(tmpl.id));
                                  setTab("editor");
                                }}
                                className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => {
                                  setConfirmingTemplate(tmpl);
                                  setConfirmModalOpen(true);
                                }}
                                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded text-sm font-medium"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">{tmpl.description || "无描述"}</p>
                          <div className="text-xs text-[hsl(var(--color-ink-subtle))] mb-3">
                            {(tmpl.nodes_json || []).length} 个节点
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto">
                            {(tmpl.nodes_json || []).map((node: any, idx: number) => (
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
                                {CASE_TYPE_LABELS[currentTemplate.caseType] || currentTemplate.caseType}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setViewingTemplate({
                                  ...currentTemplate,
                                  nodes_json: currentTemplate.nodes.map((n: any) => ({
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
                              查看
                            </button>
                            <button
                              onClick={() => {
                                setEditingTemplateData({
                                  name: currentTemplate.name,
                                  description: currentTemplate.description,
                                  civilization: currentTemplate.civilization,
                                  case_type: currentTemplate.caseType,
                                  nodes_json: currentTemplate.nodes.map((n: any) => ({
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
                              编辑
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-[hsl(var(--color-ink-muted))] mb-4">{currentTemplate.description}</p>
                        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mb-3">
                          {currentTemplate.nodes.length} 个节点
                        </div>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {currentTemplate.nodes.map((node: any, idx: number) => (
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
                    请从左侧选择一个模板
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
              <div className="text-center text-ink-subtle py-12">
                {t("workflow.no_instances") || "暂无审批实例"}
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
                            ? "bg-green-500/20 text-green-400"
                            : wf.status === "IN_PROGRESS"
                            ? "bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))]"
                            : "bg-surface-3 text-ink-muted"
                        }`}
                      >
                        {wf.status}
                      </span>
                      {wf.is_appeal && (
                        <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                          申诉
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
          title={viewingTemplate?.name || "模板详情"}
        >
          {viewingTemplate && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-[hsl(var(--color-ink-subtle))]">文明</span>
                  <p className="text-sm text-[hsl(var(--color-ink))] font-medium">{viewingTemplate.civilization}</p>
                </div>
                <div>
                  <span className="text-xs text-[hsl(var(--color-ink-subtle))]">案件类型</span>
                  <p className="text-sm text-[hsl(var(--color-ink))] font-medium">
                    {CASE_TYPE_LABELS[viewingTemplate.case_type] || CASE_TYPE_LABELS[viewingTemplate.caseType] || viewingTemplate.case_type || viewingTemplate.caseType || "无"}
                  </p>
                </div>
              </div>
              <div>
                <span className="text-xs text-[hsl(var(--color-ink-subtle))]">描述</span>
                <p className="text-sm text-[hsl(var(--color-ink))]">{viewingTemplate.description || "无"}</p>
              </div>
              <div>
                <span className="text-xs text-[hsl(var(--color-ink-subtle))]">节点列表</span>
                <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                  {(viewingTemplate.nodes_json || []).map((node: any, idx: number) => (
                    <div key={idx} className="bg-[hsl(var(--color-surface-3))] rounded p-2 text-sm">
                      <div className="font-medium text-[hsl(var(--color-ink))]">{node.node_name}</div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                        {node.court_code && <span>🏛 {node.court_code}</span>}
                        <span className="ml-2">类型: {node.node_type}</span>
                      </div>
                      {node.approver_role && (
                        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                          审批角色: {node.approver_role}
                        </div>
                      )}
                    </div>
                  ))}
                  {(viewingTemplate.nodes_json || []).length === 0 && (
                    <p className="text-sm text-[hsl(var(--color-ink-muted))]">暂无节点数据</p>
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
          title="确认删除"
          footer={
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="px-4 py-2 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink-muted))]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (confirmingTemplate) {
                    deleteMutation.mutate(String(confirmingTemplate.id));
                  }
                  setConfirmModalOpen(false);
                }}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {deleteMutation.isPending ? "删除中..." : "确认删除"}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-[hsl(var(--color-ink))]">确定要删除模板 <strong>"{confirmingTemplate?.name}"</strong> 吗？</p>
            <p className="text-sm text-red-400">此操作不可撤销，删除后无法恢复。</p>
          </div>
        </BaseModal>
      </div>
    </div>
  );
}
