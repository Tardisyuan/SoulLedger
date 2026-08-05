import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * ApprovalWorkflowListSerializer (backend/apps/workflow/serializers.py:127) —
 * the element type of GET /workflows/. It carries ten fields and no more:
 * `updated_at`, `soul_name`, `nodes` and `current_node*` are detail-only, and
 * `updated_at` in particular was declared required on the single combined
 * type this file used to have.
 */
export interface ApprovalWorkflowListItem {
  id: string;
  workflow_name: string;
  soul: string;
  case_type: string;
  priority: number;
  status: string;
  is_appeal: boolean;
  cross_civilization: boolean;
  created_at: string;
  completed_at: string | null;
}

/** ApprovalWorkflowSerializer (serializers.py:91) — GET /workflows/{id}/. */
export interface ApprovalWorkflow extends ApprovalWorkflowListItem {
  judgment: string | null;
  judgment_verdict?: string | null;
  soul_name?: string;
  current_node?: string | null;
  current_node_detail?: ApprovalNode | null;
  original_workflow?: string | null;
  coordinating_realm?: string | null;
  notes?: string;
  nodes?: ApprovalNode[];
  updated_at: string;
  tenant?: number;
}

/**
 * ApprovalNodeSerializer (serializers.py:62).
 *
 * `decision` was declared required here and is not a serializer field — the
 * decision is carried by `verdict`.
 */
export interface ApprovalNode {
  id: string;
  workflow: string;
  node_name: string;
  node_type: string;
  court_code: string;
  node_order: number;
  approver_type: string;
  approver_actor?: string | null;
  approver_role?: string;
  realm?: string | null;
  required_verdicts?: number;
  evidence_json?: Record<string, unknown> | null;
  approver?: string | null;
  status: string;
  verdict?: string | null;
  decided_at: string | null;
  notes: string;
  created_at?: string;
}

/** One node of a WorkflowTemplate (serializers.py:9). */
export interface WorkflowTemplateNode {
  id?: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  node_order: number;
}

/** WorkflowTemplateListSerializer (serializers.py:47) — no `nodes`. */
export interface WorkflowTemplateListItem {
  id: string;
  name: string;
  description: string;
  civilization: string;
  case_type: string;
  is_active: boolean;
  created_at: string;
  /** How many nodes this template has — `len(nodes_json)` on the backend. */
  node_count: number;
  /**
   * Present only on a locally-built preview object for a not-yet-saved
   * predefined template (see app/workflow/page.tsx). A template fetched from
   * `GET /workflow/templates/` (this list endpoint) never carries it — the
   * list serializer omits the full node graph on purpose, so a per-row node
   * breakdown in the list is only available for predefined templates that
   * haven't round-tripped through the backend yet. `node_count` above is the
   * one fact every row — saved or predefined — actually has.
   */
  nodes_json?: WorkflowTemplateNode[];
}

/**
 * WorkflowTemplateSerializer (serializers.py:26) — the detail shape.
 *
 * The node array is exposed as `nodes`; `nodes_json` is only the underlying
 * model field name and never appears on the wire (`source='nodes_json'`).
 */
export interface WorkflowTemplate extends WorkflowTemplateListItem {
  nodes?: WorkflowTemplateNode[];
  updated_at: string;
  tenant?: number;
}

export const workflowApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<ApprovalWorkflowListItem>>("/workflows/", { params }),
  get: (id: string) => api.get<ApprovalWorkflow>(`/workflows/${id}/`),
  create: (data: object) => api.post<ApprovalWorkflow>("/workflows/", data),
  advance: (id: string) => api.post<ApprovalWorkflow>(`/workflows/${id}/advance/`),
  /**
   * ApprovalWorkflowViewSet.approve_node (backend/apps/workflow/views.py:190)
   * — a detail action on the *workflow*, not a route on ApprovalNodeViewSet.
   * The node being decided is identified by `node_id` in the POST body
   * (WorkflowNodeActionSerializer only validates `verdict`/`notes`; `node_id`
   * is read separately from `request.data`), not by a URL segment.
   */
  approveNode: (workflowId: string, nodeId: string, data: { verdict: string; notes?: string }) =>
    api.post<ApprovalWorkflow>(`/workflows/${workflowId}/approve_node/`, { node_id: nodeId, ...data }),
  templates: {
    // WorkflowTemplateViewSet is the one view in the project that sets
    // pagination_class = None (backend/apps/workflow/views.py:45), so this
    // list is a bare array while every other viewset list is enveloped.
    list: (params?: Record<string, string>) => api.get<WorkflowTemplateListItem[]>("/workflow/templates/", { params }),
    get: (id: string) => api.get<WorkflowTemplate>(`/workflow/templates/${id}/`),
    create: (data: object) => api.post<WorkflowTemplate>("/workflow/templates/", data),
    update: (id: string, data: object) => api.patch<WorkflowTemplate>(`/workflow/templates/${id}/`, data),
    delete: (id: string) => api.delete<void>(`/workflow/templates/${id}/`),
  },
};
