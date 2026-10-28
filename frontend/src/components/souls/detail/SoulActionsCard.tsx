"use client";

import type { Disposition, Reincarnation, Soul } from "@soulledger/core/api";
import { quotaIsFull, type RebirthQuotaFull, type RebirthQuotaUsage } from "@soulledger/core/api/reincarnation";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { RebirthFormSelect, type RebirthFormValue } from "@/src/components/souls/RebirthFormSelect";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { SoupBlock } from "@/src/components/souls/detail/SoupBlock";
import { formatHistoricalDate } from "@/lib/utils";

/** 四大部洲(docs/07 §人道),`Soul.Continent` 的次序。 */
const CONTINENTS = ["DONGSHENG", "NANZHAN", "XINIU", "BEIJULU"] as const;

/** Left column's 操作 card — the state-machine verbs available on this soul. */
export function SoulActionsCard({
  soul,
  loading,
  actionLoading,
  dispositions,
  reincarnations,
  sixPaths = true,
  rebirthForm,
  nextContinent = "",
  onNextContinentChange,
  suggestedRebirthForm,
  desiredRebirthForm = null,
  formReason = "",
  onFormReasonChange,
  onRebirthFormChange,
  onDie,
  onStartJudgment,
  onReincarnate,
  onRelease,
  quota,
  quotaRefusal,
  soupRefused,
  onDrinkSoup,
}: {
  soul: Soul | null;
  loading: boolean;
  actionLoading: string;
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  /** 这个灵魂转世走六道(原属地府)。false = 希腊:饮忘川后再生,没有道可选,不画选择器(2026-10-27 G-2)。 */
  sixPaths?: boolean;
  /** null = 还没选(地府里没有建议时不预选)。 */
  rebirthForm: RebirthFormValue | null;
  /** 下一世部洲(第五十七批 S-3),只在人道时出现;"" = 同本世(本世未登记时是「不指定」)。 */
  nextContinent?: string;
  onNextContinentChange?: (value: string) => void;
  /** 第十殿按功过给的六道建议(处置的 `suggested_rebirth_form`);地府以外为 null。 */
  suggestedRebirthForm?: RebirthFormValue | null;
  /** 本世已批准的转生申请里灵魂选的道(2026-10-29);默认选它,改了要写原因。没有为 null。 */
  desiredRebirthForm?: RebirthFormValue | null;
  formReason?: string;
  onFormReasonChange?: (value: string) => void;
  onRebirthFormChange: (value: RebirthFormValue) => void;
  onDie: () => void;
  onStartJudgment: () => void;
  onReincarnate: (dispositionId: string) => void;
  /** 期满释放(2026-10-29):执行了、刑期已满的处置;没有就不画按钮。 */
  onRelease?: (dispositionId: string) => void;
  /** 办转世被 409 `rebirth_quota_full` 拒了(并发时配额刚被别人用完):同一句话留在这里,不弹 toast。 */
  quotaRefusal?: RebirthQuotaFull | null;
  /** 本月配额(`/reincarnation/quota/`,页面在有转世可办时才取);没有就不标、不拦。 */
  quota?: readonly RebirthQuotaUsage[];
  /** 办转世被 409 `soup_not_taken` 拒了:孟婆汤那一块多一句说明,登记之后可以直接再点「转世」。 */
  soupRefused?: boolean;
  onDrinkSoup?: () => Promise<void>;
}) {
  const { t } = useI18n();
  // 本月配额(第五十一批 Q-3):满了的道照样能选,选了它按钮置灰,下面写拒绝那句话 ——
  // 不放一个点了必然被拒的按钮。灵魂留在原处(待转世)。
  const chosen = quota?.find((r) => r.rebirth_form === rebirthForm);
  const full =
    quotaRefusal && quotaRefusal.rebirth_form === rebirthForm
      ? quotaRefusal
      : chosen && quotaIsFull(chosen)
        ? { rebirth_form: chosen.rebirth_form, used: chosen.used, limit: chosen.limit as number }
        : null;

  // 选的道与灵魂所愿不同:要写原因才能办(服务端 400 `rebirth_form_reason_required` 同一条)。
  const needsReason = !!desiredRebirthForm && !!rebirthForm && rebirthForm !== desiredRebirthForm;
  const reasonMissing = needsReason && !formReason.trim();

  return (
    <section aria-labelledby="soul-actions-title" data-print-hide="" className="min-w-0 space-y-4 bg-[oklch(var(--color-surface-1))] p-6">
      <h2 id="soul-actions-title" className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
        {t("souls.detail.actions")}
      </h2>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="space-y-2">
          {soul?.current_state === "ALIVE" && (
            <RequirePermission permissions="soul.die">
              {/* Primary (v3: the civilization's main colour), not status-error. Recording a death is the
                  central verb of this product, not a failure — and the
                  error token is what genuinely destructive actions
                  (删除, below) use, so spending it here drains the
                  signal from both. */}
              <Button type="button" variant="primary" size="lg" className="w-full" onClick={onDie} disabled={!!actionLoading}>
                {actionLoading === "die" ? t("souls.detail.processing") : t("souls.detail.mark_dead")}
              </Button>
            </RequirePermission>
          )}
          {soul?.current_state === "JUDGING" && (
            <div className="space-y-2">
              <p className="text-xs text-[oklch(var(--color-ink-muted))] text-center">{t("souls.detail.render_judgment")}</p>
              <RequirePermission permissions="judgment.create">
                <Button type="button" variant="primary" size="lg" className="w-full" onClick={onStartJudgment} disabled={!!actionLoading}>
                  {actionLoading === "judge" ? t("souls.detail.processing") : t("souls.detail.start_judgment")}
                </Button>
              </RequirePermission>
            </div>
          )}
          {soul?.current_state === "DISPOSED" &&
            // 服刑中(执行了、没记期满、有期满日;2026-10-29):刑满才往下走。期满日已到的给「期满释放」。
            dispositions
              .filter((d) => d.is_executed && !d.expired_at && !d.is_eternal && d.term_end)
              .map((d) => (
                <div key={`serving-${d.id}`} data-testid="soul-serving" className="space-y-2 text-center text-sm text-[oklch(var(--color-ink-muted))]">
                  <p>{t("disposition.serving_until", { date: formatHistoricalDate(d.term_end) ?? "" })}</p>
                  {d.can_release && onRelease && (
                    <RequirePermission permissions="disposition.execute">
                      <Button type="button" variant="secondary" size="sm" onClick={() => onRelease(d.id)} disabled={!!actionLoading}>
                        {t("disposition.release")}
                      </Button>
                    </RequirePermission>
                  )}
                </div>
              ))}
          {soul?.current_state === "DISPOSED" && (
            <RequirePermission permissions="reincarnation.reborn">
              {/* The form is chosen before the destination realm, not
                  after: each button below commits the rebirth
                  immediately, so there is no later screen on which to
                  pick 道. Rendered only when there is something to
                  commit — a soul with no pending disposition has no
                  rebirth to configure. */}
              {sixPaths && dispositions.some(d => !d.is_executed) && (
                <div className="pb-3 mb-3 border-b border-[oklch(var(--color-hairline))]">
                  <RebirthFormSelect
                    value={rebirthForm}
                    onChange={onRebirthFormChange}
                    disabled={!!actionLoading}
                    quota={quota}
                  />
                  {rebirthForm === "HUMAN" && onNextContinentChange && (
                    <SelectField
                      id="rebirth-next-continent"
                      className="mt-3"
                      label={t("reincarnation.next_continent")}
                      description={t("reincarnation.next_continent_hint")}
                      value={nextContinent}
                      onChange={(e) => onNextContinentChange(e.target.value)}
                      disabled={!!actionLoading}
                      options={[
                        {
                          value: "",
                          label: soul?.birth_continent
                            ? `${t(`souls.birth_continent.${soul.birth_continent}`)} · ${t("reincarnation.next_continent_same")}`
                            : t("reincarnation.next_continent_unset"),
                        },
                        ...CONTINENTS.filter((c) => c !== soul?.birth_continent).map((c) => ({
                          value: c,
                          label: t(`souls.birth_continent.${c}`),
                        })),
                      ]}
                    />
                  )}
                  {desiredRebirthForm && (
                    <p data-testid="rebirth-desired" className="mt-2 text-xs text-[oklch(var(--color-ink))]">
                      {t("reincarnation.desired_form", { form: t(`reincarnation.forms.${desiredRebirthForm}`) })}
                    </p>
                  )}
                  {needsReason && onFormReasonChange && (
                    <TextField
                      id="rebirth-form-reason"
                      className="mt-3"
                      label={t("reincarnation.form_reason")}
                      description={t("reincarnation.form_reason_hint")}
                      required
                      maxLength={500}
                      value={formReason}
                      onChange={(e) => onFormReasonChange(e.target.value)}
                      disabled={!!actionLoading}
                    />
                  )}
                  {suggestedRebirthForm && (
                    <p data-testid="rebirth-suggestion" className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]">
                      {t("souls.detail.rebirth_suggestion", { form: t(`reincarnation.forms.${suggestedRebirthForm}`) })}
                    </p>
                  )}
                  {!rebirthForm && (
                    <p role="status" data-testid="rebirth-pick-form" className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]">
                      {t("souls.detail.rebirth_pick_form")}
                    </p>
                  )}
                  {full && (
                    <p role="status" data-testid="rebirth-quota-full" className="mt-3 text-xs text-[oklch(var(--color-ink-muted))]">
                      {t("rebirths.quota.full", {
                        form: t(`reincarnation.forms.${full.rebirth_form}`),
                        used: String(full.used),
                        limit: String(full.limit),
                      })}
                    </p>
                  )}
                </div>
              )}
              {dispositions.filter(d => !d.is_executed).map((disp) => (
                <Button
                  key={disp.id}
                  type="button"
                  variant="primary"
                  size="lg"
                  className="h-auto min-h-(--control-h-md) w-full whitespace-normal py-2"
                  onClick={() => onReincarnate(disp.id)}
                  disabled={!!actionLoading || !!full || (sixPaths && !rebirthForm) || reasonMissing}
                >
                  {actionLoading === "reincarnate" ? t("souls.detail.processing") : `${t("souls.detail.reincarnate")} ${disp.realm_name || disp.realm_code || t("souls.detail.destination")}`}
                </Button>
              ))}
            </RequirePermission>
          )}
          {soul?.current_state === "REINCARNATING" && (
            <div className="text-center text-[oklch(var(--color-ink-muted))] text-sm py-2">
              <span aria-hidden="true">↻ </span>
              {t("souls.detail.being_reborn")}
            </div>
          )}
          {soul?.current_state === "REINCARNATING" && soul.civilization === "CHINESE" && onDrinkSoup && (
            <SoupBlock name={soul.name} takenAt={soul.soup_taken_at} refused={!!soupRefused} onRegister={onDrinkSoup} />
          )}
          {soul?.current_state === "REINCARNATING" && soupRefused && soul.soup_taken_at && (
            <RequirePermission permissions="reincarnation.reborn">
              {dispositions.filter((d) => !d.is_executed).map((disp) => (
                <Button
                  key={disp.id}
                  type="button"
                  variant="primary"
                  size="lg"
                  className="h-auto min-h-(--control-h-md) w-full whitespace-normal py-2"
                  onClick={() => onReincarnate(disp.id)}
                  disabled={!!actionLoading}
                >
                  {`${t("souls.detail.reincarnate")} ${disp.realm_name || disp.realm_code || t("souls.detail.destination")}`}
                </Button>
              ))}
            </RequirePermission>
          )}
          {soul?.current_state === "ALIVE" && reincarnations.length > 0 && (
            <div className="text-center text-[oklch(var(--color-ink-subtle))] text-xs pt-2">
              {reincarnations.length} {t("souls.detail.previous_reincarnations")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
