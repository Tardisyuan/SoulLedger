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
import { useQuery } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import Link from "next/link";
import WorkflowEditor from "@/src/components/workflow/WorkflowEditor";

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
      <Handle type="target" position={Position.Top} className="!bg-amber-500" />
      <div className="text-sm font-semibold text-ink">{data.label}</div>
      <div className="text-xs text-ink-muted mt-1">{data.nodeType}</div>
      {data.courtCode && (
        <div className="text-xs text-ink-subtle mt-1">{data.courtCode}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500" />
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

export default function WorkflowPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("CHINESE_ROUTINE");
  const [workflowInstance, setWorkflowInstance] = useState<ApprovalWorkflow | null>(null);

  const { data: workflowsData } = useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await workflowApi.list();
      return res.data;
    },
  });

  const workflows = (workflowsData?.results ?? workflowsData ?? []) as ApprovalWorkflow[];

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
        markerEnd: { type: MarkerType.ArrowClosed, color: "#d97706" },
        animated: workflowInstance?.current_node === n.id,
        style: { stroke: "#d97706", strokeWidth: 2 },
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
    { key: "template", label: t("workflow.template") || "流程模板" },
    { key: "editor", label: "模板编辑器" },
    { key: "instances", label: t("workflow.instances") || "审批实例" },
  ] as const;
  const [tab, setTab] = useState<"template" | "editor" | "instances">("template");

  return (
    <div className="text-ink">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-hairline/50">
        <Link href="/" className="text-ink-muted hover:text-ink text-sm">
          ← {t("nav.home")}
        </Link>
        <h1 className="text-lg font-bold text-amber-400 flex-1">
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
                  ? "text-amber-400 border-amber-400"
                  : "text-ink-muted border-transparent hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "template" ? (
          <>
            {/* Civilization + Template selector */}
            <div className="space-y-4 mb-6">
              {Object.entries(templatesByCiv).map(([civ, templates]) => (
                <div key={civ}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-amber-400">
                      {CIVILIZATION_LABELS[civ]}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {CIVILIZATION_DESCRIPTIONS[civ]}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((tmpl) => (
                      <button
                        key={tmpl.key}
                        onClick={() => {
                          setSelectedTemplate(tmpl.key);
                          setWorkflowInstance(null);
                        }}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                          selectedTemplate === tmpl.key
                            ? "bg-amber-500 text-black"
                            : "bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-3"
                        }`}
                        title={tmpl.description}
                      >
                        {tmpl.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Flow description */}
            <div className="mb-4 text-sm text-ink">
              <span className="font-medium">{currentTemplate?.name}</span>
              <span className="text-ink-muted ml-2">— {currentTemplate?.description}</span>
            </div>

            {/* React Flow canvas */}
            <div className="bg-surface-1 rounded-lg border border-hairline overflow-hidden">
              <div className="h-[500px]">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  nodeTypes={nodeTypes}
                  fitView
                  className="bg-surface-2"
                >
                  <Background />
                  <Controls className="!bg-surface-1 !border-hairline" />
                </ReactFlow>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-muted">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500/50" />
                <span>待审批</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/50" />
                <span>已批准</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-red-500/20 border border-red-500/50" />
                <span>已拒绝</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-gray-500/20 border border-gray-500/50" />
                <span>已跳过</span>
              </div>
            </div>
          </>
        ) : tab === "editor" ? (
          /* Editor tab */
          <div className="h-[calc(100vh-220px)]">
            <WorkflowEditor />
          </div>
        ) : (
          /* Instances tab */
          <div className="space-y-4">
            {workflows.length === 0 ? (
              <div className="text-center text-ink-subtle py-12">
                {t("workflow.no_instances") || "暂无审批实例"}
              </div>
            ) : (
              workflows.map((wf) => (
                <div
                  key={wf.id}
                  className="bg-surface-1 rounded-lg p-4 border border-hairline hover:border-amber-500/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/workflow/${wf.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-ink">{wf.workflow_name}</div>
                      <div className="text-xs text-ink-muted mt-1">
                        {wf.case_type} · {wf.soul}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          wf.status === "COMPLETED"
                            ? "bg-green-500/20 text-green-400"
                            : wf.status === "IN_PROGRESS"
                            ? "bg-amber-500/20 text-amber-400"
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
      </div>
    </div>
  );
}
