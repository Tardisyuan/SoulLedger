"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type WorkflowSegment } from "@soulledger/core/api";
import { workflowKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { PickStationsSheet } from "./PickStationsSheet";
import { gateView, segmentRealm, segmentRefusalOf, segmentRefusalText } from "@soulledger/core/domain/workflowSegments";

/**
 * 流程停在一个外域段门口、等那个域选站时,中栏的那一块(第四十三批 W-5a/b/c,外域那边是 W-2 的「流程在等本域选站」)。
 *
 * - 召集这边:「等待外域选站 · 埃及 · 第 N 天」,不写外域判官的名字;满 3 天后写「每天提醒一次,还没选」。
 *   「再提醒一次」给召集殿的人(`can_remind`,一小时一次,太快 429 `remind_too_soon`);「按默认流程走」只在
 *   `can_use_default`(召集殿管理员,且满 3 天或该域没有能选站的人)时出现,要写理由。
 * - 该域没有能选站的人(W-5c):⚠ 一句,不区分原因(外域人员信息不外露)。
 * - 外域自己看到:「流程在等本域选站」+「选站」。
 */
export function WorkflowGateBanner({ workflow, segment, myTenant }: { workflow: ApprovalWorkflow; segment: WorkflowSegment; myTenant: string | null }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [reminded, setReminded] = useState(false);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(false);
  const realm = segmentRealm(t, segment);
  const previous = (workflow.segments ?? []).filter((s) => s.order < segment.order).at(-1);

  const remind = useMutation({
    mutationFn: () => workflowApi.remindSegment(workflow.id, segment.order),
    onSuccess: () => {
      setReminded(true);
      showToast(t("workflow.gate.reminded"), "success");
    },
    onError: (error) => {
      const refusal = segmentRefusalOf(error);
      if (refusal.code === "remind_too_soon") {
        setReminded(true);
        showToast(t("workflow.gate.remind_too_soon"), "error");
        return;
      }
      showToast(segmentRefusalText(t, refusal) ?? t("workflow.segment.error"), "error");
    },
  });
  const goDefault = useMutation({
    mutationFn: () => workflowApi.useDefault(workflow.id, segment.order, { reason: reason.trim() }),
    onSuccess: (res) => {
      queryClient.setQueryData(workflowKeys.detail(workflow.id), res.data);
      setDefaultOpen(false);
    },
    onError: (error) => {
      const refusal = segmentRefusalOf(error);
      showToast(segmentRefusalText(t, refusal) ?? t("workflow.segment.error"), "error");
    },
  });

  // 哪一种由 core 的 `gateView` 定(官员 App 的 O-4 同一个函数)。
  const view = gateView(segment, myTenant);
  const mine = view === "foreign";
  const overdue = view === "overdue";

  return (
    <section
      data-testid="gate-banner"
      className="flex flex-col gap-3 px-6 py-6 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]"
    >
      {mine ? (
        <>
          <h2 className="font-title text-lg text-[oklch(var(--color-ink))]">
            <span aria-hidden="true">◌ </span>
            {t("workflow.gate.foreign_title")}
          </h2>
          <p className="text-sm text-[oklch(var(--color-ink-muted))]">
            {t("workflow.gate.foreign_body", { soul: workflow.soul_name ?? "", realm: segmentRealm(t, previous) })}
          </p>
          {segment.can_pick && (
            <Button type="button" variant="primary" className="self-start" onClick={() => setPicking(true)}>
              {t("workflow.pick_group.action")}
            </Button>
          )}
        </>
      ) : segment.no_picker ? (
        <>
          <h2 className="font-title text-lg text-[oklch(var(--color-ink))]">
            <span aria-hidden="true">⚠ </span>
            {t("workflow.gate.no_picker_title", { realm })}
          </h2>
          <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.gate.no_picker_body", { realm })}</p>
        </>
      ) : (
        <>
          <h2 className="font-title text-lg text-[oklch(var(--color-ink))]">
            <span aria-hidden="true">◌ </span>
            {t("workflow.gate.waiting_title", { realm, n: String(segment.gate_days ?? 1) })}
          </h2>
          <p data-overdue={overdue ? "" : undefined} className="text-sm text-[oklch(var(--color-ink-muted))]">
            {overdue ? t("workflow.gate.overdue_body", { realm }) : t("workflow.gate.waiting_body", { realm })}
          </p>
        </>
      )}

      {!mine && (segment.can_remind || segment.can_use_default) && (
        <div className="flex flex-wrap gap-2">
          {segment.can_remind && !segment.no_picker && (
            <Button type="button" variant="secondary" loading={remind.isPending} disabled={reminded} onClick={() => remind.mutate()}>
              {reminded ? t("workflow.gate.reminded") : t("workflow.gate.remind_again")}
            </Button>
          )}
          {segment.can_use_default && (
            <Button type="button" variant="secondary" onClick={() => setDefaultOpen(true)}>
              {t("workflow.gate.use_default")}
            </Button>
          )}
        </div>
      )}

      <BaseModal
        isOpen={defaultOpen}
        onClose={() => !goDefault.isPending && setDefaultOpen(false)}
        title={t("workflow.gate.use_default")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDefaultOpen(false)} disabled={goDefault.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={goDefault.isPending}
              disabled={!reason.trim()}
              onClick={() => goDefault.mutate()}
            >
              {t("workflow.gate.use_default")}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.gate.use_default_confirm", { realm })}</p>
        <TextAreaField
          label={t("workflow.adjust.reason")}
          required
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </BaseModal>
      {picking && (
        <PickStationsSheet workflowId={workflow.id} order={segment.order} isOpen onClose={() => setPicking(false)} />
      )}
    </section>
  );
}
