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
  /** Primary key. Not a name -- see `soul_name`. */
  soul: string;
  /** Added to the list serializer 2026-08-30. The list row printed `soul`
   *  (a UUID) as though it were the soul's name; the dispatch list serializer
   *  beside it had always sent this field. */
  soul_name?: string;
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
  current_node?: string | null;
  current_node_detail?: ApprovalNode | null;
  original_workflow?: string | null;
  coordinating_realm?: string | null;
  notes?: string;
  nodes?: ApprovalNode[];
  updated_at: string;
  tenant?: number;
  /** Which published template version this workflow runs on; null for a built-in flow. */
  template_version_number?: number | null;
  /** How many times 驳回到 sent it back (capped at 3). */
  return_count?: number;
  /** "RETURN_LIMIT" when a FAIL would have exceeded the cap; "" otherwise. */
  end_reason?: string;
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
  /**
   * The deciding user's **integer primary key**, or null.
   *
   * WAS `string | null`. `ApprovalNode.approver` is a `ForeignKey` to
   * `authentication.User` (`on_delete=SET_NULL, null=True`), serialised as the
   * pk. Same finding as `DispatchRecord.dispatched_by`, same consequence:
   * `app/workflow/[id]/page.tsx:553` and
   * `src/components/workflow/detail/WorkflowNodeHistory.tsx:59` both render
   * `{node.approver}` straight into the "approver" line, so a decided node
   * shows a number where a person should be. Both render sites are out of
   * scope here; the type is now correct and the defect is no longer disguised.
   */
  approver?: number | null;
  /**
   * Added 2026-09-24, the backend fix the two render sites above were waiting
   * for. `approver.username` (the recoverable identifier) and
   * `approver.display_name` (may be `""` — the column is blank-able). Both null
   * while the node is undecided or the account is gone.
   */
  approver_username?: string | null;
  approver_display_name?: string | null;
  status: string;
  verdict?: string | null;
  decided_at: string | null;
  notes: string;
  created_at?: string;
  kind?: WorkflowNodeKind;
  /** Decisions a 驳回到 re-opened, and timeout events, oldest first. */
  decision_history?: Record<string, unknown>[];
  signatures_json?: { signer: number; user_name: string; verdict: string; passed: boolean; at: string }[];
  timeout_hours?: number | null;
  timeout_action?: WorkflowTimeoutAction | "";
}

/** What a node does (`NodeKind`, backend/apps/workflow/models.py). Absent reads as APPROVAL. */
export type WorkflowNodeKind = "APPROVAL" | "COUNTERSIGN" | "NOTIFY" | "END";

/** What a per-node timeout does (`TimeoutAction`). Fires when the scheduled job `workflow.process_timeouts_for_tenant` (every 5 min) or `process_workflow_timeouts` runs. */
export type WorkflowTimeoutAction = "ESCALATE" | "AUTO_REJECT" | "NOTIFY";

/**
 * A condition clause (`apps/workflow/conditions.py`): a whitelisted case fact
 * compared to a constant. Declarative — nothing is parsed or evaluated as code.
 * `balance` takes an integer and lt/lte/gt/gte/eq; `civilization` and `verdict`
 * take a non-empty list of members and in/not_in.
 */
export type ConditionFact = "balance" | "civilization" | "verdict";
export type ConditionOp = "lt" | "lte" | "gt" | "gte" | "eq" | "in" | "not_in";
export interface ConditionClause {
  fact: ConditionFact;
  op: ConditionOp;
  value: number | string[];
}

/** A PASS branch: taken when every clause holds; tried before `on_pass`. */
export interface TemplateBranch {
  id?: string;
  when: ConditionClause[];
  /** Template-local id of the target node. */
  target: string;
}

/** A 会签 signer, spelled like a one-person node (label probed for a name, or a ROLE). */
export interface TemplateSigner {
  label: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  approver_role: string;
}

/** One node of a WorkflowTemplate (serializers.py `WorkflowTemplateNodeSerializer`). */
export interface WorkflowTemplateNode {
  id?: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  node_order: number;
  on_pass?: string | null;
  on_fail?: string | null;
  position?: { x: number; y: number } | null;
  /** 驳回到: template-local id of an EARLIER node the flow returns to on FAIL. */
  reject_to?: string | null;
  timeout_hours?: number | null;
  timeout_action?: WorkflowTimeoutAction | "" | null;
  timeout_role?: string | null;
  kind?: WorkflowNodeKind;
  signers?: TemplateSigner[];
  /** 会签: approvals needed to pass; null means all signers. */
  threshold?: number | null;
  branches?: TemplateBranch[];
}

/** WorkflowTemplateListSerializer (serializers.py:47) — no `nodes`. */
export interface WorkflowTemplateListItem {
  id: string;
  name: string;
  description: string;
  civilization: string;
  case_type: string;
  /**
   * The template's default urgency — 0=normal, 1=urgent, 2=critical, the same
   * scale as `ApprovalWorkflow.priority`, which is what it is a default for.
   * On both serializers (list *and* detail) because the list screen is where a
   * template is picked.
   */
  priority: number;
  is_active: boolean;
  created_at: string;
  /** How many nodes this template has — `len(nodes_json)` on the backend. */
  node_count: number;
  /** The published version's number (0018); null for a template never published. */
  published_version?: number | null;
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
  /**
   * The WORKING COPY: the draft when there is one, else the published graph.
   * A save writes `nodes` into the draft; only `publish` puts it into service.
   */
  nodes?: WorkflowTemplateNode[];
  published_version: number | null;
  /** The open draft's number, or null when the working copy is the published graph. */
  draft_version: number | null;
  updated_at: string;
  tenant?: number;
}

/** GET /workflow/templates/{id}/versions/ — read-only history, newest first. */
export interface WorkflowTemplateVersion {
  id: string;
  number: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  nodes: WorkflowTemplateNode[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
  saved_by_name: string | null;
  published_by_name: string | null;
}

/** One resolved designation, names and roles only (`apps/workflow/preview.py`). */
export interface ApproverAssignment {
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  actor: { name: string; name_zh: string; role: string } | null;
  role: string | null;
  /** A sample of at most 10 accounts; `user_count` is exact. */
  users: { display_name: string; role: string }[];
  user_count: number;
}

/** GET /workflow/templates/{id}/approver-preview/?node=… */
export interface ApproverPreview extends ApproverAssignment {
  node: string;
  civilization: string;
  tenant: string;
  kind: WorkflowNodeKind;
  /** 会签 only: each signer as `_resolve_approver` resolves it. */
  signers: (ApproverAssignment & { label: string })[];
}

/** One validation issue as `POST publish/` reports it (`apps/workflow/validation.py`). */
export interface TemplateValidationIssue {
  node: string;
  code: string;
  [detail: string]: unknown;
}

/** `CaseType.REBIRTH_APPLICATION` — a soul's rebirth application (backend/apps/soul_accounts/rebirth.py). */
export const REBIRTH_APPLICATION_CASE_TYPE = "REBIRTH_APPLICATION";

/** The cap on `rejection_reason_for_soul` (WorkflowNodeActionSerializer, max_length=2000). */
export const REJECTION_REASON_FOR_SOUL_MAX = 2000;

/**
 * Whether a node decision needs `rejection_reason_for_soul`: the workflow is a
 * rebirth application (by its `case_type`, never its name) and a verdict is
 * chosen that is not PASSED / CONFIRMED — `complete_node` treats every other
 * verdict as a rejection. Mirrors `rebirth.requires_reason_for_soul`; the
 * backend still decides, with a 400 `error="rejection_reason_for_soul is required"`.
 */
export function requiresReasonForSoul(caseType: string | null | undefined, verdict: string): boolean {
  return caseType === REBIRTH_APPLICATION_CASE_TYPE && verdict !== "" && verdict !== "PASSED" && verdict !== "CONFIRMED";
}

export const workflowApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<ApprovalWorkflowListItem>>("/workflows/", { params }),
  get: (id: string) => api.get<ApprovalWorkflow>(`/workflows/${id}/`),
  create: (data: object) => api.post<ApprovalWorkflow>("/workflows/", data),
  advance: (id: string) => api.post<ApprovalWorkflow>(`/workflows/${id}/advance/`),
  /**
   * ApprovalWorkflowViewSet.escalate — 越级推进,`workflow.escalate` 码名。
   *
   * 这个方法此前**不存在**。`ROLE_PERMISSIONS` 把 `workflow.escalate` 写成
   * 「realm lead 越过停滞流程的唯一正途」,并为此刻意**不**给 MODERATOR
   * approve/advance —— 而那条正途在界面上一个入口都没有。实拍:
   *
   *   [wf-detail MODERATOR] 可见控件 = [导航, 返回审批列表, 节点(1), 历史]
   *   [wf-detail JUDGE    ] = [… 提交决定, 推进 …]
   *
   * `reason` 是必填的,后端也这么要求:越级留痕是这条路径存在的全部意义,
   * 没有理由的越级和 advance 没有区别。
   */
  escalate: (id: string, data: { reason: string }) =>
    api.post<ApprovalWorkflow>(`/workflows/${id}/escalate/`, data),
  /**
   * ApprovalWorkflowViewSet.approve_node (backend/apps/workflow/views.py:190)
   * — a detail action on the *workflow*, not a route on ApprovalNodeViewSet.
   * The node being decided is identified by `node_id` in the POST body
   * (WorkflowNodeActionSerializer only validates `verdict`/`notes`; `node_id`
   * is read separately from `request.data`), not by a URL segment.
   */
  approveNode: (
    workflowId: string,
    nodeId: string,
    data: { verdict: string; notes?: string; rejection_reason_for_soul?: string }
  ) => api.post<ApprovalWorkflow>(`/workflows/${workflowId}/approve_node/`, { node_id: nodeId, ...data }),
  templates: {
    // WorkflowTemplateViewSet is the one view in the project that sets
    // pagination_class = None (backend/apps/workflow/views.py:45), so this
    // list is a bare array while every other viewset list is enveloped.
    list: (params?: Record<string, string>) => api.get<WorkflowTemplateListItem[]>("/workflow/templates/", { params }),
    get: (id: string) => api.get<WorkflowTemplate>(`/workflow/templates/${id}/`),
    create: (data: object) => api.post<WorkflowTemplate>("/workflow/templates/", data),
    update: (id: string, data: object) => api.patch<WorkflowTemplate>(`/workflow/templates/${id}/`, data),
    delete: (id: string) => api.delete<void>(`/workflow/templates/${id}/`),
    /**
     * Put the draft into service. 400 `{error: "no_draft"}` or
     * `{error: "invalid_draft", issues: TemplateValidationIssue[]}`.
     */
    publish: (id: string) => api.post<WorkflowTemplate>(`/workflow/templates/${id}/publish/`),
    versions: (id: string) => api.get<WorkflowTemplateVersion[]>(`/workflow/templates/${id}/versions/`),
    /** Read-only: who `_resolve_approver` would assign, for a node of the working copy. */
    approverPreview: (id: string, params: { node: string; civilization?: string; tenant?: string }) =>
      api.get<ApproverPreview>(`/workflow/templates/${id}/approver-preview/`, { params }),
  },
};
