"use client";

import type { Disposition, Reincarnation, Soul } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { RebirthFormSelect, type RebirthFormValue } from "@/src/components/souls/RebirthFormSelect";

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
    <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
      <h2 className="text-03 font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{t("souls.detail.actions")}</h2>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="space-y-2">
          {soul?.current_state === "ALIVE" && (
            <RequirePermission permissions="soul.die">
              {/* Accent, not status-error. Recording a death is the
                  central verb of this product, not a failure — and the
                  error token is what genuinely destructive actions
                  (删除, below) use, so spending it here drains the
                  signal from both. */}
              <button
                onClick={onDie}
                disabled={!!actionLoading}
                className="w-full py-2 px-4 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black disabled:opacity-50 text-03 font-medium transition-colors"
              >
                {actionLoading === "die" ? t("souls.detail.processing") : t("souls.detail.mark_dead")}
              </button>
            </RequirePermission>
          )}
          {soul?.current_state === "JUDGING" && (
            <div className="space-y-2">
              <p className="text-02 text-[hsl(var(--color-ink-muted))] text-center">{t("souls.detail.render_judgment")}</p>
              <RequirePermission permissions="judgment.create">
                <button
                  onClick={onStartJudgment}
                  disabled={!!actionLoading}
                  className="w-full py-2 px-4 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent)/0.8)] disabled:opacity-50 text-black text-03 font-medium transition-colors"
                >
                  {actionLoading === "judge" ? t("souls.detail.processing") : t("souls.detail.start_judgment")}
                </button>
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
                <div className="pb-3 mb-3 border-b border-[hsl(var(--color-hairline))]">
                  <RebirthFormSelect
                    value={rebirthForm}
                    onChange={onRebirthFormChange}
                    disabled={!!actionLoading}
                  />
                </div>
              )}
              {dispositions.filter(d => !d.is_executed).map((disp) => (
                <button
                  key={disp.id}
                  onClick={() => onReincarnate(disp.id)}
                  disabled={!!actionLoading}
                  className="w-full py-2 px-4 bg-[hsl(var(--color-status-info))] hover:bg-[hsl(var(--color-status-info)/0.8)] disabled:opacity-50 text-03 font-medium transition-colors"
                >
                  {actionLoading === "reincarnate" ? t("souls.detail.processing") : `${t("souls.detail.reincarnate")} ${disp.realm_name || disp.realm_code || t("souls.detail.destination")}`}
                </button>
              ))}
            </RequirePermission>
          )}
          {soul?.current_state === "REINCARNATING" && (
            <div className="text-center text-[hsl(var(--color-status-info))] text-03 py-2">
              {t("souls.detail.being_reborn")}
            </div>
          )}
          {soul?.current_state === "ALIVE" && reincarnations.length > 0 && (
            <div className="text-center text-[hsl(var(--color-ink-subtle))] text-02 pt-2">
              {reincarnations.length} {t("souls.detail.previous_reincarnations")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
