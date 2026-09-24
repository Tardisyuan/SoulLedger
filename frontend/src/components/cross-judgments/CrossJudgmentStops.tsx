"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  crossTenantJudgmentsApi,
  realmsApi,
  type CrossTenantJudgment,
  type CrossTenantJudgmentParticipant,
} from "@soulledger/core/api";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { SelectField, TextAreaField, TextField } from "@/src/components/ui/Field";
import { TenantName } from "@/src/components/sentence-plan/sentencePlanDisplay";

/*
 * 联审定下的各站(docs/ARCHITECTURE-sentence-plan.md §2.1、Q1、Q5、Q12、Q16)。
 *
 * 只在挂了原审判的联审上出现(`judgment.judgment` 非空);存量那种不挂灵魂的会议没有站。
 * * 第 1 站恒为原属(发起方),由原审判结案时产出,这里只显示。
 * * 带节点的席位(CO_JUDGE / CHAIRMAN)按 `node_order` 排在后面;ADVISOR 不带节点、不能填(N3=(a))。
 * * 席位所属租户填自己那一站:本文明的界域、刑期;是否永久由界域决定(服务端抄)。
 * * 发起方在开庭(ACTIVE)前可以重排;永久刑期只能排最后(Q5)—— 这里提示并挡住保存,
 *   服务端的 `order/` 与联审结束校验各再拦一次。
 */

const ROW = "flex flex-wrap items-center gap-x-2 gap-y-1 bg-[oklch(var(--color-surface-2))] px-4 py-2";
const MUTED = "text-xs text-[oklch(var(--color-ink-subtle))]";

function errorText(error: unknown): string | null {
  const text = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof text === "string" ? text : null;
}

function SentenceForm({ judgmentId, seat }: { judgmentId: string; seat: CrossTenantJudgmentParticipant }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const civilization = TENANT_CODE_TO_CIVILIZATION[seat.participant_tenant_code];
  const realms = useQuery({
    queryKey: ["realms", "list", { civilization }],
    queryFn: () => realmsApi.list({ civilization }).then((r) => r.data.results),
    enabled: !!civilization,
  });
  const [realmCode, setRealmCode] = useState(seat.sentence_realm_code);
  const [years, setYears] = useState(seat.sentence_years == null ? "" : String(seat.sentence_years));
  const [notes, setNotes] = useState(seat.sentence_notes);
  const chosen = realms.data?.find((r) => r.realm_code === realmCode);

  const submit = useMutation({
    mutationFn: () =>
      crossTenantJudgmentsApi.sentence(judgmentId, {
        participant: seat.id,
        realm_code: realmCode,
        sentence_years: years.trim() === "" ? null : Number(years),
        notes,
      }),
    onSuccess: () => {
      showToast(t("sentence_plan.cross.submitted"), "success");
      queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
    },
    // 服务端的 400 是一句英文说明(「Realm … is not a realm of …」),没有码;照原样给出。
    onError: (error) => showToast(errorText(error) ?? t("sentence_plan.cross.submit_error"), "error"),
  });

  const yearsInvalid = years.trim() !== "" && !/^\d+$/.test(years.trim());
  return (
    <form
      className="w-full space-y-2 pt-2"
      aria-label={t("sentence_plan.cross.fill_title")}
      onSubmit={(e) => {
        e.preventDefault();
        if (realmCode && !yearsInvalid) submit.mutate();
      }}
    >
      <SelectField
        label={t("sentence_plan.cross.realm")}
        value={realmCode}
        onChange={(e) => setRealmCode(e.target.value)}
        options={[
          { value: "", label: t("sentence_plan.cross.realm_placeholder") },
          ...(realms.data ?? []).map((r) => ({
            value: r.realm_code,
            label: resolveEnumDisplay(t, "realms.names", r.realm_code).label ?? r.realm_code,
          })),
        ]}
      />
      {chosen?.is_eternal && <p className={MUTED}>{t("sentence_plan.cross.eternal_hint")}</p>}
      <TextField
        label={t("sentence_plan.cross.years")}
        description={t("sentence_plan.cross.years_hint")}
        inputMode="numeric"
        value={years}
        onChange={(e) => setYears(e.target.value)}
        error={yearsInvalid ? t("sentence_plan.cross.years_invalid") : undefined}
      />
      <TextAreaField label={t("sentence_plan.cross.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      <Button type="submit" size="sm" loading={submit.isPending} disabled={!realmCode || yearsInvalid}>
        {t("sentence_plan.cross.submit")}
      </Button>
    </form>
  );
}

export function CrossJudgmentStops({ judgment }: { judgment: CrossTenantJudgment }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const seats = judgment.participants
    .filter((p) => p.role !== "ADVISOR")
    .sort((a, b) => (a.node_order ?? 0) - (b.node_order ?? 0));
  const [draft, setDraft] = useState<string[] | null>(null);
  const ordered = draft ? draft.map((id) => seats.find((s) => s.id === id)!).filter(Boolean) : seats;

  const mine = user?.tenant?.code ?? null;
  const canWrite = hasPermission("cross_judgment.create");
  const isInitiator = mine !== null && mine === judgment.initiating_tenant_code;
  const canReorder = canWrite && isInitiator && judgment.status === "PROPOSED" && seats.length > 1;
  const canFill = canWrite && (judgment.status === "PROPOSED" || judgment.status === "ACTIVE");
  const misplacedEternal = ordered.some(
    (s, i) => s.sentence_submitted_at && s.sentence_is_eternal && i !== ordered.length - 1
  );

  const saveOrder = useMutation({
    mutationFn: () => crossTenantJudgmentsApi.order(judgment.id, ordered.map((s) => s.id)),
    onSuccess: () => {
      setDraft(null);
      showToast(t("sentence_plan.cross.order_saved"), "success");
      queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
    },
    onError: (error) => showToast(errorText(error) ?? t("sentence_plan.cross.order_error"), "error"),
  });

  const move = (index: number, delta: number) => {
    const ids = ordered.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    setDraft(ids);
  };

  return (
    <section className="mb-6" aria-label={t("sentence_plan.cross.title")}>
      <h2 className="text-md text-[oklch(var(--color-ink))] mb-1">{t("sentence_plan.cross.title")}</h2>
      <p className={`${MUTED} mb-3`}>{t("sentence_plan.cross.hint")}</p>
      <ol className="space-y-2">
        <li className={ROW} data-stop="1">
          <span className="text-sm font-medium tabular-nums">{t("sentence_plan.stop", { order: "1" })}</span>
          <TenantName code={judgment.initiating_tenant_code} />
          <Badge tone="neutral">{t("sentence_plan.home")}</Badge>
          <span className={MUTED}>{t("sentence_plan.cross.home_stop")}</span>
        </li>
        {ordered.map((seat, index) => (
          <li key={seat.id} className={ROW} data-stop={index + 2} data-participant-id={seat.id}>
            <span className="text-sm font-medium tabular-nums">
              {t("sentence_plan.stop", { order: String(index + 2) })}
            </span>
            <TenantName code={seat.participant_tenant_code} />
            <DomainEnum namespace="crossJudgments.participant_roles" value={seat.role} />
            {seat.sentence_submitted_at ? (
              <span className={MUTED}>
                <DomainEnum namespace="realms.names" value={seat.sentence_realm_code} />
                {" · "}
                {seat.sentence_is_eternal
                  ? t("sentence_plan.eternal")
                  : seat.sentence_years == null
                    ? t("sentence_plan.years_unrecorded")
                    : t("sentence_plan.years", { years: String(seat.sentence_years) })}
              </span>
            ) : (
              <Badge tone="warning">{t("sentence_plan.cross.not_submitted")}</Badge>
            )}
            {canReorder && (
              <span className="ml-auto flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)}
                  aria-label={t("sentence_plan.cross.move_up", { order: String(index + 2) })}>
                  ↑
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)} aria-label={t("sentence_plan.cross.move_down", { order: String(index + 2) })}>
                  ↓
                </Button>
              </span>
            )}
            {canFill && mine === seat.participant_tenant_code && judgment.judgment && (
              <SentenceForm judgmentId={judgment.id} seat={seat} />
            )}
          </li>
        ))}
      </ol>
      {misplacedEternal && (
        <p role="alert" className="mt-2 text-sm text-[oklch(var(--color-status-warning))]">
          {t("sentence_plan.cross.eternal_not_last")}
        </p>
      )}
      {draft && (
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" loading={saveOrder.isPending} disabled={misplacedEternal} onClick={() => saveOrder.mutate()}>
            {t("sentence_plan.cross.save_order")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
      {seats.length === 0 && <p className={`${MUTED} mt-2`}>{t("sentence_plan.cross.no_stops")}</p>}
    </section>
  );
}
