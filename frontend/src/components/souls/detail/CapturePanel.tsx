"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  captureWarrantsApi,
  type CaptureEscort,
  type CaptureWarrant,
  type Soul,
} from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";

const CAPTURE_CODES = ["not_diyu", "not_alive", "lifespan_not_ended", "warrant_open", "wrong_status", "reason_required"];

/** 阳寿(完整的公元日期)已到:≤ 今天(本地日期)。与后端 `capture.lifespan_ended_q` 同一条。 */
function lifespanEnded(soul: Soul): boolean {
  const f = soul.fated_death_date;
  if (!f || !f.month || !f.day || f.year < 1) return false;
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const fated = [f.year, f.month, f.day];
  for (let i = 0; i < 3; i++) if (fated[i] !== today[i]) return fated[i] < today[i];
  return true;
}

/**
 * 勾魂(2026-10-28,只地府;docs/01 §二 第五层、02 黑白无常 / 牛头马面):这个灵魂的勾魂牒,和发牒 / 拘到 / 交接 / 撤销。
 * 没有牒、也还不到发牒的时候(在世而阳寿未到)就什么都不画。`canAct` = 持 `soul.die`(交接就是登记死亡)。
 * ponytail: 临时样式 —— 一张简单的卡片,等 Design 出勾魂的卡片与牒的状态样式(见交接报告)。
 */
export function CapturePanel({ soul, canAct }: { soul: Soul; canAct: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const escortId = useId();
  const [escort, setEscort] = useState<CaptureEscort | "">("");
  const warrants = useQuery({
    queryKey: soulKeys.capture(soul.id),
    queryFn: async () => (await captureWarrantsApi.list({ soul: soul.id })).data.results,
  });
  const onError = (err: unknown) => {
    const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
    showToast(code && CAPTURE_CODES.includes(code) ? t(`souls.capture.error.${code}`) : t("common.error"), "error");
  };
  const done = (key: string) => () => {
    void queryClient.invalidateQueries({ queryKey: soulKeys.all });
    void queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
    showToast(t(key, { name: soul.name }), "success");
  };
  const issue = useMutation({
    mutationFn: () => captureWarrantsApi.issue({ soul: soul.id, ...(escort ? { escort } : {}) }),
    onSuccess: done("souls.capture.issued_toast"),
    onError,
  });
  const rows = warrants.data ?? [];
  const open = rows.some((w) => w.status === "ISSUED" || w.status === "CAPTURED");
  const mayIssue = canAct && soul.current_state === "ALIVE" && lifespanEnded(soul) && !open;
  if (!rows.length && !mayIssue) return null;

  return (
    <section data-testid="soul-capture" className="min-w-0 bg-[oklch(var(--color-surface-1))] p-6">
      <h2 className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
        {t("souls.capture.title")}
      </h2>
      {mayIssue && (
        <div className="mt-3 space-y-2" data-testid="soul-capture-issue">
          <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.capture.due_hint")}</p>
          <SelectField
            id={escortId}
            label={t("souls.capture.escort_label")}
            size="sm"
            value={escort}
            onChange={(e) => setEscort(e.target.value as CaptureEscort | "")}
            disabled={issue.isPending}
            options={(["", "WUCHANG", "NIUTOU_MAMIAN"] as const).map((v) => ({
              value: v,
              label: t(`souls.capture.escort.${v || "SUGGESTED"}`),
            }))}
          />
          <Button size="sm" variant="primary" disabled={issue.isPending} onClick={() => issue.mutate()}>
            {t("souls.capture.issue")}
          </Button>
        </div>
      )}
      <ul className="mt-3 space-y-3">
        {rows.map((w) => (
          <WarrantRow key={w.id} warrant={w} canAct={canAct} onDone={done} onError={onError} />
        ))}
      </ul>
    </section>
  );
}

function WarrantRow({
  warrant,
  canAct,
  onDone,
  onError,
}: {
  warrant: CaptureWarrant;
  canAct: boolean;
  onDone: (key: string) => () => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const reasonId = useId();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const capture = useMutation({
    mutationFn: () => captureWarrantsApi.capture(warrant.id),
    onSuccess: onDone("souls.capture.captured_toast"),
    onError,
  });
  const handOver = useMutation({
    mutationFn: () => captureWarrantsApi.handOver(warrant.id),
    onSuccess: onDone("souls.capture.handed_over_toast"),
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => captureWarrantsApi.cancel(warrant.id, reason.trim()),
    onSuccess: onDone("souls.capture.cancelled_toast"),
    onError,
  });
  const busy = capture.isPending || handOver.isPending || cancel.isPending;
  const live = warrant.status === "ISSUED" || warrant.status === "CAPTURED";
  return (
    <li className="border-t border-[oklch(var(--color-line))] pt-3 text-sm" data-testid="capture-warrant">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <DomainEnum namespace="souls.capture.status" value={warrant.status} className="font-medium" />
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">
          <DomainEnum namespace="souls.capture.escort" value={warrant.escort} />
          {warrant.city_god_name ? ` · ${t("souls.capture.city_god", { name: warrant.city_god_name })}` : ""}
        </span>
      </div>
      {canAct && live && !cancelling && (
        <div className="mt-2 flex flex-wrap gap-2">
          {warrant.status === "ISSUED" ? (
            <Button size="sm" disabled={busy} onClick={() => capture.mutate()}>
              {t("souls.capture.capture")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => handOver.mutate()}>
              {t("souls.capture.hand_over")}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling(true)}>
            {t("souls.capture.cancel")}
          </Button>
        </div>
      )}
      {cancelling && (
        <div className="mt-2 space-y-2">
          <TextField
            id={reasonId}
            label={t("souls.capture.cancel_reason")}
            size="sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => cancel.mutate()}>
              {t("souls.capture.cancel_confirm")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
