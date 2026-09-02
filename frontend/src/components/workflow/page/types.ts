/**
 * app/workflow/page.tsx 的模板数据形状。原先长在那个页面文件里，它越过仓库
 * 500 行的上限之后搬到这里；四个 interface 逐字未改，只加了 `export`。
 *
 * 放在 `page/` 子目录里而不是 `src/components/workflow/` 根下，是为了跟同目录的
 * `WorkflowEditor.tsx`（画布编辑器，另一条改动线在动）分开：这一层的东西只服务
 * /workflow 这一个页面。
 */
import { type WorkflowTemplateNode } from "@soulledger/core/api";

// ── Types for template data ──────────────────────────────────────

// Node that can be rendered in React Flow - unified shape
export interface FlowNode {
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
export interface BackendTemplate {
  id: string | number;
  name: string;
  description?: string;
  civilization: string;
  case_type?: string;
  nodes_json?: FlowNode[];
}

// Frontend template node (from WORKFLOW_TEMPLATES)
export interface FrontendNode {
  id: string;
  name: string;
  court: string;
  type: string;
  order: number;
}

// Flexible template type for preview/display (handles both backend and frontend shapes)
export interface TemplatePreviewData {
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
