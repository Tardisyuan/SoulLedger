"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { soulsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import type { SoulEvent } from "@soulledger/core/api/events";

export const LOST_REASON_MAX = 500;

/** 后端 400 `reason_required` → 同一句文案;其余 400 的 `{error}` 原样;别的形状交给通用文案。 */
function lostTransitionError(error: unknown): "reason_required" | string | null {
  const r = (error as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } })?.response;
  if (r?.status !== 400) return null;
  if (r.data?.code === "reason_required") return "reason_required";
  return typeof r.data?.error === "string" ? r.data.error : null;
}

/**
 * 第五十批 L-2 / L-4:标记失踪(DISPOSED → LOST)与召回(LOST → DISPOSED),`POST /souls/{id}/transition/`。
 * 原因必填、最多 500 字;确认按钮一直可点,空着点时框描红、焦点回框里(同更正结案)。超过 500 计数变红,不截断。
 * 标记用 ink 实底(可撤回、不删东西,不用危险色);召回用主色。
 */
export function LostTransitionDialog({
  mode,
  soulId,
  soulName,
  isOpen,
  onClose,
  onDone,
}: {
  mode: "mark" | "recall";
  soulId: string;
  soulName: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = `lost-reason-${mode}`;
  const over = reason.length > LOST_REASON_MAX;

  const fail = (message: string) => {
    setError(message);
    document.getElementById(fieldId)?.focus();
  };

  const move = useMutation({
    mutationFn: () =>
      soulsApi
        .transition(soulId, { new_state: mode === "mark" ? "LOST" : "DISPOSED", reason: reason.trim() })
        .then((r) => r.data),
    onSuccess: () => {
      showToast(t(mode === "mark" ? "souls.lost.marked_toast" : "souls.lost.recalled_toast"), "success");
      setReason("");
      onDone();
      onClose();
    },
    onError: (e) => {
      const message = lostTransitionError(e);
      if (message === "reason_required") fail(t("souls.lost.reason_required"));
      else if (message) setError(message);
      else showToast(t("common.error"), "error");
    },
  });

  const formId = `lost-transition-${mode}`;
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !move.isPending && onClose()}
      title={t(mode === "mark" ? "souls.lost.mark_title" : "souls.lost.recall_title", { name: soulName })}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={move.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={mode === "mark" ? "secondary" : "primary"}
            className={
              mode === "mark"
                ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))] border-transparent hover:bg-[oklch(var(--color-ink-muted))]"
                : undefined
            }
            loading={move.isPending}
          >
            {t(mode === "mark" ? "souls.lost.mark_confirm" : "souls.lost.recall_confirm")}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return fail(t("souls.lost.reason_required"));
          if (over) return fail(t("souls.lost.reason_hint"));
          setError(null);
          move.mutate();
        }}
      >
        <p className="text-sm text-[oklch(var(--color-ink))]">
          {t(mode === "mark" ? "souls.lost.mark_body" : "souls.lost.recall_body")}
        </p>
        <div>
          <TextAreaField
            id={fieldId}
            label={t("souls.lost.reason_label")}
            description={t("souls.lost.reason_hint")}
            required
            rows={3}
            error={error}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            disabled={move.isPending}
          />
          <p
            data-testid="lost-reason-count"
            className={`mt-1 text-right text-xs tabular-nums ${
              over ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink-subtle))]"
            }`}
          >
            {reason.length}/{LOST_REASON_MAX}
          </p>
        </div>
      </form>
    </BaseModal>
  );
}

/** 最近一条「→ 失踪」的状态变更;没有就 null(失踪早于事件记录,或事件还没加载)。 */
export function latestLostEvent(events: SoulEvent[]): SoulEvent | null {
  return (
    [...events]
      .filter((e) => e.event_type === "STATE_CHANGED" && (e.payload as { new_state?: unknown }).new_state === "LOST")
      .sort((a, b) => new Date(b.create_time).getTime() - new Date(a.create_time).getTime())[0] ?? null
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 「10-24 14:20」,本地时间。 */
export function lostSinceLabel(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 第五十批 L-3:失踪时身份带下面的浅底块 ——「◌ 10-24 14:20 起失踪 · 经办：崔判官」,下一行是原因(宋体)。
 * 数据取自最近一条「→ 失踪」的状态变更事件;召回后页面不再渲染它,记录只留在账页里。
 */
export function LostBanner({ event }: { event: SoulEvent | null }) {
  const { t } = useI18n();
  if (!event) return null;
  const reason = (event.payload as { reason?: unknown }).reason;
  return (
    <div data-testid="soul-lost-banner" className="mb-4 px-4 py-3 bg-[oklch(var(--color-surface-2))] text-sm">
      <div className="text-[oklch(var(--color-ink))]">
        <span aria-hidden="true">◌ </span>
        {t("souls.lost.since", { date: lostSinceLabel(event.create_time) })}
        {event.actor && (
          <>
            <span aria-hidden="true"> · </span>
            {t("souls.lost.by", { name: event.actor })}
          </>
        )}
      </div>
      {typeof reason === "string" && reason && (
        <p className="mt-1 font-serif text-[oklch(var(--color-ink-muted))]">{reason}</p>
      )}
    </div>
  );
}
