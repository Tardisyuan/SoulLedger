"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
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
import { useI18n } from "@/src/contexts/I18nContext";
import { Modal } from "@/src/components/ui/Modal";
import { useToast } from "@/src/contexts/ToastContext";

export interface TemplateNode {
  id?: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  node_order: number;
}

export interface WorkflowTemplateInput {
  name: string;
  description: string;
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN";
  case_type: string;
  nodes: TemplateNode[];
}

// Custom editable node component
function EditableNodeComponent({
  data,
  selected,
}: {
  data: { label: string; nodeType: string; courtCode: string; approverRole: string; [key: string]: unknown };
  selected: boolean;
}) {
  const nodeTypeColors: Record<string, string> = {
    TRIAL: "border-[hsl(var(--color-accent))] bg-[hsl(var(--color-surface-3))]",
    EVALUATION: "border-blue-500 bg-[hsl(var(--color-surface-3))]",
    APPEAL: "border-purple-500 bg-[hsl(var(--color-surface-3))]",
    FINAL: "border-green-500 bg-[hsl(var(--color-surface-3))]",
    EXECUTION: "border-red-500 bg-[hsl(var(--color-surface-3))]",
  };

  const colorClass = nodeTypeColors[data.nodeType] || nodeTypeColors.TRIAL;

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 min-w-[180px] cursor-pointer transition-all ${
        selected ? "ring-2 ring-[hsl(var(--color-accent))] ring-offset-2 ring-offset-[hsl(var(--color-surface-2))]" : ""
      } ${colorClass}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-[hsl(var(--color-accent))]" />
      <div className="text-sm font-semibold text-[hsl(var(--color-ink))]">{data.label}</div>
      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">{data.nodeType}</div>
      {data.courtCode && (
        <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">🏛 {data.courtCode}</div>
      )}
      {data.approverRole && (
        <div className="text-xs text-[hsl(var(--color-ink-subtle))]">👤 {data.approverRole}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-[hsl(var(--color-accent))]" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  editableNode: EditableNodeComponent,
};

interface NodeEditData {
  id: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
}

// Node data stored in React Flow nodes (camelCase for data field)
interface NodeDataUpdates {
  label?: string;
  nodeType?: string;
  courtCode?: string;
  approverRole?: string;
  approverType?: string;
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

  // State
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesStateChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editData, setEditData] = useState<NodeEditData | null>(null);

  // Form state - initialized from query data
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateCiv, setTemplateCiv] = useState<"CHINESE" | "EUROPEAN" | "EGYPTIAN">("CHINESE");
  const [templateCaseType, setTemplateCaseType] = useState("ROUTINE");

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
      // Validate civilization value
      if (civ === "CHINESE" || civ === "EUROPEAN" || civ === "EGYPTIAN") {
        setTemplateCiv(civ);
      }
      setTemplateCaseType(existingTemplate.case_type || "ROUTINE");

      const flowNodes = (existingTemplate.nodes_json || []).map(
        (n: TemplateNode, idx: number) => ({
          id: n.id || `node-${idx}`,
          type: "editableNode",
          position: { x: 250, y: idx * 160 },
          data: {
            id: n.id || `node-${idx}`,
            label: n.node_name,
            nodeType: n.node_type,
            courtCode: n.court_code || "",
            approverRole: n.approver_role || "",
            approverType: n.approver_type,
          },
        })
      );

      const flowEdges = (existingTemplate.nodes_json || [])
        .filter((_: unknown, idx: number) => idx > 0)
        .map((n: TemplateNode, idx: number) => {
          const prevNode = existingTemplate.nodes_json[idx];
          return {
            id: `e${prevNode.id}-${n.id}`,
            source: prevNode.id || `node-${idx}`,
            target: n.id || `node-${idx + 1}`,
            markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
            style: { stroke: "#f59e0b", strokeWidth: 2 },
          };
        });

      setNodes(flowNodes);
      setEdges(flowEdges);
    }
  }, [existingTemplate, templateId, setNodes, setEdges]);

  // Handle initial template data (for predefined templates)
  useEffect(() => {
    if (!initRef.current && initialTemplateData && !templateId) {
      initRef.current = true;
      const civ = initialTemplateData.civilization;
      setTemplateName(initialTemplateData.name || initialTemplateData.templateName || "");
      setTemplateDescription(initialTemplateData.description || initialTemplateData.templateDescription || "");
      if (civ === "CHINESE" || civ === "EUROPEAN" || civ === "EGYPTIAN") {
        setTemplateCiv(civ);
      }
      setTemplateCaseType(initialTemplateData.case_type || initialTemplateData.caseType || "ROUTINE");

      const nodesData = initialTemplateData.nodes_json || initialTemplateData.nodes || [];
      const flowNodes = nodesData.map(
        (n: any, idx: number) => ({
          id: n.id || `node-${idx}`,
          type: "editableNode",
          position: { x: 250, y: idx * 160 },
          data: {
            id: n.id || `node-${idx}`,
            label: n.node_name || n.label || "",
            nodeType: n.node_type || n.nodeType || "TRIAL",
            courtCode: n.court_code || n.courtCode || "",
            approverRole: n.approver_role || n.approverRole || "",
            approverType: n.approver_type || n.approverType || "ROLE",
          },
        })
      );

      const flowEdges = nodesData
        .filter((_: unknown, idx: number) => idx > 0)
        .map((n: any, idx: number) => {
          const prevNode = nodesData[idx];
          return {
            id: `e${prevNode.id}-${n.id}`,
            source: prevNode.id || `node-${idx}`,
            target: n.id || `node-${idx + 1}`,
            markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
            style: { stroke: "#f59e0b", strokeWidth: 2 },
          };
        });

      setNodes(flowNodes);
      setEdges(flowEdges);
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
            markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
            style: { stroke: "#f59e0b", strokeWidth: 2 },
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
      nodes: getTemplateNodes(),
    };
    saveMutation.mutate(templateData);
  }, [templateName, templateDescription, templateCiv, templateCaseType, getTemplateNodes, saveMutation]);

  // Node type options
  const nodeTypeOptions = [
    { value: "TRIAL", label: t("workflow.node_type.trial") },
    { value: "EVALUATION", label: t("workflow.node_type.evaluation") },
    { value: "APPEAL", label: t("workflow.node_type.appeal") },
    { value: "FINAL", label: t("workflow.node_type.final") },
    { value: "EXECUTION", label: t("workflow.node_type.execution") },
  ];

  const approverTypeOptions = [
    { value: "ROLE", label: t("workflow.approver_types.ROLE") },
    { value: "ACTOR", label: t("workflow.approver_types.ACTOR") },
    { value: "SYSTEM", label: t("workflow.approver_types.SYSTEM") },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--color-surface-2))] rounded-lg">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-3 border-b border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))]">
        {/* Template info inputs */}
        <div className="flex-1 flex items-center gap-3">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("workflow.editor.template_name_placeholder")}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] placeholder:[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
          <select
            value={templateCiv}
            onChange={(e) => setTemplateCiv(e.target.value as typeof templateCiv)}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            <option value="CHINESE">{t("workflow.civilizations.CHINESE")}</option>
            <option value="EUROPEAN">{t("workflow.civilizations.EUROPEAN")}</option>
            <option value="EGYPTIAN">{t("workflow.civilizations.EGYPTIAN")}</option>
          </select>
          <select
            value={templateCaseType}
            onChange={(e) => setTemplateCaseType(e.target.value)}
            className="px-3 py-1.5 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-sm text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
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
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={addNode}
            className="px-3 py-1.5 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black text-sm font-medium rounded transition-colors"
          >
            + {t("workflow.editor.add_node")}
          </button>
          <button
            onClick={deleteSelectedNode}
            disabled={!selectedNodeId}
            className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium rounded border border-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("workflow.editor.delete_selected")}
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
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
            markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
            style: { stroke: "#f59e0b", strokeWidth: 2 },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls className="!bg-[hsl(var(--color-surface-1))] !border-[hsl(var(--color-hairline))] !rounded" />
          <Panel position="top-left" className="bg-[hsl(var(--color-surface-1))]/90 backdrop-blur px-3 py-2 rounded border border-[hsl(var(--color-hairline))] text-xs text-[hsl(var(--color-ink-muted))]">
            {t("workflow.editor.hint")}
          </Panel>
        </ReactFlow>
      </div>

      {/* Node edit modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={t("workflow.editor.edit_node")}
      >
        {editData && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.node_name")}</label>
              <input
                type="text"
                value={editData.node_name}
                onChange={(e) =>
                  setEditData({ ...editData, node_name: e.target.value })
                }
                className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.node_type")}</label>
              <select
                value={editData.node_type}
                onChange={(e) =>
                  setEditData({
                    ...editData,
                    node_type: e.target.value as NodeEditData["node_type"],
                  })
                }
                className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              >
                {nodeTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.court_code")}</label>
              <input
                type="text"
                value={editData.court_code}
                onChange={(e) =>
                  setEditData({ ...editData, court_code: e.target.value })
                }
                placeholder={t("workflow.editor.court_placeholder")}
                className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.approver_type")}</label>
              <select
                value={editData.approver_type}
                onChange={(e) =>
                  setEditData({
                    ...editData,
                    approver_type: e.target.value as NodeEditData["approver_type"],
                  })
                }
                className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              >
                {approverTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.approver_role")}</label>
              <input
                type="text"
                value={editData.approver_role}
                onChange={(e) =>
                  setEditData({ ...editData, approver_role: e.target.value })
                }
                placeholder={t("workflow.editor.approver_placeholder")}
                className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 bg-[hsl(var(--color-surface-3))] hover:bg-[hsl(var(--color-surface-4))] text-[hsl(var(--color-ink))] text-sm rounded transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  updateNodeData(editData.id, {
                    label: editData.node_name,
                    nodeType: editData.node_type,
                    courtCode: editData.court_code,
                    approverRole: editData.approver_role,
                    approverType: editData.approver_type,
                  });
                  setEditModalOpen(false);
                }}
                className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black text-sm font-medium rounded transition-colors"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
