"use client";

import type { Disposition, Reincarnation, Soul } from "@soulledger/core/api";
import { quotaIsFull, type RebirthQuotaFull, type RebirthQuotaUsage } from "@soulledger/core/api/reincarnation";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { RebirthFormSelect, type RebirthFormValue } from "@/src/components/souls/RebirthFormSelect";
import { Button } from "@/src/components/ui/Button";
import { SoupBlock } from "@/src/components/souls/detail/SoupBlock";

/** Left column's 操作 card — the state-machine verbs available on this soul. */
export function SoulActionsCard({
  soul,
  loading,
  actionLoading,
  dispositions,
  reincarnations,
  rebirthForm,
  suggestedRebirthForm,
  onRebirthFormChange,
  onDie,
  onStartJudgment,
  onReincarnate,
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
  /** null = 还没选(地府里没有建议时不预选)。 */
  rebirthForm: RebirthFormValue | null;
  /** 第十殿按功过给的六道建议(处置的 `suggested_rebirth_form`);地府以外为 null。 */
  suggestedRebirthForm?: RebirthFormValue | null;
  onRebirthFormChange: (value: RebirthFormValue) => void;
  onDie: () => void;
  onStartJudgment: () => void;
  onReincarnate: (dispositionId: string) => void;
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
          {soul?.current_state === "DISPOSED" && (
            <RequirePermission permissions="reincarnation.reborn">
              {/* The form is chosen before the destination realm, not
                  after: each button below commits the rebirth
                  immediately, so there is no later screen on which to
                  pick 道. Rendered only when there is something to
                  commit — a soul with no pending disposition has no
                  rebirth to configure. */}
              {dispositions.some(d => !d.is_executed) && (
                <div className="pb-3 mb-3 border-b border-[oklch(var(--color-hairline))]">
                  <RebirthFormSelect
                    value={rebirthForm}
                    onChange={onRebirthFormChange}
                    disabled={!!actionLoading}
                    quota={quota}
                  />
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
                  disabled={!!actionLoading || !!full || !rebirthForm}
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
