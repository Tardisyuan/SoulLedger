"use client";

import { useCallback, useState, useEffect, useId, useMemo, useRef } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Connection,
  addEdge,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi } from "@/lib/api";
import {
  CIVILIZATION_OPTIONS,
  isCivilizationOption,
  type CivilizationOption,
} from "@/src/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
// Both stay under src/components/workflow/ deliberately: xyflow renders
// `markerEnd` into a standalone <marker> defs tree where `hsl(var(--…))` does
// not resolve, so the literal hex values here are a ruled exception — and
// eslint.config.mjs's HEX_ALLOW grants it by PATH PREFIX. A file of this
// editor's moved anywhere else goes red on its first arrow colour.
import { nodeTypes } from "@/src/components/workflow/EditableNode";
import {
  NodeEditModal,
  type NodeDataUpdates,
  type NodeEditData,
} from "@/src/components/workflow/NodeEditModal";
import { useToast } from "@/src/contexts/ToastContext";
import {
  edgeArrow,
  presetTemplateToFlow,
  savedTemplateToFlow,
  type TemplateNode,
} from "@/src/components/workflow/workflowEditorGraph";

// Re-exported, not relocated as far as callers are concerned: `TemplateNode`
// has been part of this module's surface since before the split.
export type { TemplateNode };

export interface WorkflowTemplateInput {
  name: string;
  description: string;
  civilization: CivilizationOption;
  case_type: string;
  /**
   * 本模板默认的急缓：0=普通, 1=紧急, 2=危急。对应后端
   * `WorkflowTemplate.priority`，是 `ApprovalWorkflow.priority` 的默认值——
   * 建流程时调用方没有显式指定，就落到这个值。
   *
   * 它必须在 POST 的 body 里，否则 DRF 会把这个键**静默丢掉**并照样答 201：
   * 预设里写着 `priority: 1` 的三套「紧急审判流程」会存成 0，而没有任何地方
   * 会报错。
   */
  priority: number;
  nodes: TemplateNode[];
}

export default function WorkflowEditor({
  templateId,
  initialTemplateData,
  onClose,
  onSave,
}: {
  templateId?: string;
  initialTemplateData?: any;
  onClose?: () => void;
  onSave?: (template: WorkflowTemplateInput) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Unique prefix so field ids never collide across multiple
  // WorkflowEditor instances mounted at once.
  const formId = useId();
  const templatePriorityId = `${formId}-template-priority`;

  // State
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesStateChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editData, setEditData] = useState<NodeEditData | null>(null);

  // Form state - initialized from query data
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  // GREEK is in the union because `GREEK_ROUTINE` is one of the presets this
  // editor can be opened with. The two guards below only call `setTemplateCiv`
  // for a value they recognise and otherwise leave the state at its "CHINESE"
  // default — so omitting a civilization here does not fail, it silently
  // relabels somebody else's flow, and saving would file Aeacus, Rhadamanthus
  // and Plato's Minos under the Chinese ten courts.
  const [templateCiv, setTemplateCiv] = useState<CivilizationOption>("CHINESE");
  const [templateCaseType, setTemplateCaseType] = useState("ROUTINE");
  // 0=普通 by default, the same floor the model column has.
  const [templatePriority, setTemplatePriority] = useState(0);

  // Load existing template if editing
  const { data: existingTemplate } = useQuery({
    queryKey: ["workflow-template", templateId],
    queryFn: async () => {
      const res = await workflowApi.templates.get(templateId!);
      return res.data;
    },
    enabled: !!templateId,
  });

  // Populate form when template loads - use ref to track initialization
  const initRef = useRef(false);

  // Reset init flag when templateId changes
  useEffect(() => {
    initRef.current = false;
  }, [templateId]);

  // Populate form when template loads or templateId changes
  useEffect(() => {
    if (!initRef.current && existingTemplate) {
      initRef.current = true;
      const civ = existingTemplate.civilization;
      setTemplateName(existingTemplate.name || "");
      setTemplateDescription(existingTemplate.description || "");
      // Validate civilization value against the one list, not a hand-written
      // or-chain: an unrecognised value leaves the state at its "CHINESE"
      // default, so a member missing from the check is a silent relabelling.
      if (isCivilizationOption(civ)) {
        setTemplateCiv(civ);
      }
      setTemplateCaseType(existingTemplate.case_type || "ROUTINE");
      // `?? 0`, not `|| 0`: they agree today, but `||` would also swallow a
      // genuine 0 if the scale ever grew a falsy member, and reading a stored
      // priority is exactly the place a silent 0 costs the most.
      setTemplatePriority(existingTemplate.priority ?? 0);

      const flow = savedTemplateToFlow(existingTemplate.nodes || []);
      setNodes(flow.nodes);
      setEdges(flow.edges);
    }
  }, [existingTemplate, templateId, setNodes, setEdges]);

  // Handle initial template data (for predefined templates)
  useEffect(() => {
    if (!initRef.current && initialTemplateData && !templateId) {
      initRef.current = true;
      const civ = initialTemplateData.civilization;
      setTemplateName(initialTemplateData.name || initialTemplateData.templateName || "");
      setTemplateDescription(initialTemplateData.description || initialTemplateData.templateDescription || "");
      if (isCivilizationOption(civ)) {
        setTemplateCiv(civ);
      }
      setTemplateCaseType(initialTemplateData.case_type || initialTemplateData.caseType || "ROUTINE");
      // The preset's own default urgency — `priority: 1` on the three
      // 紧急审判流程 presets. Without this line the editor would open them at 0
      // and save them back at 0, which is the value the whole column exists to
      // stop being the only expressible one.
      setTemplatePriority(initialTemplateData.priority ?? 0);

      const nodesData = initialTemplateData.nodes_json || initialTemplateData.nodes || [];
      const flow = presetTemplateToFlow(nodesData);
      setNodes(flow.nodes);
      setEdges(flow.edges);
    }
  }, [initialTemplateData, templateId, setNodes, setEdges]);

  // Convert React Flow nodes to template nodes
  const getTemplateNodes = useCallback((): TemplateNode[] => {
    return nodes.map((n, idx) => ({
      id: n.id,
      node_name: n.data.label as string,
      node_type: n.data.nodeType as TemplateNode["node_type"],
      court_code: (n.data.courtCode as string) || "",
      approver_role: (n.data.approverRole as string) || "",
      approver_type: (n.data.approverType as TemplateNode["approver_type"]) || "ROLE",
      node_order: idx + 1,
    }));
  }, [nodes]);

  // Save template mutation
  const saveMutation = useMutation({
    mutationFn: async (data: WorkflowTemplateInput) => {
      if (templateId) {
        const res = await workflowApi.templates.update(templateId, data);
        return res.data;
      } else {
        const res = await workflowApi.templates.create(data);
        return res.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
      showToast(t("workflow.editor.saved"), "success");
      onSave?.({
        name: templateName,
        description: templateDescription,
        civilization: templateCiv,
        case_type: templateCaseType,
        priority: templatePriority,
        nodes: getTemplateNodes(),
      });
    },
    onError: () => {
      showToast(t("workflow.editor.save_failed"), "error");
    },
  });

  // Add a new node
  const addNode = useCallback(() => {
    const newId = `node-${Date.now()}`;
    const newNode: Node = {
      id: newId,
      type: "editableNode",
      position: { x: 250, y: nodes.length * 160 + 80 },
      data: {
        id: newId,
        label: `${t("workflow.editor.new_node")} ${nodes.length + 1}`,
        nodeType: "TRIAL",
        courtCode: "",
        approverRole: "",
        approverType: "ROLE",
      },
    };

    // If there are existing nodes, create an edge from the last one
    const newEdges: Edge[] =
      nodes.length > 0
        ? [
            {
              id: `e${nodes[nodes.length - 1].id}-${newId}`,
              source: nodes[nodes.length - 1].id,
              target: newId,
              markerEnd: { type: MarkerType.ArrowClosed, color: "#d97706" },
              style: { stroke: "#d97706", strokeWidth: 2 },
            },
          ]
        : [];

    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => [...eds, ...newEdges]);
  }, [nodes, setNodes, setEdges]);

  // Delete selected node
  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;

    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, setNodes, setEdges]);

  // Handle node double-click to edit
  const handleNodeEdit = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      setEditData({
        id: nodeId,
        node_name: node.data.label as string,
        node_type: node.data.nodeType as NodeEditData["node_type"],
        court_code: (node.data.courtCode as string) || "",
        approver_role: (node.data.approverRole as string) || "",
        approver_type: (node.data.approverType as NodeEditData["approver_type"]) || "ROLE",
      });
      setEditModalOpen(true);
    }
  }, [nodes]);

  // Update node data
  const updateNodeData = useCallback(
    (nodeId: string, updates: NodeDataUpdates) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...updates } }
            : n
        )
      );
    },
    [setNodes]
  );

  // Handle connection changes
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            ...edgeArrow(),
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Handle node changes
  const onNodesChangeHandler = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);
      // Track selection
      const selectionChange = changes.find(
        (c) => c.type === "select"
      );
      if (selectionChange && "selected" in selectionChange) {
        const node = nodes.find((n) => n.id === (selectionChange as { id: string }).id);
        if (node) {
          setSelectedNodeId((selectionChange as { selected: boolean }).selected ? node.id : null);
        }
      }
    },
    [onNodesChange, nodes]
  );

  // Save template
  const handleSave = useCallback(() => {
    const templateData: WorkflowTemplateInput = {
      name: templateName,
      description: templateDescription,
      civilization: templateCiv,
      case_type: templateCaseType,
      priority: templatePriority,
      nodes: getTemplateNodes(),
    };
    saveMutation.mutate(templateData);
  }, [templateName, templateDescription, templateCiv, templateCaseType, templatePriority, getTemplateNodes, saveMutation]);

  // 三档急缓的文案复用 `workflow.detail.*`——`app/workflow/[id]/page.tsx` 用同一
  // 组键把 `ApprovalWorkflow.priority` 的 0/1/2 显示成普通/紧急/危急，三份 bundle
  // (en / zh-Hans / egy) 都已有这四个键。这里说的是同一根尺子的同一个刻度，新造一
  // 组平行文案会让同一个 1 在模板页和流程页读起来不一样。
  const priorityOptions = [
    { value: 0, label: t("workflow.detail.normal") },
    { value: 1, label: t("workflow.detail.urgent") },
    { value: 2, label: t("workflow.detail.critical") },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--color-surface-2))]">
      {/* Toolbar
       *
       * `overflow-x-auto` + `min-w-0`,与 `ui/PageShell.tsx` 的筛选栏同一个理由:
       * 这是一条不换行的 flex,而它装着名称输入、案件类型下拉、文明下拉、优先级
       * 下拉和两个按钮。窄屏放不下时,撑宽的不是工具栏而是**整个文档**,所有
       * `fixed inset-0` 的遮罩与弹窗都会跟着摊开,于是按钮「可见、可用」却点不动。
       *
       * 具体到这里:mobile-chrome 上「保存模板」被案件类型下拉挡住,E2E 稳定超时。
       * `min-w-0` 是必需的 —— flex 子项默认 `min-width:auto`,不加它 `flex-1`
       * 不会收缩,`overflow-x-auto` 也就永远没有可滚动的余量。 */}
      <div className="flex items-center gap-3 p-3 border-b border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] overflow-x-auto">
        {/* Template info inputs */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("workflow.editor.template_name_placeholder")}
            aria-label={t("workflow.editor.template_name_placeholder")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] placeholder:text-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
          <select
            value={templateCiv}
            onChange={(e) => setTemplateCiv(e.target.value as typeof templateCiv)}
            aria-label={t("workflow.editor.civilization_select_label") === "workflow.editor.civilization_select_label" ? "Civilization" : t("workflow.editor.civilization_select_label")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {/* Rendered from CIVILIZATION_OPTIONS so the dropdown cannot fall
                behind the union the state is typed with — three hand-written
                <option>s beside a four-member type is a value the editor can
                hold and the user can never pick back. */}
            {CIVILIZATION_OPTIONS.map((civ) => (
              <option key={civ} value={civ}>
                {t(`workflow.civilizations.${civ}`)}
              </option>
            ))}
          </select>
          <select
            value={templateCaseType}
            onChange={(e) => setTemplateCaseType(e.target.value)}
            aria-label={t("workflow.editor.case_type_select_label") === "workflow.editor.case_type_select_label" ? "Case Type" : t("workflow.editor.case_type_select_label")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            <option value="ROUTINE">{t("workflow.case_types.ROUTINE")}</option>
            <option value="APPEAL">{t("workflow.case_types.APPEAL")}</option>
            <option value="CROSS_REALM">{t("workflow.case_types.CROSS_REALM")}</option>
            <option value="SPECIAL">{t("workflow.case_types.SPECIAL")}</option>
            <option value="CANONIZATION">{t("workflow.case_types.CANONIZATION")}</option>
            <option value="PURGATORY_REVIEW">{t("workflow.case_types.PURGATORY_REVIEW")}</option>
            <option value="HERESY_TRIAL">{t("workflow.case_types.HERESY_TRIAL")}</option>
            <option value="HEART_WEIGHING">{t("workflow.case_types.HEART_WEIGHING")}</option>
            <option value="DIVINE_TRIAL">{t("workflow.case_types.DIVINE_TRIAL")}</option>
          </select>
          <select
            id={templatePriorityId}
            value={templatePriority}
            onChange={(e) => setTemplatePriority(Number(e.target.value))}
            aria-label={t("workflow.detail.priority")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={addNode}
            className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black text-03 font-medium transition-colors"
          >
            + {t("workflow.editor.add_node")}
          </button>
          <button
            onClick={deleteSelectedNode}
            disabled={!selectedNodeId}
            className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-03 font-medium border border-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("workflow.editor.delete_selected")}
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-03 font-medium transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? t("workflow.editor.saving") : t("workflow.editor.save_template")}
          </button>
        </div>
      </div>

      {/* Flow canvas */}
      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeHandler}
          onEdgesChange={onEdgesStateChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeDoubleClick={(_, node) => handleNodeEdit(node.id)}
          fitView
          className="bg-[hsl(var(--color-surface-2))]"
          defaultEdgeOptions={{
            ...edgeArrow(),
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls className="!bg-[hsl(var(--color-surface-1))] !border-[hsl(var(--color-hairline))] !" />
          <Panel position="top-left" className="bg-[hsl(var(--color-surface-1))]/90 backdrop-blur px-3 py-2 border border-[hsl(var(--color-hairline))] text-02 text-[hsl(var(--color-ink-muted))]">
            {t("workflow.editor.hint")}
          </Panel>
        </ReactFlow>
      </div>

      {/* Node edit modal */}
      <NodeEditModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        formId={formId}
        editData={editData}
        setEditData={setEditData}
        onSave={updateNodeData}
        t={t}
      />
    </div>
  );
}
