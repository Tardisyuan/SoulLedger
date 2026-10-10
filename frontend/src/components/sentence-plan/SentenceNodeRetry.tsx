"use client";

import { useState } from "react";
import type { SentenceNode, SentencePlan } from "@soulledger/core/api/sentence-plans";
import { useRetrySentenceDispatch } from "@soulledger/core/hooks/useSentencePlans";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { refusalKey } from "./sentencePlanDisplay";

/**
 * 一站的调拨被拒或取消后退回「未开始」:显示上次为什么没成,并给原属判官一个「重新发起调拨」。
 *
 * 服务端只在 `last_refusal` 非空时给出(被拒 / 取消过、现在是外地的 PENDING)。按钮只给能成功的人:
 * 原属租户(或 ADMIN)里持有 `judgment.execute` 的判官,计划还在进行中;别的人只看到原因。
 * 其余条件(前面还有站、有未结案审判……)服务端再判,拒绝码走 `sentence_plan.errors.*`。
 */
export function SentenceNodeRetry({ plan, node }: { plan: SentencePlan; node: SentenceNode }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const retry = useRetrySentenceDispatch();
  const [confirm, setConfirm] = useState(false);

  const refusal = node.last_refusal;
  if (!refusal) return null;

  const isHome = isAdmin || (!!user?.tenant?.code && user.tenant.code === plan.tenant_code);
  const canRetry = isHome && hasPermission("judgment.execute") && (plan.status === "ACTIVE" || plan.status === "RETRIAL");
  const why =
    refusal.status === "CANCELLED"
      ? t("sentence_plan.last_refusal_cancelled")
      : refusal.reason
        ? t("sentence_plan.last_refusal_rejected", { reason: refusal.reason })
        : t("sentence_plan.last_refusal_rejected_bare");

  const submit = () =>
    retry.mutate(
      { planId: plan.id, nodeId: node.id },
      {
        onSuccess: () => {
          setConfirm(false);
          showToast(t("sentence_plan.retried"), "success");
        },
        onError: (error) => {
          setConfirm(false);
          showToast(t(refusalKey(error)), "error");
        },
      }
    );

  return (
    <div className="w-full space-y-2" data-testid="sentence-node-retry">
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{why}</p>
      {canRetry && (
        <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(true)}>
          {t("sentence_plan.retry_dispatch")}
        </Button>
      )}
      <ConfirmDialog
        isOpen={confirm}
        title={t("sentence_plan.retry_title", { soul: plan.soul_name, order: String(node.order) })}
        message={t("sentence_plan.retry_warning")}
        confirmText={t("sentence_plan.retry_dispatch")}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
        confirmLoading={retry.isPending}
        variant="warning"
      />
    </div>
  );
}
