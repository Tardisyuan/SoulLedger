"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { judgmentAppealKeys, judgmentAppealsApi, type JudgmentAppeal } from "@soulledger/core/api";
import { useSentencePlans } from "@soulledger/core/hooks/useSentencePlans";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { TenantName } from "@/src/components/sentence-plan/sentencePlanDisplay";
import { APPEAL_IN_DIALOG_CODES, appealRefusalMessage, appealRefusalOf } from "@/src/components/judgment/appealDisplay";

/**
 * 复核结论弹层(Design 第五十二批 W-3)。
 *
 * - 维持 / 改判分段二选一,默认都不选;「作出结论」置灰到选了为止。
 * - 改判时原判那一项留在原位但不可选(「· 原判」),界面上撞不上 `verdict_unchanged`。
 * - 复核意见必填,灵魂会看到。
 * - 外地站:接口只在改判碰到联审带进来、还没开始的外地站时才说(400 `foreign_stops_choice_required`
 *   + `foreign_orders`),所以这一块在那之后才出现;一个整体选择「全部保留 / 全部撤掉」→ `keep_foreign_stops`。
 *   没选就点,这一块框变 danger。
 * - 拒绝(W-3b):`plan_in_transit` / `plan_busy` 写在弹层顶部、不关、输入保留;别的关弹层 + toast + 刷新。
 */

const VERDICTS = ["PASSED", "FAILED", "PURGATORY", "RETRY"] as const;
type Verdict = (typeof VERDICTS)[number];
type Outcome = "UPHELD" | "AMENDED";

const SEGMENT = "flex-1 min-h-(--control-h-md) px-3 text-sm border transition-colors";
const SEG_ON = "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))] border-[oklch(var(--color-ink))]";
const SEG_OFF = "border-[oklch(var(--color-line-strong))] text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]";

export function AppealDecideDialog({ appeal, isOpen, onClose }: { appeal: JudgmentAppeal; isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const [noteMissing, setNoteMissing] = useState(false);
  const [foreignOrders, setForeignOrders] = useState<number[] | null>(null);
  const [keepForeign, setKeepForeign] = useState<boolean | null>(null);
  const [foreignMissing, setForeignMissing] = useState(false);
  const [inDialog, setInDialog] = useState<string | null>(null);
  const plans = useSentencePlans({ soul: appeal.soul }, !!foreignOrders);
  const nodes = (plans.data?.results ?? []).flatMap((p) => p.nodes).filter((n) => foreignOrders?.includes(n.order));

  const refresh = () => queryClient.invalidateQueries({ queryKey: judgmentAppealKeys.all });
  const decide = useMutation({
    mutationFn: () =>
      judgmentAppealsApi.decide(appeal.id, {
        outcome: outcome!,
        note: note.trim(),
        ...(outcome === "AMENDED" && verdict ? { verdict } : {}),
        ...(foreignOrders && keepForeign !== null ? { keep_foreign_stops: keepForeign } : {}),
      }),
    onSuccess: () => {
      showToast(t("appeals.decided_toast"), "success");
      void refresh();
      onClose();
    },
    onError: (err) => {
      const refusal = appealRefusalOf(err);
      if (refusal?.code === "foreign_stops_choice_required") {
        setForeignOrders(refusal.foreignOrders ?? []);
        setForeignMissing(false);
        return;
      }
      if (refusal && APPEAL_IN_DIALOG_CODES.includes(refusal.code)) {
        setInDialog(t(`appeals.error.${refusal.code}`));
        return;
      }
      showToast(appealRefusalMessage(err, t), "error");
      void refresh();
      onClose();
    },
  });

  const ready = outcome === "UPHELD" || (outcome === "AMENDED" && verdict !== null);
  const submit = () => {
    setInDialog(null);
    if (!note.trim()) return setNoteMissing(true);
    if (foreignOrders && keepForeign === null) return setForeignMissing(true);
    decide.mutate();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      wide
      title={t("appeals.decide_title", { case: appeal.case_number })}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" data-testid="appeal-decide-submit" disabled={!ready} loading={decide.isPending} onClick={submit}>
            {t("appeals.decide_action")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {inDialog && (
          <p role="alert" data-testid="appeal-decide-in-dialog" className="px-3 py-2 text-sm bg-[oklch(var(--color-status-warning)/0.1)] text-[oklch(var(--color-ink))]">
            {inDialog}
          </p>
        )}
        <div className="flex" role="group" aria-label={t("appeals.decide_action")}>
          {(["UPHELD", "AMENDED"] as const).map((o) => (
            <button
              key={o}
              type="button"
              data-testid={`appeal-outcome-${o}`}
              aria-pressed={outcome === o}
              onClick={() => setOutcome(o)}
              className={`${SEGMENT} ${outcome === o ? SEG_ON : SEG_OFF}`}
            >
              {t(o === "UPHELD" ? "appeals.uphold" : "appeals.amend")}
            </button>
          ))}
        </div>
        {outcome === "AMENDED" && (
          <fieldset className="space-y-1" data-testid="appeal-verdicts">
            <legend className="text-sm text-[oklch(var(--color-ink-muted))] mb-1">{t("appeals.pick_verdict")}</legend>
            {VERDICTS.map((v) => {
              const original = v === appeal.original_verdict;
              return (
                <label key={v} className={`flex items-center gap-2 text-sm ${original ? "text-[oklch(var(--color-ink-subtle))]" : ""}`}>
                  <input type="radio" name="appeal-verdict" value={v} disabled={original} checked={verdict === v} onChange={() => setVerdict(v)} />
                  <DomainEnum namespace="judgment.verdicts" value={v} />
                  {original && <span>· {t("appeals.original_verdict")}</span>}
                </label>
              );
            })}
            <p className="text-xs text-[oklch(var(--color-ink-muted))] pt-1">{t("appeals.amend_impact")}</p>
          </fieldset>
        )}
        <TextAreaField
          label={t("appeals.decision_note")}
          required
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (e.target.value.trim()) setNoteMissing(false);
          }}
          description={noteMissing ? undefined : t("appeals.note_required")}
          error={noteMissing ? t("appeals.note_required") : null}
          className="[&_textarea]:font-serif"
        />
        {foreignOrders && (
          <div
            data-testid="appeal-foreign"
            className={`border px-3 py-3 space-y-2 ${foreignMissing ? "border-[oklch(var(--color-status-error))]" : "border-[oklch(var(--color-line))]"}`}
          >
            <p className="text-sm font-medium text-[oklch(var(--color-ink))]">{t("appeals.decide.foreign_title")}</p>
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("appeals.decide.foreign_hint")}</p>
            <ul className="text-sm space-y-0.5">
              {foreignOrders.map((order) => {
                const node = nodes.find((n) => n.order === order);
                return (
                  <li key={order}>
                    {t("sentence_plan.stop", { order: String(order) })}
                    {node && (
                      <>
                        {" · "}
                        <TenantName code={node.tenant_code} />
                        {" · "}
                        <DomainEnum namespace="realms.names" value={node.realm_code} />
                      </>
                    )}
                    {" · "}
                    <DomainEnum namespace="sentence_plan.node_states" value="PENDING" />
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-4" role="radiogroup">
              {([true, false] as const).map((keep) => (
                <label key={String(keep)} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="appeal-foreign"
                    data-testid={`appeal-foreign-${keep ? "keep" : "remove"}`}
                    checked={keepForeign === keep}
                    onChange={() => {
                      setKeepForeign(keep);
                      setForeignMissing(false);
                    }}
                  />
                  {t(keep ? "appeals.decide.foreign_keep" : "appeals.decide.foreign_remove")}
                </label>
              ))}
            </div>
            {foreignMissing && (
              <p role="alert" className="text-xs text-[oklch(var(--color-status-error))]">
                {t("appeals.decide.foreign_required")}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
