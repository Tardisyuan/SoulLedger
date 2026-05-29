import { api } from "./client";

export interface ApprovalWorkflow {
  id: string;
  workflow_name: string;
  soul: string;
  soul_name?: string;
  case_type: string;
  priority: number;
  status: string;
  is_appeal: boolean;
  cross_civilization: boolean;
  judgment_verdict?: string;
  current_node?: string;
  current_node_detail?: ApprovalNode;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  nodes?: ApprovalNode[];
}

export interface ApprovalNode {
  id: string;
  workflow: string;
  node_name: string;
  node_type: string;
  court_code: string;
  node_order: number;
  approver_type: string;
  approver?: string;
  status: string;
  decision: string | null;
  verdict?: string | null;
  decided_at: string | null;
  notes: string;
}

export const workflowApi = {
  list: (params?: Record<string, string>) => api.get("/workflows/", { params }),
  get: (id: string) => api.get(`/workflows/${id}/`),
  create: (data: object) => api.post("/workflows/", data),
  advance: (id: string) => api.post(`/workflows/${id}/advance/`),
  approveNode: (workflowIdOrNodeId: string, nodeIdOrData: string | object, data?: object) => {
    if (typeof nodeIdOrData === "string") {
      return api.post(`/workflows/nodes/${nodeIdOrData}/approve/`, data);
    }
    return api.post(`/workflows/nodes/${workflowIdOrNodeId}/approve/`, nodeIdOrData);
  },
  templates: {
    list: (params?: Record<string, string>) => api.get("/workflows/templates/", { params }),
    get: (id: string) => api.get(`/workflows/templates/${id}/`),
    create: (data: object) => api.post("/workflows/templates/", data),
    update: (id: string, data: object) => api.patch(`/workflows/templates/${id}/`, data),
    delete: (id: string) => api.delete(`/workflows/templates/${id}/`),
  },
};
