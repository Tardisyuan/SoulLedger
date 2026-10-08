"use client";

import { useRef, useState, type ReactNode } from "react";
import type { OfficerCooldownShortening } from "@soulledger/core/api";
import {
  classifySoulAccountError,
  useApproveCooldownShortening,
  useCooldownShortening,
  useRejectCooldownShortening,
} from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Field, TextAreaField, fieldControl } from "@/src/components/ui/Field";
import { badgeVariants } from "@/src/components/ui/Badge";
import { cooldownEnded, cooldownTone, failureKey, isoDay, lifeNumber } from "./soulAccountsView";

/**
 * A11 详情:四列字段、两段正文、决定区。决定区只在「待决定、冷却未结束、有 workflow.approve」时出现;
 * 按钮在弹层的页脚(393 下是固定在底页底部的 56 高两枚,驳回 1 : 批准 1.4)。
 *
 * 校验只在点按钮的那一刻:驳回缺说明 -> 说明框变危险色、焦点回到说明框;批准的天数不合法 -> 天数框下给提示。
 * 按钮从不预先禁用(除了请求在途)。服务端拒绝 -> 顶部 toast「未能决定:原因」,弹层不关,
 * 详情按服务端现状刷新(`useCooldownShortening` 不看列表的筛选,行被决定走了也读得到)。
 */
export function CooldownShorteningDetail({ row: listed, onClose }: { row: OfficerCooldownShortening; onClose: () => void }) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const r = useCooldownShortening(listed.id, listed).data;
  const approve = useApproveCooldownShortening();
  const reject = useRejectCooldownShortening();
  const [days, setDays] = useState("0");
  const [note, setNote] = useState("");
  const [daysError, setDaysError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const daysBox = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLDivElement>(null);

  const ended = cooldownEnded(r);
  const canDecide = r.status === "PENDING" && !ended && hasPermission("workflow.approve");
  const busy = approve.isPending || reject.isPending;
  const onError = (error: unknown) =>
    showToast(
      t("soul_accounts.cooldown.decide_failed", { reason: t(failureKey(classifySoulAccountError(error), "soul_accounts.cooldown.failed")) }),
      "error"
    );
  const onSuccess = () => showToast(t("soul_accounts.cooldown.decided"), "success");

  const doApprove = () => {
    const n = Number(days);
    // The backend's rule, applied before the round trip: 0 ≤ days < remaining_days.
    if (days.trim() === "" || !Number.isInteger(n) || n < 0 || n >= r.remaining_days) {
      setDaysError(t("soul_accounts.cooldown.invalid_days"));
      daysBox.current?.querySelector("input")?.focus();
      return;
    }
    setDaysError(null);
    approve.mutate({ id: r.id, days: n, note }, { onSuccess, onError });
  };
  const doReject = () => {
    if (!note.trim()) {
      setNoteError(t("soul_accounts.cooldown.note_required"));
      noteBox.current?.querySelector("textarea")?.focus();
      return;
    }
    setNoteError(null);
    reject.mutate({ id: r.id, note }, { onSuccess, onError });
  };

  const field = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <dt className="text-2xs tracking-widest text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="mt-1 break-words text-sm text-[oklch(var(--color-ink))]">{value}</dd>
    </div>
  );
  const heading = "text-2xs tracking-widest text-[oklch(var(--color-ink-subtle))] mb-1";
  const endDay = r.cooldown_end ? isoDay(r.cooldown_end) : null;
  const wasDay = r.status === "APPROVED" && r.cooldown_original_until ? isoDay(r.cooldown_original_until) : null;

  const footer = canDecide ? (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center" data-testid="cooldown-decision-bar">
      <p className="text-xs text-[oklch(var(--color-ink-muted))] sm:flex-1">{t("soul_accounts.cooldown.scope_note")}</p>
      <div className="flex gap-3 sm:justify-end">
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="flex-1 sm:flex-none sm:h-(--control-h-md)"
          loading={reject.isPending}
          disabled={busy}
          onClick={doReject}
          data-testid="shortening-reject"
        >
          {t("soul_accounts.cooldown.reject")}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="primary"
          className="flex-[1.4] sm:flex-none sm:h-(--control-h-md)"
          loading={approve.isPending}
          disabled={busy}
          onClick={doApprove}
          data-testid="shortening-approve"
        >
          {t("soul_accounts.cooldown.approve_with_days", { days: String(Number.isFinite(Number(days)) && days.trim() !== "" ? days : 0) })}
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex justify-end">
      <Button type="button" size="lg" variant="secondary" className="w-full sm:w-auto sm:h-(--control-h-md)" onClick={onClose}>
        {t("common.close")}
      </Button>
    </div>
  );

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      wide
      titleClassName="font-title text-xl"
      title={t("soul_accounts.cooldown.detail_title", { name: r.soul_name })}
      footer={footer}
    >
      <div className="space-y-4">
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">
          <span className="font-mono">{r.soul_code}</span> · {t("soul_accounts.cooldown.source", { id: r.application.slice(0, 8) })}
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
          {field(t("soul_accounts.fields.soul_code"), <span className="font-mono">{r.soul_code}</span>)}
          {field(t("soul_accounts.fields.cycle"), t("soul_accounts.life", { n: lifeNumber(r.cycle) }))}
          {field(
            t("soul_accounts.fields.status"),
            <DomainEnum namespace="soul_accounts.cooldown_status" value={r.status} className={badgeVariants({ tone: cooldownTone(r.status) })} />
          )}
          {field(t("soul_accounts.cooldown.fields.created_at"), <span className="font-mono">{formatDateTime(r.created_at)}</span>)}
          {field(
            t("soul_accounts.cooldown.fields.cooldown_until"),
            endDay ? (
              <span className="font-mono">
                {endDay}
                {wasDay && wasDay !== endDay ? ` (${t("soul_accounts.cooldown.original", { date: wasDay.slice(5) })})` : ""}
              </span>
            ) : (
              "-"
            )
          )}
          {field(
            t("soul_accounts.cooldown.fields.remaining"),
            ended ? `○ ${t("soul_accounts.cooldown.over")}` : t("soul_accounts.cooldown.remaining_days", { n: String(r.remaining_days) })
          )}
          {r.status === "APPROVED" &&
            field(t("soul_accounts.cooldown.fields.approved_days"), t("soul_accounts.cooldown.remaining_days", { n: String(r.approved_days ?? 0) }))}
          {r.decided_at &&
            field(
              t("soul_accounts.cooldown.fields.decided_by"),
              <span>
                {r.decided_by_username ?? "-"} · <span className="font-mono">{formatDateTime(r.decided_at)}</span>
              </span>
            )}
        </dl>

        <section>
          <h3 className={heading}>{t("soul_accounts.cooldown.fields.reason")}</h3>
          <p className="text-md whitespace-pre-wrap break-words">{r.reason}</p>
        </section>
        {r.decision_note && (
          <section>
            <h3 className={heading}>{t("soul_accounts.cooldown.fields.note")}</h3>
            <p className="text-md whitespace-pre-wrap break-words">{r.decision_note}</p>
          </section>
        )}

        {canDecide && (
          <section className="border-t border-[oklch(var(--color-line-strong))] pt-4 space-y-4" data-testid="cooldown-decision">
            <div ref={daysBox}>
              <Field label={t("soul_accounts.cooldown.days_label")} error={daysError}>
                {(control) => (
                  <div className="flex items-center gap-3">
                    <div className="relative w-40 shrink-0">
                      <input
                        {...control}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={Math.max(0, r.remaining_days - 1)}
                        value={days}
                        onChange={(e) => {
                          setDays(e.target.value);
                          setDaysError(null);
                        }}
                        data-testid="shortening-days"
                        className={`${fieldControl({ size: "md", invalid: Boolean(daysError) })} w-full pr-8 font-mono`}
                      />
                      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[oklch(var(--color-ink-muted))]">
                        {t("soul_accounts.cooldown.day_unit")}
                      </span>
                    </div>
                    <span className="text-2xs text-[oklch(var(--color-ink-subtle))]">
                      {t("soul_accounts.cooldown.days_hint", { n: String(r.remaining_days) })}
                    </span>
                  </div>
                )}
              </Field>
            </div>
            <div ref={noteBox}>
              <TextAreaField
                label={t("soul_accounts.cooldown.note_label")}
                description={noteError ? undefined : t("soul_accounts.cooldown.note_hint")}
                value={note}
                maxLength={2000}
                rows={3}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteError(null);
                }}
                data-testid="shortening-note"
                error={noteError}
              />
            </div>
          </section>
        )}
      </div>
    </BaseModal>
  );
}
