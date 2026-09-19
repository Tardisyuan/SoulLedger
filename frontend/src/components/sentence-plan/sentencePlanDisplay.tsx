"use client";

import type { SentencePlan, SentencePlanRequest, SentenceRequestChanges } from "@soulledger/core/api/sentence-plans";
import { getCivilizationFromTenantCode } from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import type { BadgeTone } from "@/src/components/ui/Badge";

/*
 * 受刑计划的显示件,计划面板(灵魂详情)与「受刑请求」收件箱共用。
 * 规则的权威在 backend/apps/sentence_plan/(设计稿 docs/ARCHITECTURE-sentence-plan.md);
 * 这里只决定怎么显示与哪个按钮该出现 —— 出现的按钮服务端会再判一次。
 */

/** Tone, not token: `statusTokenLayering.test.ts` 管着「按领域枚举取颜色」的写法。 */
export const PLAN_TONES: Record<string, BadgeTone> = {
  ACTIVE: "info",
  RETRIAL: "warning",
  HELD: "warning",
  COMPLETED: "success",
  // 撤销 = 赦免、视为完成(D1),不是失败。
  CANCELLED: "neutral",
};

export const NODE_TONES: Record<string, BadgeTone> = {
  PENDING: "neutral",
  DISPATCHING: "info",
  ACTIVE: "accent",
  WAITING: "warning",
  COMPLETED: "success",
  ETERNAL: "warning",
  ABORTED: "error",
  REMOVED: "neutral",
  CANCELLED: "neutral",
};

export const REQUEST_TONES: Record<string, BadgeTone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REJECTED: "error",
  WITHDRAWN: "neutral",
};

/** 灵魂此刻在(或正被送往)的那一站:至多一个(约束 `unique_occupying_sentence_node`),永久刑期除外。 */
export const CURRENT_NODE_STATUSES = ["DISPATCHING", "ACTIVE", "WAITING", "ETERNAL"];

/** 还能决定 / 撤回 / 撤销的计划状态(`IN_PROGRESS_PLAN_STATUSES`)。 */
export const OPEN_PLAN_STATUSES = ["ACTIVE", "RETRIAL", "HELD"];

/**
 * 服务端拒绝码(`apps/sentence_plan/requests.py` 的 `PlanChangeRefusedError.code` 与视图的
 * `not_home`),各有一句 `sentence_plan.errors.*`。不在这里的码落到通用失败 —— `t()` 找不到键
 * 时返回键本身,所以不能靠「翻出来的是不是键」来判。
 */
export const REFUSAL_CODES = [
  "open_judgment", "plan_closed", "plan_held", "plan_in_retrial", "request_pending", "request_closed",
  "not_home", "not_requester", "node_not_pending", "eternal_not_last", "soul_state", "reason_required",
  "not_found", "invalid_changes", "empty_changes", "foreign_node", "foreign_realm", "unknown_node",
  "soul_is_here",
] as const;

export function refusalKey(error: unknown): string {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" && (REFUSAL_CODES as readonly string[]).includes(code)
    ? `sentence_plan.errors.${code}`
    : "sentence_plan.errors.failed";
}

/** 文明名(`tenant.civilizations`),原始租户码进 `title`。 */
export function TenantName({ code }: { code: string | null | undefined }) {
  return <DomainEnum namespace="tenant.civilizations" value={code ? getCivilizationFromTenantCode(code) : code} />;
}

/** 请求要改什么:加哪几站、减哪几站;REOPEN 没有 changes。 */
export function RequestChanges({ request, plan }: { request: SentencePlanRequest; plan: SentencePlan }) {
  const { t } = useI18n();
  const changes = (request.changes ?? {}) as SentenceRequestChanges;
  const orderOf = (id: string) => plan.nodes.find((n) => n.id === id)?.order;
  if (request.kind === "REOPEN") return null;
  return (
    <ul className="text-03 text-[oklch(var(--color-ink))] space-y-1">
      {(changes.add ?? []).map((a, i) => (
        <li key={`add-${i}`} data-change="add">
          {t("sentence_plan.request_add")} <TenantName code={a.tenant_code ?? request.from_tenant_code} />
          {" · "}
          <DomainEnum namespace="realms.names" value={a.realm_code} />
          {" · "}
          {a.sentence_years == null
            ? t("sentence_plan.years_unrecorded")
            : t("sentence_plan.years", { years: String(a.sentence_years) })}
        </li>
      ))}
      {(changes.remove ?? []).map((id) => (
        <li key={`remove-${id}`} data-change="remove">
          {t("sentence_plan.request_remove", { order: String(orderOf(id) ?? "?") })}
        </li>
      ))}
    </ul>
  );
}
