"use client";

import { useState } from "react";
import { useAssistAdminHalls, useUpdateAssistHall } from "@soulledger/core/hooks/useAssistAdmin";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { QueryError } from "@/src/components/ui/PageError";
import { ListSkeleton } from "@/components/ui/skeleton";
import { MONO, SUBTLE, Switch, count } from "./parts";

type RowState = { kind: "saved" } | { kind: "failed"; on: boolean } | undefined;

/**
 * One switch per hall, written the moment it is pressed — not part of the
 * config draft (canvas 1a 三). Greyed (value kept) while the master switch is off.
 */
export function HallSwitches({ inactiveReason }: { inactiveReason: string | null }) {
  const { t } = useI18n();
  const halls = useAssistAdminHalls();
  const update = useUpdateAssistHall();
  const [state, setState] = useState<Record<number, RowState>>({});

  const write = (id: number, on: boolean) =>
    update.mutate(
      { id, on },
      {
        onSuccess: () => setState((s) => ({ ...s, [id]: { kind: "saved" } })),
        onError: () => setState((s) => ({ ...s, [id]: { kind: "failed", on } })),
      }
    );

  if (halls.isLoading) return <ListSkeleton count={2} />;
  if (halls.isError || !halls.data) return <QueryError onRetry={() => halls.refetch()} />;

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className={`text-left ${SUBTLE}`}>
            <th className="py-1 font-normal">{t("assist_admin.halls.hall")}</th>
            <th className="py-1 font-normal text-right">{t("assist_admin.halls.souls_homed")}</th>
            <th className="py-1 font-normal text-right">{t("assist_admin.halls.switch")}</th>
          </tr>
        </thead>
        <tbody>
          {halls.data.map((hall) => {
            const row = state[hall.id];
            const pending = update.isPending && update.variables?.id === hall.id;
            const reasonId = inactiveReason ? `hall-inactive-${hall.id}` : undefined;
            return (
              <tr key={hall.id} className="border-t border-[oklch(var(--color-hairline))]">
                <td className="py-2">
                  {hall.display_name} <span className={`${MONO} ${SUBTLE}`}>{hall.code}</span>
                  {reasonId && (
                    <span id={reasonId} className={`block ${SUBTLE}`}>
                      {inactiveReason}
                    </span>
                  )}
                </td>
                <td className={`py-2 text-right ${MONO}`}>{count(hall.souls_homed)}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-2">
                    {pending && <span className={SUBTLE}>{t("assist_admin.halls.saving")}</span>}
                    {!pending && row?.kind === "saved" && <span className={SUBTLE}>{t("assist_admin.halls.saved")}</span>}
                    {!pending && row?.kind === "failed" && (
                      <span role="alert" className="text-xs text-[oklch(var(--color-danger))]">
                        {t("assist_admin.halls.failed")}{" "}
                        <Button type="button" size="sm" variant="ghost" onClick={() => write(hall.id, row.on)}>
                          {t("assist_admin.retry")}
                        </Button>
                      </span>
                    )}
                    <Switch
                      checked={hall.assistant_enabled}
                      label={t("assist_admin.halls.switch_label", { hall: hall.display_name })}
                      disabled={Boolean(inactiveReason) || pending}
                      describedBy={reasonId}
                      onChange={(on) => write(hall.id, on)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={`mt-2 ${SUBTLE}`}>{t("assist_admin.halls.note")}</p>
    </div>
  );
}
