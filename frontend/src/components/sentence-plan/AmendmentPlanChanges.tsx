"use client";

import { useSentencePlan } from "@soulledger/core/hooks/useSentencePlans";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/src/components/ui/PageError";
import { PlanChangesEditor, type ChangesDraft } from "./PlanChangesEditor";

/**
 * 情况 1(设计稿 §4.1):灵魂就在本文明,本文明开的加减项审判(`kind=AMENDMENT`)结案时带的改动。
 * 结案接口收 `plan_changes`(`JudgmentConcludeSerializer`),系统据此生成一条 AMEND 请求交原审判官;
 * 不带改动就不生成请求(D8)。改动的草稿由审判页持有,随裁决一起提交(同一事务,拒绝则整个结案回滚)。
 */
export function AmendmentPlanChanges({
  planId,
  tenantCode,
  draft,
  onChange,
}: {
  planId: string;
  tenantCode: string;
  draft: ChangesDraft;
  onChange: (next: ChangesDraft) => void;
}) {
  const { t } = useI18n();
  const plan = useSentencePlan(planId);
  return (
    <section className="mt-10 space-y-3" data-testid="amendment-plan-changes" aria-label={t("sentence_plan.amend.title")}>
      <h2 className="text-06 text-[oklch(var(--color-ink))]">{t("sentence_plan.amend.title")}</h2>
      <p className="text-03 text-[oklch(var(--color-ink-muted))] max-w-prose">{t("sentence_plan.amend.hint")}</p>
      {plan.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : plan.data ? (
        <PlanChangesEditor plan={plan.data} tenantCode={tenantCode} draft={draft} onChange={onChange} />
      ) : (
        <QueryError onRetry={() => plan.refetch()} />
      )}
    </section>
  );
}
