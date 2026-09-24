"use client";

import { useState } from "react";
import type { SentencePlan } from "@soulledger/core/api/sentence-plans";
import { useFileSentenceRequest } from "@soulledger/core/hooks/useSentencePlans";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { SelectField, TextAreaField } from "@/src/components/ui/Field";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { EMPTY_DRAFT, PlanChangesEditor, draftIsEmpty, draftToChanges, type ChangesDraft } from "./PlanChangesEditor";
import { CURRENT_NODE_STATUSES, refusalKey } from "./sentencePlanDisplay";

/**
 * 情况 2.1 / 2.2(设计稿 §4.1):执行地的判官向原审判官提请求 —— 加减项(AMEND)或重开审判(REOPEN)。
 *
 * 谁看得到按钮(服务端 `requests.py::file_request` 与视图各再判一次):
 * * 持有 `judgment.execute`;不是原属(原属是决定方;它的改动走联审或重开审判的结论)。
 *   能读到这份计划的非原属租户,就是计划上有站的执行地(D4)。
 * * 计划进行中且不是 HELD(409 plan_held),没有待决定的请求(409 request_pending)。
 * * 灵魂此刻就在本文明(占着本文明的一站)→ 不给按钮,给一句「开加减项审判」(400 soul_is_here,§4.2)。
 * REOPEN 只在 ACTIVE 时可选(RETRIAL 下 409 plan_in_retrial),且理由必填。
 */
export function SentenceRequestForm({ plan }: { plan: SentencePlan }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const file = useFileSentenceRequest();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"AMEND" | "REOPEN">("AMEND");
  const [draft, setDraft] = useState<ChangesDraft>(EMPTY_DRAFT);
  const [reason, setReason] = useState("");

  const mine = user?.tenant?.code ?? null;
  const eligible =
    mine !== null &&
    mine !== plan.tenant_code &&
    hasPermission("judgment.execute") &&
    (plan.status === "ACTIVE" || plan.status === "RETRIAL") &&
    !plan.requests.some((r) => r.status === "PENDING");
  if (!eligible) return null;

  const soulIsHere = plan.nodes.some(
    (n) => n.tenant_code === mine && CURRENT_NODE_STATUSES.includes(n.status) && n.status !== "DISPATCHING"
  );
  if (soulIsHere) {
    return <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("sentence_plan.file.soul_is_here")}</p>;
  }

  const changes = kind === "AMEND" ? draftToChanges(draft) : undefined;
  const ready = kind === "AMEND" ? changes !== null && !draftIsEmpty(draft) : reason.trim() !== "";

  const close = () => {
    setOpen(false);
    setKind("AMEND");
    setDraft(EMPTY_DRAFT);
    setReason("");
  };
  const body = { kind, changes: changes ?? undefined, reason: reason.trim() };
  const submit = () =>
    file.mutate(
      { planId: plan.id, ...body },
      {
        onSuccess: () => {
          close();
          showToast(t("sentence_plan.file.submitted"), "success");
        },
        // 对话框不关:填的改动还在,改一改再交。
        onError: (error) => showToast(t(refusalKey(error)), "error"),
      }
    );

  const kinds = plan.status === "ACTIVE" ? (["AMEND", "REOPEN"] as const) : (["AMEND"] as const);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("sentence_plan.file.open")}
      </Button>
      <BaseModal
        isOpen={open}
        onClose={close}
        title={t("sentence_plan.file.title", { soul: plan.soul_name })}
        footer={
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="primary" loading={file.isPending} disabled={!ready} onClick={submit}>
              {t("sentence_plan.file.submit")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <SelectField
            label={t("sentence_plan.file.kind")}
            value={kind}
            onChange={(e) => setKind(e.target.value as "AMEND" | "REOPEN")}
            options={kinds.map((k) => ({
              value: k,
              label: resolveEnumDisplay(t, "sentence_plan.request_kinds", k).label ?? k,
            }))}
          />
          {kind === "AMEND" ? (
            <PlanChangesEditor plan={plan} tenantCode={mine} draft={draft} onChange={setDraft} />
          ) : (
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("sentence_plan.file.reopen_hint")}</p>
          )}
          <TextAreaField
            label={t(kind === "REOPEN" ? "sentence_plan.file.reason_reopen" : "sentence_plan.file.reason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required={kind === "REOPEN"}
          />
        </div>
      </BaseModal>
    </>
  );
}
