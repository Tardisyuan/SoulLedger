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
  /** 审批编号(`WF-0582`,全局一个序列,创建时发、永不改)。给人读的名字;`id` 仍是路由与 API 的身份。 */
  number?: string;
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
  /** 当前节点已过它的超时时限(「已超时」徽标);服务端算,与 `?overdue=` 筛选同一口径。 */
  is_overdue?: boolean;
  created_at: string;
  completed_at: string | null;
}

/** ApprovalWorkflowSerializer (serializers.py:91) — GET /workflows/{id}/. */
export interface ApprovalWorkflow extends ApprovalWorkflowListItem {
  judgment: string | null;
  judgment_verdict?: string | null;
  /** 所属审判的案号;没挂审判是 null。 */
  judgment_case_number?: string | null;
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
  /** "RETURN_LIMIT" when a FAIL would have exceeded the cap; "SOUL_DEVOURED" when the soul of an appeal flow was devoured by Ammit; "CROSS_CANCELLED" when cancelling the merged
   *  cross-realm judgment ended it; "BRANCH_SKIPPED" when the branch the case selects led to a station picked away;
   *  "CASE_REOPENED" when the appealed judgment's own flow was refused and the case opened again; "" otherwise. */
  end_reason?: string;
  /** 第四十三批: one row per realm (order 1 = this realm); empty for a workflow built before segments. */
  segments?: WorkflowSegment[];
  /** The segment the flow stands at the gate of, waiting for that realm to pick; null otherwise. */
  awaiting_segment?: number | null;
  /** 选站 / 加减站 records, oldest first (W-3a history tab). */
  history?: WorkflowHistoryEntry[];
  /** The requester may change stations now (加减站 entry, W-3b). */
  can_adjust?: boolean;
  /** The requester may decide the current node now: workflow.approve, the node designates them, and it is the current stop (rbac-web M-6). */
  can_approve?: boolean;
  /** The cross-realm judgment this workflow merged, if any. */
  cross_judgment_id?: string | null;
  /** The soul's appeal escalated to this APPEAL workflow (2026-10-27); null otherwise. */
  judgment_appeal?: { id: string; case_number: string; round: number; status: string } | null;
}

/** `WorkflowSegment.state` as shown: AWAITING_PICK / PICKED (not started) / RUNNING / DONE / SKIPPED. */
export type WorkflowSegmentState = "AWAITING_PICK" | "PICKED" | "RUNNING" | "DONE" | "SKIPPED";

/** WorkflowSegmentSerializer (backend/apps/workflow/serializers.py) — one realm's run of stations. */
export interface WorkflowSegment {
  order: number;
  is_local: boolean;
  tenant_code: string;
  realm_name: string;
  civilization: string;
  name: string;
  state: WorkflowSegmentState;
  /** Stations that run / all of the segment's stations. */
  go: number;
  total: number;
  default_node_count: number;
  /** Send back with pick / adjust; another change since answers 409 `segment_changed`. */
  version: number;
  picked_at: string | null;
  /** Null for another realm's segment (外域人员信息不外露). */
  picked_by_name: string | null;
  at_gate: boolean;
  /** 「第 N 天」at the gate; day 1 is the day the flow arrived. */
  gate_days: number | null;
  /** The realm has no judge who can pick (the task went to its hall admins). */
  no_picker: boolean;
  current_order_in_segment: number | null;
  can_pick: boolean;
  can_use_default: boolean;
  can_remind: boolean;
}

export interface WorkflowHistoryEntry {
  kind: "picked" | "adjusted" | "default";
  segment: number | null;
  /** Tenant code of the segment's realm. */
  realm: string;
  /** Null for another realm's officer. */
  actor: string | null;
  at: string;
  restored: string[];
  skipped: string[];
  reason: string;
}

/** Why a station was skipped by a person; null when the engine skipped it by routing. */
export type WorkflowSkipKind = "AT_PICK" | "LATER" | "CANCELLED";

/** The refusal codes of pick / adjust / use-default / remind (`segments.SegmentRefused`). */
export type WorkflowSegmentRefusal =
  | "segment_changed"
  | "final_required"
  | "jump_target_required"
  | "unknown_node"
  | "not_allowed"
  | "not_foreign"
  | "segment_closed"
  | "segment_started"
  | "segment_done"
  | "not_picked"
  | "not_awaiting"
  | "node_locked"
  | "node_changed"
  | "one_segment"
  | "nothing_to_change"
  | "conflicting_change"
  | "reason_required"
  | "too_early"
  | "remind_too_soon"
  | "workflow_closed";

/** FlowPreviewSerializer (backend/apps/workflow/serializers.py) — `GET /workflows/flow-preview/`. */
export interface FlowPreviewStation {
  /** The station's order; an unticked one goes into `skip_node_orders` by this number. */
  node_order: number;
  node_name: string;
  court_code: string;
  /** A named officer, or the one person a role resolves to; null when a role has several. */
  approver: string | null;
  /** The role member when the station goes to a role (translated by the client). */
  approver_role: string | null;
  /** The final review: it cannot be skipped. */
  is_required: boolean;
  /** Stations whose rejection jumps here (`on_fail`); `key` is their `node_order` as a string. */
  jump_target_of?: JumpSource[];
}

/**
 * A station whose rejection jumps to this one (`JumpSourceSerializer`, 2026-10-19). `key` is what the client sends
 * back for that station: its `node_order` before the flow exists (flow preview), its node id after. While any of
 * them still runs this station cannot be skipped (400 `jump_target_required`).
 */
export interface JumpSource {
  key: string;
  node_name: string;
  /** 第四十五批:`branch` = 条件分支的去处(按出身地域分流),`on_fail` = 驳回转来。老后端没有时按驳回读。 */
  via?: "on_fail" | "branch";
}

export interface FlowPreview {
  name: string;
  stations: FlowPreviewStation[];
  /** Realms that follow in cross-realm judgment order; their own judges pick their stations. */
  foreign: {
    order: number;
    tenant_code: string;
    realm_name: string;
    default_node_count: number;
    /** That realm's default flow has nothing to skip: its segment starts PICKED (第四十五批). */
    nothing_to_pick?: boolean;
  }[];
  /** No station can be skipped (final, automatic, or a locked jump / branch target): skip the picking step. */
  nothing_to_pick?: boolean;
}

/** CrossJudgmentWorkflowSummarySerializer — the progress line on the cross-realm judgment page (W-4). */
export interface CrossJudgmentWorkflowSummary {
  id: string;
  number: string;
  status: string;
  at: { segment: number; realm_name: string; node_name: string; hall: string } | null;
  at_gate: { segment: number; realm_name: string; days: number | null } | null;
  /** Stations to run in the segments already picked. */
  fixed: number;
  done: number;
  pending_realms: string[];
  segments: WorkflowSegment[];
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
  /** The verdicts this node accepts; `[]` = no constraint. WAS `number` -- the backend has always sent a list
   *  (JSONField), so the countersign progress printed 「1 / PASSED,FAILED」, or 「1 / 」 for `[]` (2026-10-23). */
  required_verdicts?: string[];
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
  /** 会签: the signers (user ids) and how many passing signatures close the node; `threshold` null = all of them. */
  signers_json?: unknown[];
  threshold?: number | null;
  /** 加签: the colleagues the designated approver added to this node, and whether each has signed. */
  cosigners?: { user_id: number; name: string; signed: boolean }[];
  /**
   * 加签: set (for the requester) while an added signer owes a signature that holds back the requester's
   * own approval -- `approve_node` would answer 409 `cosigners_pending`. A refusal is never held.
   */
  waiting_on_cosigner?: { id: number; name: string } | null;
  timeout_hours?: number | null;
  timeout_action?: WorkflowTimeoutAction | "";
  /** 第四十三批: the realm's segment (its order) and this station's number inside it; null before segments. */
  segment_order?: number | null;
  order_in_segment?: number | null;
  skip_kind?: WorkflowSkipKind | null;
  skip_reason?: string;
  /** The segment's final review: no pick or adjust may skip it. */
  is_required?: boolean;
  /** Stations of this segment whose rejection jumps here (`on_fail`); `key` is their node id. */
  jump_target_of?: JumpSource[];
  /** Condition branches (instantiated: `target` is a node id) — the 自动分流 step routes by them (第四十五批). */
  branches_json?: TemplateBranch[];
  /** Where a pass goes by default (a node id); the 自动分流 step's 不详 exit. */
  on_pass?: string | null;
}

/** What a node does (`NodeKind`, backend/apps/workflow/models.py). Absent reads as APPROVAL. */
export type WorkflowNodeKind = "APPROVAL" | "COUNTERSIGN" | "NOTIFY" | "END";

/** What a per-node timeout does (`TimeoutAction`). Fires when the scheduled job `workflow.process_timeouts_for_tenant` (every 5 min) or `process_workflow_timeouts` runs. */
export type WorkflowTimeoutAction = "ESCALATE" | "AUTO_REJECT" | "NOTIFY";

/**
 * A condition clause (`apps/workflow/conditions.py`): a whitelisted case fact
 * compared to a constant. Declarative — nothing is parsed or evaluated as code.
 * `balance` takes an integer and lt/lte/gt/gte/eq; `civilization`, `verdict` and
 * `origin_region` (EUROPE / ASIA / UNKNOWN — a blank `Soul.origin_region` reads
 * as UNKNOWN) take a non-empty list of members and in/not_in.
 */
export type ConditionFact = "balance" | "civilization" | "verdict" | "origin_region";
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
  /** 所属租户(殿)的主键。全局管理员的列表跨殿,「发起审批」按灵魂的殿筛。 */
  tenant?: number | null;
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

export interface StartWorkflowBody {
  soul: string;
  case_type?: string;
  template?: string;
  /** 0 普通 / 1 紧急 / 2 特急;不传 = 模板的默认值 */
  priority?: number;
  reason: string;
  judgment?: string;
  /** W-1: the template's station orders (`node_order`) unticked; the final review answers 400 `final_required`. */
  skip_node_orders?: number[];
}

/** `GET /workflows/case-types/` 的一行。标签用语言包 `workflow.case_types.<value>`。
 *  `builtin` = 有内置流程;false 时本殿若没有存好的模板，就是通用的单节点「审批节点」。 */
export interface WorkflowCaseTypeOption {
  value: string;
  builtin: boolean;
}

export const workflowApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<ApprovalWorkflowListItem>>("/workflows/", { params }),
  /** 与 `list` 同一组筛选 / 租户划界的 CSV,不分页(`ApprovalWorkflowViewSet.export`);页码参数不要传。 */
  exportCsv: (params?: Record<string, string>) =>
    api.get<Blob>("/workflows/export/", { params, responseType: "blob" }),
  get: (id: string) => api.get<ApprovalWorkflow>(`/workflows/${id}/`),
  /**
   * ApprovalWorkflowViewSet.start — 为任一灵魂手动发起审批(W-11),`workflow.create` 码名。
   * `case_type` 与 `template` 二选一;`reason` 必填。409 `workflow_in_progress` = 该灵魂已有进行中的审批。
   * 通用的 `POST /workflows/` 已关闭(405):它只存一条没有节点的空行。
   */
  start: (body: StartWorkflowBody) => api.post<ApprovalWorkflow>("/workflows/start/", body),
  /** 发起时可选的案件类型(`workflow.create` 码名)。`civilization` 与 `soul` 二选一。 */
  caseTypes: (params: { civilization: string } | { soul: string }) =>
    api.get<WorkflowCaseTypeOption[]>("/workflows/case-types/", { params }),
  /**
   * W-1 选站列表(第四十三批):流程生成之前本域默认流程的各站与接在后面的外域。结案时给 `judgment`;
   * 手动发起时给 `soul` 加 `case_type` 或 `template`(可再带关联的 `judgment`)。`workflow.read` 码名。
   */
  flowPreview: (params: { judgment: string } | { soul: string; case_type?: string; template?: string; judgment?: string }) =>
    api.get<FlowPreview>("/workflows/flow-preview/", { params }),
  /** 推进到下一站:被越过的那一站记 SKIPPED,要写理由并留审计(2026-10-29),400 `reason_required`。 */
  advance: (id: string, body: { reason: string }) => api.post<ApprovalWorkflow>(`/workflows/${id}/advance/`, body),
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
    data: { verdict: string; notes?: string; rejection_reason_for_soul?: string; require_reason?: boolean }
  ) => api.post<ApprovalWorkflow>(`/workflows/${workflowId}/approve_node/`, { node_id: nodeId, ...data }),
  /** 选站 / 改选 (W-1b, W-2): the stations of segment `order` to skip; `version` as loaded (409 `segment_changed`). */
  pickSegment: (id: string, order: number, body: { skip_node_ids: string[]; version: number; reason?: string }) =>
    api.post<ApprovalWorkflow>(`/workflows/${id}/segments/${order}/pick/`, body),
  /** 加减站 (W-3b): one segment, stations after the current one; reason required. */
  adjust: (id: string, body: { restore_node_ids: string[]; skip_node_ids: string[]; reason: string; version: number }) =>
    api.post<ApprovalWorkflow>(`/workflows/${id}/adjust/`, body),
  /** 按默认流程走 (W-5b/c): the convening hall's admin; after 3 days at the gate or when the realm has no picker. */
  useDefault: (id: string, order: number, body: { reason: string }) =>
    api.post<ApprovalWorkflow>(`/workflows/${id}/segments/${order}/use-default/`, body),
  /** 再提醒一次: once an hour per segment (429 `remind_too_soon` with `retry_after` seconds). */
  remindSegment: (id: string, order: number) =>
    api.post<{ order: number; reminded_at: string }>(`/workflows/${id}/segments/${order}/remind/`),
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
