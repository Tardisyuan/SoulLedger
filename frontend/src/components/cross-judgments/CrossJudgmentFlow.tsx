"use client";

import Link from "next/link";
import type { CrossTenantJudgment, WorkflowSegment } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { LedgerHeading } from "@/src/components/souls/detail/SoulLedgerSections";
import { circled } from "@/src/components/workflow/segments/StationPicker";

const MUTED = "text-xs text-[oklch(var(--color-ink-muted))]";

/**
 * 跨域审判页的审批流程(第四十三批 W-4):顶部一条进度(走到哪一域、哪一站;已定 / 已走几站;哪些域还没选站,
 * 点了到流程详情),下面「各域顺序」—— 原来的「排第几站」。审批流程生成后顺序锁定(`order_locked`),
 * 还没生成时只写「还没生成审批流程 · 结案时勾选生成」。只在挂了原审判的跨域审判上出现。
 */
export function CrossJudgmentFlow({ judgment }: { judgment: CrossTenantJudgment }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const mine = user?.tenant?.code ?? null;
  const flow = judgment.workflow ?? null;

  const roleOf = (code: string) => judgment.participants.find((p) => p.participant_tenant_code === code)?.role;
  const realmState = (s: WorkflowSegment) =>
    s.state === "AWAITING_PICK"
      ? t("crossJudgments.flow.realm_not_picked", { n: String(s.default_node_count) })
      : s.state === "RUNNING"
        ? t("crossJudgments.flow.realm_running", { n: String(s.current_order_in_segment ?? "") })
        : s.state === "DONE"
          ? t("workflow.segment.done")
          : t("crossJudgments.flow.realm_picked", { go: String(s.go), total: String(s.total) });

  return (
    <section data-testid="cross-flow" className="mb-6" aria-label={t("crossJudgments.order.title")}>
      <div className="flex flex-col gap-1 border border-[oklch(var(--color-line))] px-4 py-3 text-sm">
        {flow ? (
          <>
            <p className="text-[oklch(var(--color-ink))]">
              {flow.at
                ? t("crossJudgments.flow.at", {
                    order: circled(flow.at.segment),
                    realm: flow.at.realm_name,
                    node: flow.at.node_name,
                    hall: flow.at.hall,
                  })
                : flow.at_gate
                  ? t("workflow.gate.waiting_title", { realm: flow.at_gate.realm_name, n: String(flow.at_gate.days ?? 1) })
                  : <DomainEnum namespace="workflow.status" value={flow.status} />}
            </p>
            <p className={MUTED}>
              {t("crossJudgments.flow.progress", { fixed: String(flow.fixed), done: String(flow.done) })}
              {flow.pending_realms.length > 0
                ? ` · ${t("crossJudgments.flow.pending_realms", { realms: flow.pending_realms.join("、") })}`
                : ""}
            </p>
            <Link href={`/workflow/${flow.id}`} className="self-start text-sm text-[oklch(var(--color-accent-ink))] hover:underline">
              {t("crossJudgments.flow.view")}
            </Link>
          </>
        ) : (
          <p className={MUTED}>{t("crossJudgments.flow.none")}</p>
        )}
      </div>

      {flow && flow.segments.length > 0 && (
        <>
          <LedgerHeading mark="丙" title={t("crossJudgments.order.title")} />
          <p className={`${MUTED} py-2`}>{judgment.order_locked ? t("crossJudgments.order.locked") : t("crossJudgments.order.hint")}</p>
          <ol>
            {flow.segments.map((s) => {
              const role = roleOf(s.tenant_code);
              return (
                <li
                  key={s.order}
                  data-realm-order={s.order}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 border-b border-[oklch(var(--color-rule))] text-sm"
                >
                  <span className="font-medium text-[oklch(var(--color-ink))]">
                    <span aria-hidden="true">{circled(s.order)} </span>
                    {s.realm_name}
                    {s.tenant_code === mine ? ` · ${t("workflow.segment.local")}` : ""}
                  </span>
                  {role ? (
                    <span className={MUTED}>
                      <DomainEnum namespace="crossJudgments.participant_roles" value={role} />
                    </span>
                  ) : null}
                  <span className={`ml-auto ${MUTED}`}>{realmState(s)}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
