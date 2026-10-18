import type { ApprovalNode, ApprovalWorkflow, WorkflowSegment } from "../api/workflow";

/**
 * 第四十三批:审批流程按域分段的几条读法,选站底页、加减站底页、流程详情左栏共用 —— 官员台与官员 App 都用。
 * 规则在后端(`apps/workflow/segments.py`),这里只按它返回的字段读,不另算一套。
 */

/** 一段的站,按站序;结束节点不是一站(不能选、也不列,同 `segments.flow_preview`)。 */
export function segmentNodes(workflow: Pick<ApprovalWorkflow, "nodes">, order: number): ApprovalNode[] {
  return (workflow.nodes ?? [])
    .filter((n) => n.segment_order === order && n.kind !== "END")
    .sort((a, b) => a.node_order - b.node_order);
}

/** 选站 / 加减站能动的跳过:选站时跳过、中途跳过(`RESTORABLE_SKIPS`)。引擎按路由跳过的与取消跳过的不能加回。 */
export const isRestorable = (n: ApprovalNode) =>
  n.status === "SKIPPED" && (n.skip_kind === "AT_PICK" || n.skip_kind === "LATER");

/** 段序号 → ①②③(Design 的分段头与外域行都用它)。 */
export const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}.`);

/** 段的「站号」:段内重排(Design W-3a);老后端没有时退回全局站序。 */
export const stationNo = (n: ApprovalNode) => n.order_in_segment ?? n.node_order;

/** 409 / 429 等拒绝:`{code, error, ...extra}`(`views._refused`)。 */
export interface SegmentRefusal {
  status?: number;
  code: string;
  data: Record<string, unknown>;
}

export function segmentRefusalOf(error: unknown): SegmentRefusal {
  const r = (error as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  const data = r?.data ?? {};
  return { status: r?.status, code: typeof data.code === "string" ? data.code : "", data };
}

/** W-5d「这一段刚被改过」:谁、几点(后端随 409 `segment_changed` 带回;没有时只写标题)。 */
export interface StaleSegment {
  by: string;
  at: string | null;
}

export const staleOf = (refusal: SegmentRefusal): StaleSegment | null =>
  refusal.code === "segment_changed"
    ? {
        by: typeof refusal.data.changed_by === "string" ? refusal.data.changed_by : "",
        at: typeof refusal.data.changed_at === "string" ? refusal.data.changed_at : null,
      }
    : null;

/** 请求者能改的那一段(加减站只改本域那一段):当前站所在的段优先,其次本域还没开始的段。 */
export function adjustableSegment(workflow: ApprovalWorkflow, myTenant: string | null): WorkflowSegment | null {
  const segments = workflow.segments ?? [];
  const current = (workflow.nodes ?? []).find((n) => n.id === workflow.current_node);
  const here = segments.find((s) => s.order === current?.segment_order);
  if (here && (myTenant === null || here.tenant_code === myTenant)) return here;
  return segments.find((s) => s.tenant_code === myTenant && (s.state === "RUNNING" || s.state === "PICKED")) ?? null;
}

/** 门口满几天算「超过 3 天还没选」(后端 `segments.OVERDUE_DAYS`;到门口那天是第 1 天)。 */
export const OVERDUE_DAYS = 3;

/**
 * 流程停在一段门口时,读的人看到哪一种(W-5a/c、O-4):`foreign` = 这一段是读的人自己的域(「流程在等本域选站」);
 * `no_picker` = 那个域没有能选站的人;`overdue` = 等了超过 3 天(「每天提醒一次,还没选」);否则 `waiting`。
 */
export type GateView = "foreign" | "no_picker" | "overdue" | "waiting";

export function gateView(segment: Pick<WorkflowSegment, "tenant_code" | "no_picker" | "gate_days">, myTenant: string | null): GateView {
  if (myTenant !== null && segment.tenant_code === myTenant) return "foreign";
  if (segment.no_picker) return "no_picker";
  return (segment.gate_days ?? 0) > OVERDUE_DAYS ? "overdue" : "waiting";
}
