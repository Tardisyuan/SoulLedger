"use client";

import type { Disposition, Reincarnation, Soul } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { RebirthFormSelect, type RebirthFormValue } from "@/src/components/souls/RebirthFormSelect";
import { Button } from "@/src/components/ui/Button";

/** Left column's 操作 card — the state-machine verbs available on this soul. */
export function SoulActionsCard({
  soul,
  loading,
  actionLoading,
  dispositions,
  reincarnations,
  rebirthForm,
  onRebirthFormChange,
  onDie,
  onStartJudgment,
  onReincarnate,
}: {
  soul: Soul | null;
  loading: boolean;
  actionLoading: string;
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
  rebirthForm: RebirthFormValue;
  onRebirthFormChange: (value: RebirthFormValue) => void;
  onDie: () => void;
  onStartJudgment: () => void;
  onReincarnate: (dispositionId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section aria-labelledby="soul-actions-title" className="min-w-0 space-y-4 bg-[oklch(var(--color-surface-1))] p-6">
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
                  />
                </div>
              )}
              {dispositions.filter(d => !d.is_executed).map((disp) => (
                <Button
                  key={disp.id}
                  type="button"
                  variant="primary"
                  size="lg"
                  className="h-auto min-h-10 w-full whitespace-normal py-2"
                  onClick={() => onReincarnate(disp.id)}
                  disabled={!!actionLoading}
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
