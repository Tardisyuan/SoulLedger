"use client";

import { useState } from "react";
import type { Judgment } from "@soulledger/core/api/judgment";
import { useReassignJudgment, useReleaseJudgment } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { ReassignDialog, ReleaseForDialog, claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";

/**
 * 「请管理员改派」在审判页头(2026-11-16,官员端 App `screens/detail.tsx` 的 O-a 在网页上的那一半):
 * 判官请求改派后,能改派的人(`judgment.assign`)打开案子就看到谁、何时请求、理由,页头的主动作是「改派给…」。
 * 条件与 App 同一条:案子未结、有请求、经办人不是我。请求在认领人变动时由服务端清掉,所以改派一成,这一行自己消失。
 */
export function reassignRequestShown(
  j: Pick<Judgment, "reassign_requested_at" | "claimed_by" | "is_final" | "concluded_at">,
  me: number | null | undefined,
  canAssign: boolean,
): boolean {
  return canAssign && !!j.reassign_requested_at && !j.is_final && !j.concluded_at && j.claimed_by !== me;
}

/** 「替{name}放回」:持 `judgment.assign`、案子未结、在别人手上(App `rules.ts::judgmentAdminItems` 同一条)。 */
export function releaseForShown(
  j: Pick<Judgment, "claimed_by" | "is_final" | "concluded_at">,
  me: number | null | undefined,
  canAssign: boolean,
): boolean {
  return canAssign && j.claimed_by != null && j.claimed_by !== me && !j.is_final && !j.concluded_at;
}

/** 页头副标题里的一行:「◐ {name}请求改派 · {time}」,再一行理由(有才写)。 */
export function ReassignRequestLine({ judgment }: { judgment: Judgment }) {
  const { t, formatDateTime } = useI18n();
  return (
    <span data-testid="desk-reassign-request" className="basis-full text-[oklch(var(--color-ink))]">
      <span aria-hidden="true">◐ </span>
      {t("officer_app.case.reassign_request", {
        name: judgment.reassign_requested_by_name ?? judgment.claimed_by_name ?? "",
        time: formatDateTime(judgment.reassign_requested_at ?? ""),
      })}
      {judgment.reassign_reason && (
        <span className="block pl-4 text-[oklch(var(--color-ink-muted))]">
          {t("officer_app.dispatch_status.reason", { reason: judgment.reassign_reason })}
        </span>
      )}
    </span>
  );
}

/** 页头的「改派给…」:打开队列页同一个改派层(`ReassignDialog`),只这一件。 */
export function ReassignToButton({ judgmentId }: { judgmentId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const reassign = useReassignJudgment();
  return (
    <>
      <Button type="button" variant="primary" size="sm" data-testid="desk-reassign-to" onClick={() => setOpen(true)}>
        {t("officer_app.case.reassign_to")}
      </Button>
      <ReassignDialog
        isOpen={open}
        ids={[judgmentId]}
        count={1}
        pending={reassign.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={(to) =>
          reassign.mutate(
            { id: judgmentId, to },
            {
              onSuccess: () => {
                setOpen(false);
                showToast(t("judgment.claim.done_reassign", { n: "1" }), "success");
              },
              onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
            }
          )
        }
      />
    </>
  );
}

/** 页头的「替{name}放回」:理由必填(`ReleaseForDialog`),放回后案子回到待认领。 */
export function ReleaseForButton({ judgmentId, holder }: { judgmentId: string; holder: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const release = useReleaseJudgment();
  return (
    <>
      <Button type="button" variant="secondary" size="sm" data-testid="desk-release-for" onClick={() => setOpen(true)}>
        {t("officer_app.case.release_for", { name: holder })}
      </Button>
      <ReleaseForDialog
        isOpen={open}
        holder={holder}
        pending={release.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={(reason) =>
          release.mutate(
            { id: judgmentId, reason },
            {
              onSuccess: () => {
                setOpen(false);
                showToast(t("officer_app.case.done_released"), "success");
              },
              onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
            }
          )
        }
      />
    </>
  );
}
