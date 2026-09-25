"use client";

import { useState } from "react";
import type { LedgerRecord } from "@soulledger/core/api";
import type { AdmittedBalance, EvidenceAdmission } from "@soulledger/core/api/judgment";
import { useRuleEvidence } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum, DomainNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { JudgmentSectionHead } from "@/src/components/judgment/JudgmentGroundsPanel";
import { Kbd } from "@/src/components/judgment/JudgmentDesk";
import { ReasonDialog } from "@/src/components/judgment/JudgmentClaimDialogs";
import { formatHistoricalDate } from "@/lib/utils";

/**
 * 丙 · 证据 · 采信(规范 v1 第三类 A·01 的 EvidenceRow)。
 *
 * 证据是这一世的功过记录 —— 服务端 `EvidenceAdmissionService.rule` 只接受「同一灵魂、同一世、
 * MERIT / DEMERIT」的记录,所以这里只列这两类。没有裁定的记录就是采信的(`evidence_admissions`
 * 只列做过的裁定)。不采信必须写理由;采信回来不要理由。
 *
 * 每行的焦点落在它的采信开关上(一个 `role="checkbox"` 的按钮),空格切换**获焦的那一行** ——
 * 那是按钮自己的原生激活,不另挂键盘监听:挂在 `<li>` 上要把非交互元素变成可获焦的,
 * 挂在按钮上又会与原生激活各切一次。于是打字时(焦点在判词框、理由框里)空格天然只是空格。
 * 行用 `focus-within` 显出焦点。
 *
 * 余额行是服务端的 `admitted_balance`,不在前端重算:它与功过总账同一套衰减算法,只是跳过
 * 不采信的记录。不是余额读法的文明(埃及、欧洲、希腊)`balance` 为 null,写「不适用」。
 */

const NOT_CURRENT_LIFE = "NOT_CURRENT_LIFE";
const SCORED = new Set(["MERIT", "DEMERIT"]);

export function JudgmentEvidenceAdmission({
  judgmentId,
  records,
  admissions,
  balance,
  canRule,
}: {
  judgmentId: string;
  /** `/souls/{id}/karma/` 的 records —— 灵魂当前这一世。 */
  records: LedgerRecord[] | undefined;
  admissions: EvidenceAdmission[];
  balance: AdmittedBalance | undefined;
  /** 未结案且持 judgment.execute。否则只读。 */
  canRule: boolean;
}) {
  const { t, formatDate } = useI18n();
  const { showToast } = useToast();
  const rule = useRuleEvidence(judgmentId);
  const [asking, setAsking] = useState<LedgerRecord | null>(null);

  const rulings = new Map(admissions.map((a) => [a.record, a]));
  const evidence = (records ?? []).filter((r) => SCORED.has(r.type));
  const admittedCount = evidence.filter((r) => rulings.get(r.id)?.admitted !== false).length;
  const otherLife = balance?.reason_code === NOT_CURRENT_LIFE;

  const send = (record: LedgerRecord, admitted: boolean, reason?: string) =>
    rule.mutate(
      { recordId: record.id, data: admitted ? { admitted: true } : { admitted: false, reason } },
      {
        onSuccess: () => setAsking(null),
        onError: () => showToast(t("judgment.admission.rule_error"), "error"),
      }
    );

  /** 采信 → 不采信要理由(开弹层);不采信 → 采信直接发。 */
  const toggle = (record: LedgerRecord) => {
    if (!canRule || rule.isPending) return;
    if (rulings.get(record.id)?.admitted === false) send(record, true);
    else setAsking(record);
  };

  const net = balance?.not_admitted_net;
  const notAdmitted = balance?.not_admitted_count ?? evidence.length - admittedCount;

  return (
    <section className="min-w-0" data-testid="evidence-admission">
      <JudgmentSectionHead
        mark="丙"
        title={t("judgment.admission.title")}
        meta={otherLife || evidence.length === 0 ? undefined : `${admittedCount} / ${evidence.length}`}
      />
      {canRule && evidence.length > 0 && !otherLife && (
        <p className="mt-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] max-md:hidden">
          <Kbd>␣</Kbd> {t("judgment.admission.toggle_hint")}
        </p>
      )}

      {otherLife ? (
        <p className="py-3 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.admission.not_current_life")}</p>
      ) : evidence.length === 0 ? (
        <p className="py-3 text-sm text-[oklch(var(--color-ink-subtle))]">
          {records ? t("judgment.admission.empty") : t("common.loading")}
        </p>
      ) : (
        <ul className="mt-2">
          {evidence.map((record) => {
            const ruling = rulings.get(record.id);
            const admitted = ruling?.admitted !== false;
            const when = formatHistoricalDate(record.event_date) ?? formatDate(record.recorded_at);
            const signed = record.type === "MERIT" ? record.original_weight : -record.original_weight;
            const label = record.description || record.category;
            return (
              <li
                key={record.id}
                data-testid="evidence-row"
                data-admitted={admitted ? "true" : "false"}
                className={`grid grid-cols-[24px_minmax(0,1fr)_60px] md:grid-cols-[24px_88px_minmax(0,1fr)_60px] items-center gap-x-3 min-h-10 max-md:min-h-11 py-1 border-b border-[oklch(var(--color-rule))] focus-within:bg-[oklch(var(--color-surface-2))] ${
                  admitted ? "" : "opacity-65"
                }`}
              >
                {canRule ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={admitted}
                    aria-label={t("judgment.admission.toggle_row", { item: label })}
                    disabled={rule.isPending}
                    onClick={() => toggle(record)}
                    className={`h-3.5 w-3.5 max-sm:h-5 max-sm:w-5 border text-2xs leading-3 text-center ${
                      admitted
                        ? "border-[oklch(var(--color-accent))] bg-[oklch(var(--color-accent))] text-[oklch(var(--color-canvas))]"
                        : "border-[oklch(var(--color-block))]"
                    }`}
                  >
                    {admitted ? "✓" : ""}
                  </button>
                ) : (
                  <span aria-label={admitted ? undefined : t("judgment.admission.confirm_not_admit")} className="font-mono text-xs text-center">
                    {admitted ? "✓" : "✕"}
                  </span>
                )}
                <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-subtle))] max-md:hidden">{when}</span>
                <span className="min-w-0">
                  <span className={`block text-sm text-[oklch(var(--color-ink))] truncate ${admitted ? "" : "line-through"}`} title={label}>
                    {label || <MissingValue kind="unrecorded" />}
                  </span>
                  <span
                    className="block text-xs text-[oklch(var(--color-ink-muted))] truncate"
                    title={admitted ? record.category || undefined : ruling?.reason || undefined}
                  >
                    {admitted ? (
                      <DomainEnum namespace="souls.categories" value={record.category} />
                    ) : (
                      t("judgment.admission.reason_shown", { reason: ruling?.reason ?? "" })
                    )}
                  </span>
                </span>
                <span className="text-right text-xs">
                  <DomainNumber value={signed} signed toned={admitted} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!otherLife && evidence.length > 0 && balance && (
        <div data-testid="admitted-balance" className="flex items-baseline justify-between gap-3 pt-2 border-t border-[oklch(var(--color-block))] text-sm">
          <span className="text-[oklch(var(--color-ink-muted))]">
            {t("judgment.admission.balance_label")}
            {net !== null && net !== undefined
              ? t("judgment.admission.not_admitted_net", {
                  n: String(notAdmitted),
                  net: `${net > 0 ? "+" : net < 0 ? "−" : ""}${Math.abs(Math.round(net))}`,
                })
              : t("judgment.admission.not_admitted_count", { n: String(notAdmitted) })}
          </span>
          <DomainNumber
            value={balance.balance}
            signed
            toned
            missingKind="inapplicable"
            className="text-md font-semibold"
          />
        </div>
      )}

      <ReasonDialog
        isOpen={asking !== null}
        title={t("judgment.admission.reason_title", { item: asking ? asking.description || asking.category : "" })}
        hint={t("judgment.admission.reason_hint")}
        confirmText={t("judgment.admission.confirm_not_admit")}
        pending={rule.isPending}
        onCancel={() => setAsking(null)}
        onConfirm={(reason) => asking && send(asking, false, reason)}
      />
    </section>
  );
}
