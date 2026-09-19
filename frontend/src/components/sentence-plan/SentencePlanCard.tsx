"use client";

import { useState } from "react";
import type { SentenceNode, SentencePlan } from "@soulledger/core/api/sentence-plans";
import { useCancelSentencePlan, useSentencePlans } from "@soulledger/core/hooks/useSentencePlans";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { BaseModal } from "@/src/components/ui/Modal";
import { TextAreaField } from "@/src/components/ui/Field";
import { QueryError } from "@/src/components/ui/PageError";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CURRENT_NODE_STATUSES,
  NODE_TONES,
  OPEN_PLAN_STATUSES,
  PLAN_TONES,
  REQUEST_TONES,
  RequestChanges,
  TenantName,
  refusalKey,
} from "./sentencePlanDisplay";
import { SentenceRequestActions } from "./SentenceRequestActions";

/*
 * 灵魂详情的受刑计划面板(设计稿 §9 阶段 4)。
 *
 * 读 `sentence-plans/?soul=`:原属租户看得到,计划上有节点的执行地也看得到自己那一份(D4),
 * 别的租户得到空列表 —— 面板于是只剩「尚无受刑计划」,这是对的:他们不在这件事里。
 * 节点的理由(`reason`)与请求在这里对官员可见;灵魂端(App)不看这些(Q10)。
 */

const PANEL = "bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))]";
const MUTED = "text-02 text-[oklch(var(--color-ink-subtle))]";

function NodeRow({ node, current }: { node: SentenceNode; current: boolean }) {
  const { t } = useI18n();
  const gone = node.status === "REMOVED" || node.status === "CANCELLED";
  return (
    <li
      data-node-order={node.order}
      data-node-status={node.status}
      aria-current={current ? "step" : undefined}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-2 border-b border-[oklch(var(--color-hairline))] last:border-b-0 ${
        gone ? "opacity-60" : ""
      }`}
    >
      <span className="text-03 font-medium tabular-nums">{t("sentence_plan.stop", { order: String(node.order) })}</span>
      <TenantName code={node.tenant_code} />
      {node.is_home && <Badge tone="neutral">{t("sentence_plan.home")}</Badge>}
      <span className={MUTED}>
        <DomainEnum namespace="realms.names" value={node.realm_code || null} />
        {" · "}
        {node.is_eternal
          ? t("sentence_plan.eternal")
          : node.sentence_years == null
            ? t("sentence_plan.years_unrecorded")
            : t("sentence_plan.years", { years: String(node.sentence_years) })}
      </span>
      <Badge tone={NODE_TONES[node.status] ?? "neutral"}>
        <DomainEnum namespace="sentence_plan.node_states" value={node.status} />
      </Badge>
      {current && <Badge tone="accent">{t("sentence_plan.current")}</Badge>}
      {node.reason && <p className={`w-full ${MUTED}`}>{node.reason}</p>}
    </li>
  );
}

function PlanBody({ plan }: { plan: SentencePlan }) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const cancel = useCancelSentencePlan();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const current = plan.nodes.find((n) => CURRENT_NODE_STATUSES.includes(n.status));
  const open = OPEN_PLAN_STATUSES.includes(plan.status);
  const isHome = isAdmin || (!!user?.tenant?.code && user.tenant.code === plan.tenant_code);
  const canCancel = open && isHome && hasPermission("sentence_plan.cancel");

  const closeCancel = () => {
    setCancelOpen(false);
    setReason("");
  };
  const submitCancel = () =>
    cancel.mutate(
      { planId: plan.id, reason: reason.trim() },
      {
        onSuccess: () => {
          closeCancel();
          showToast(t("sentence_plan.cancelled"), "success");
        },
        onError: (error) => showToast(t(refusalKey(error)), "error"),
      }
    );

  return (
    <section data-plan-id={plan.id} aria-label={t("sentence_plan.plan_label", { cycle: String(plan.cycle) })} className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={PLAN_TONES[plan.status] ?? "neutral"}>
          <DomainEnum namespace="sentence_plan.plan_states" value={plan.status} />
        </Badge>
        <span className={MUTED}>{t("sentence_plan.cycle", { cycle: String(plan.cycle) })}</span>
        {plan.completed_at && <span className={MUTED}>{formatDateTime(plan.completed_at)}</span>}
      </header>
      {plan.status === "CANCELLED" && plan.cancel_reason && (
        <p className="text-03 text-[oklch(var(--color-ink-muted))]">
          {t("sentence_plan.cancel_reason_shown", { reason: plan.cancel_reason })}
        </p>
      )}
      {open && !current && <p className={MUTED}>{t("sentence_plan.between_stops")}</p>}
      <ol aria-label={t("sentence_plan.nodes_label")}>
        {plan.nodes.map((n) => (
          <NodeRow key={n.id} node={n} current={n.id === current?.id} />
        ))}
      </ol>

      {plan.requests.length > 0 && (
        <div>
          <h3 className="text-01 uppercase text-[oklch(var(--color-ink-muted))] mb-2">{t("sentence_plan.requests_title")}</h3>
          <ul className="space-y-3">
            {plan.requests.map((r) => (
              <li key={r.id} data-request-id={r.id} className="space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-03">
                  <DomainEnum namespace="sentence_plan.request_kinds" value={r.kind} />
                  <Badge tone={REQUEST_TONES[r.status] ?? "neutral"}>
                    <DomainEnum namespace="sentence_plan.request_states" value={r.status} />
                  </Badge>
                  <span className={MUTED}>
                    {t("sentence_plan.request_from")} <TenantName code={r.from_tenant_code} />
                    {" · "}
                    {formatDateTime(r.create_time)}
                  </span>
                </p>
                <RequestChanges request={r} plan={plan} />
                {r.reason && <p className="text-03 text-[oklch(var(--color-ink-muted))]">{r.reason}</p>}
                {r.decision_reason && (
                  <p className={MUTED}>{t("sentence_plan.decision_reason_shown", { reason: r.decision_reason })}</p>
                )}
                {open && <SentenceRequestActions plan={plan} request={r} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canCancel && (
        <Button type="button" variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
          {t("sentence_plan.cancel")}
        </Button>
      )}
      <BaseModal
        isOpen={cancelOpen}
        onClose={closeCancel}
        title={t("sentence_plan.cancel_title", { soul: plan.soul_name })}
        footer={
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={closeCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={cancel.isPending}
              disabled={!reason.trim()}
              onClick={submitCancel}
            >
              {t("sentence_plan.cancel")}
            </Button>
          </div>
        }
      >
        <p className="text-04 text-[oklch(var(--color-ink-muted))] mb-3">{t("sentence_plan.cancel_warning")}</p>
        <TextAreaField
          label={t("sentence_plan.cancel_reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          required
        />
      </BaseModal>
    </section>
  );
}

export function SentencePlanCard({ soulId }: { soulId: string }) {
  const { t } = useI18n();
  // ponytail: first page (20 plans) — one plan per life cycle, a soul past 20 lives shows its latest 20.
  const plans = useSentencePlans({ soul: soulId });
  const rows = [...(plans.data?.results ?? [])].sort((a, b) => b.cycle - a.cycle);

  return (
    <div className={PANEL} data-testid="sentence-plan-card">
      <h2 className="text-01 text-[oklch(var(--color-ink-muted))] uppercase mb-3">{t("sentence_plan.panel_title")}</h2>
      {plans.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : plans.isError && !plans.data ? (
        <QueryError onRetry={() => plans.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-03 text-[oklch(var(--color-ink-muted))]">{t("sentence_plan.none")}</p>
      ) : (
        <div className="space-y-6">
          {rows.map((p) => (
            <PlanBody key={p.id} plan={p} />
          ))}
        </div>
      )}
    </div>
  );
}
