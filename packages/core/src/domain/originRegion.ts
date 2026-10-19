import type { ApprovalNode, ConditionClause } from "../api/workflow";

/**
 * 灵魂的「出身地域」(`Soul.origin_region`,第四十五批):EUROPE / ASIA / 空。空就是「不详」,条件事实里读作 UNKNOWN
 * (`apps/workflow/conditions.py`)。希腊常规流程第一步按它自动分流:欧洲 → Aeacus,亚洲 → Rhadamanthus,不详 → Minos。
 *
 * 文案一律走 `souls.origin_region.*`(Design:表单、详情、编辑器出口线与条件值同一组词)。
 * 埃及文:Design 没给词的键(`egyPendingKeys.json`)由 `t()` 退回 zh-Hans;这里改为退回英文(与 en.json 同值,
 * `originRegionBatch45.test.tsx` 对着两边核),同 `courts.ts` 的做法。
 */

export const ORIGIN_REGIONS = ["EUROPE", "ASIA", "UNKNOWN"] as const;
export type OriginRegionMember = (typeof ORIGIN_REGIONS)[number];

/** egy 还没有词的成员 → 英文。 */
export const ORIGIN_REGION_EGY_EN: Readonly<Partial<Record<OriginRegionMember, string>>> = {
  ASIA: "Asia",
  // UNKNOWN has Design's egy (Nen Rekh, batch 45) — only ASIA is still missing.
};

/** 存的值("" / EUROPE / ASIA,或条件里的 UNKNOWN)→ 成员;认不出的、空的都是 UNKNOWN。 */
export function originRegionMember(value: string | null | undefined): OriginRegionMember {
  return value === "EUROPE" || value === "ASIA" ? value : "UNKNOWN";
}

/** 出身地域按界面语言。「不详」是一个词,不是缺值的「—」(Design W-2)。 */
export function originRegionLabel(
  t: (key: string, params?: Record<string, string>) => string,
  value: string | null | undefined,
  locale?: string,
): string {
  const member = originRegionMember(value);
  const en = ORIGIN_REGION_EGY_EN[member];
  if (locale === "egy" && en) return en;
  return t(`souls.origin_region.${member}`);
}

/** 一条分支只认「出身地域 ∈ {R}」这一种写法时的 R;别的条件给 null。 */
export function branchRegion(when: readonly ConditionClause[] | undefined): OriginRegionMember | null {
  if (!when || when.length !== 1) return null;
  const [c] = when;
  if (c.fact !== "origin_region" || c.op !== "in" || !Array.isArray(c.value) || c.value.length !== 1) return null;
  const v = c.value[0];
  return v === "EUROPE" || v === "ASIA" ? v : null;
}

/** 「自动分流」一步:通知节点,有按出身地域的分支(编辑器与流程详情同一条认法)。 */
export function isAutoRouteBranches(
  kind: string | undefined,
  branches: readonly { when?: readonly ConditionClause[] }[] | null | undefined,
): boolean {
  return kind === "NOTIFY" && (branches ?? []).some((b) => (b.when ?? []).some((c) => c.fact === "origin_region"));
}

/**
 * 这一次分流走了哪条(流程详情 W-5):分支的去处里走到过的那一站(不是 PENDING / 跳过,或就是当前站)给它的地域;
 * 分流已经过而分支去处都没走到,就是默认那条(`on_pass`)—— 不详。还没经过分流时 null。
 * 从节点的状态读,不读灵魂现在的字段:灵魂的出身地域事后可能被改过,这里要的是当时走的那条。
 */
export function routedRegion(
  node: Pick<ApprovalNode, "status" | "branches_json" | "on_pass">,
  nodes: readonly Pick<ApprovalNode, "id" | "status" | "node_name">[],
  currentNode?: string | null,
): { region: OriginRegionMember; target: Pick<ApprovalNode, "id" | "node_name"> | null } | null {
  if (node.status !== "TRAVERSED") return null;
  const reached = (id: string | undefined) =>
    nodes.find((n) => n.id === id && (n.id === currentNode || (n.status !== "PENDING" && n.status !== "SKIPPED")));
  for (const b of node.branches_json ?? []) {
    const region = branchRegion(b.when);
    const target = reached(b.target);
    if (region && target) return { region, target };
  }
  return { region: "UNKNOWN", target: reached(node.on_pass ?? undefined) ?? null };
}
