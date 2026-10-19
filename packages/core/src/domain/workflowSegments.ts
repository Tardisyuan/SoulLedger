import type { ApprovalNode, ApprovalWorkflow, JumpSource, WorkflowSegment } from "../api/workflow";
import { civilizationLabel, realmLabel } from "../config/civilizations";
import { courtLabel } from "./courts";

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

/**
 * 一段的域名:文明名(`civilizationLabel`:中国 / 埃及 …,Design「等待外域选站 · 埃及 · 第 2 天」),认不出文明才用
 * 服务端的 `realm_name` —— 那是租户展示名,库里的英文(「Egyptian Afterlife」),中文界面里不该露出来(2026-10-19)。
 */
export const segmentRealm = (
  t: (key: string) => string,
  s: Pick<WorkflowSegment, "tenant_code" | "realm_name"> | null | undefined,
): string => (s ? civilizationLabel(t, s.tenant_code, s.realm_name) : "");

/**
 * 驳回时会转到这一站的站里,这次还要走的(没被勾掉的)。有一个,这一站就锁着、像终审一样(后端 400
 * `jump_target_required`,2026-10-19);来源都勾掉了才解锁。`skipped` 与来源的 `key` 是同一种值(站序或节点 id)。
 */
export const runningJumpSources = (sources: readonly JumpSource[] | undefined, skipped: ReadonlySet<string>): JumpSource[] =>
  (sources ?? []).filter((s) => !skipped.has(s.key));

/**
 * 勾选变了之后对齐:还有来源要走的目标不能留在跳过里 —— 勾回来源时把它的目标一并勾回(目标自己也可能是来源,
 * 所以算到不再变)。选站与加减站都经过它,所以送回后端的永远是后端会收的组合。
 */
export function settleJumpTargets(
  rows: readonly { key: string; jumpSources?: readonly JumpSource[] }[],
  skipped: ReadonlySet<string>,
): Set<string> {
  const next = new Set(skipped);
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of rows) {
      if (next.has(row.key) && runningJumpSources(row.jumpSources, next).length > 0) {
        next.delete(row.key);
        changed = true;
      }
    }
  }
  return next;
}

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

/** 这些码说的都是「流程在你打开之后往前走了」:一句「请刷新」。 */
const MOVED_ON = new Set([
  "segment_closed",
  "segment_started",
  "segment_done",
  "not_picked",
  "not_awaiting",
  "node_locked",
  "node_changed",
  "workflow_closed",
]);

/**
 * 拒绝码 → 语言包里的一句(2026-10-19):后端的 `error` 是英文,只给日志看,不上屏。驳回目标(`jump_target_required`)
 * 写出是哪一站、从哪些站转来(响应的 `jump_targets`)。认不出的码给 null,调用方退回自己的兜底(「没能保存」)。
 * 官员台(选站 / 加减站 / 门口 / 生成流程 / 落判)与官员 App 的选站同用。
 */
export function segmentRefusalText(
  t: (key: string, vars?: Record<string, string>) => string,
  refusal: SegmentRefusal,
): string | null {
  const { code, data } = refusal;
  if (code === "jump_target_required") {
    const targets = Array.isArray(data.jump_targets) ? (data.jump_targets as { node_name?: unknown; sources?: unknown }[]) : [];
    const lines = targets.map((r) =>
      t("workflow.refusal.jump_target_required", {
        station: typeof r.node_name === "string" ? r.node_name : "",
        source: Array.isArray(r.sources) ? r.sources.filter((s) => typeof s === "string").join("、") : "",
      }),
    );
    return lines.length > 0 ? lines.join(" ") : null;
  }
  if (code === "remind_too_soon") return t("workflow.gate.remind_too_soon");
  if (code === "too_early") return t("workflow.refusal.too_early", { days: String(OVERDUE_DAYS) });
  if (MOVED_ON.has(code)) return t("workflow.refusal.moved_on");
  if (["final_required", "segment_changed", "workflow_required", "not_allowed", "unknown_node", "reason_required"].includes(code)) {
    return t(`workflow.refusal.${code}`);
  }
  return null;
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

/**
 * 「待我选站」一行的发起殿(Design O-1「中国 · 酆都第十殿发起」):冥界名接审判所在的殿(`court`);没有殿时只写冥界名。
 * `realm` 是租户代码;认不出文明时退回服务端的 `hall`(租户展示名)。殿名按界面语言(`courtLabel`:en 写 Tenth Court)。
 * 官员台与官员 App 同用。
 */
export function pickHall(
  t: (key: string, vars?: Record<string, string>) => string,
  row: { realm?: string; hall?: string; court?: string },
  locale?: string,
): string {
  const realm = realmLabel(t, row.realm, row.hall ?? "");
  if (!row.court) return realm;
  const court = courtLabel(t, row.court, locale);
  return realm ? t("workflow.pick_group.hall", { realm, court }) : court;
}
