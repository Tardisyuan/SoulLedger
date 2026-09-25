"use client";

import { useState } from "react";
import type { SocialMute } from "@soulledger/core/api/social-moderation";
import { useLiftMute, useSocialMutes } from "@soulledger/core/hooks/useSocialModeration";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { DataTable } from "@/components/ui/data-table";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { cn } from "@/lib/utils";
import { useFailureToast } from "./shared";

/** Below this share of the term left, the bar turns warning (A 组期限条). */
const WARN_BELOW = 0.1;

/**
 * Share of the mute still to run, 0–1. `created_at` is the start and `until`
 * the end — the schema's own words, and `until` is never null: there is no
 * permanent mute (1–365 days, a product decision), so there is no dashed
 * "forever" state to draw either.
 */
export function remainingShare(mute: Pick<SocialMute, "created_at" | "until">, now: number): number {
  const start = Date.parse(mute.created_at);
  const end = Date.parse(mute.until);
  if (!(end > start)) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/**
 * 期限条 TermBar:剩余时间占全程的比例,墨色实心;剩余不到 10% 变警示色。
 * A `meter`, so the fraction is announced, not only drawn.
 */
export function TermBar({ share, label }: { share: number; label: string }) {
  const pct = Math.round(share * 100);
  const warn = share > 0 && share < WARN_BELOW;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
      data-warn={warn || undefined}
      className="relative block h-1.5 w-full min-w-16 bg-[oklch(var(--color-surface-3))]"
    >
      <span
        aria-hidden="true"
        style={{ width: `${pct}%` }}
        className={cn(
          "absolute inset-y-0 left-0 block",
          warn ? "bg-[oklch(var(--color-warning))]" : "bg-[oklch(var(--color-ink))]"
        )}
      />
    </span>
  );
}

/**
 * 禁言(E-08c)。「解除禁言」是这一区唯一的工作,所以按规则 15 的例外保留行尾按钮;
 * 点了先确认 —— 写明灵魂端会收到通知、这一步不能撤销但可以重新禁言。
 */
export function MutesSection() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const [page, setPage] = useState(1);
  const list = useSocialMutes(page);
  const lift = useLiftMute();
  const [lifting, setLifting] = useState<SocialMute | null>(null);
  // One clock for the table, so every bar is measured against the same instant.
  // Read once per mount (a render must stay pure); the list refetches on every
  // write, and a bar that is a few minutes stale does not change a decision.
  const [now] = useState(() => Date.now());

  return (
    <>
      <DataTable<SocialMute>
        caption={t("social_moderation.tabs.mutes")}
        density="compact"
        columns={[
          { key: "soul", header: t("social_moderation.mutes.col_soul") },
          { key: "reason", header: t("social_moderation.fields.reason") },
          { key: "term", header: t("social_moderation.mutes.col_term"), width: "140px" },
          { key: "range", header: t("social_moderation.mutes.col_range") },
          { key: "by", header: t("social_moderation.mutes.col_by") },
          { key: "action", header: t("social_moderation.actions.lift"), srOnlyHeader: true, align: "right" },
        ]}
        data={list.data?.results}
        isLoading={list.isLoading}
        isError={list.isError && !list.data}
        onRetry={() => list.refetch()}
        emptyMessage={t("social_moderation.empty.mutes")}
        keyExtractor={(m) => m.id}
        renderRow={(m) => {
          const share = m.is_active ? remainingShare(m, now) : 0;
          return (
            <>
              <td className="px-3 py-2 font-medium text-[oklch(var(--color-ink))]" data-mute-id={m.id}>
                {m.user?.display_name}
              </td>
              <td className="px-3 py-2 text-sm">{m.reason || <MissingValue kind="unrecorded" />}</td>
              <td className="px-3 py-2">
                <TermBar share={share} label={t("social_moderation.mutes.term_label", { name: m.user?.display_name ?? "" })} />
              </td>
              <td
                className={cn(
                  "px-3 py-2 whitespace-nowrap font-mono text-xs",
                  share > 0 && share < WARN_BELOW ? "text-[oklch(var(--color-warning))]" : "text-[oklch(var(--color-ink-muted))]"
                )}
              >
                {formatDateTime(m.created_at)} → {formatDateTime(m.until)}
              </td>
              <td className="px-3 py-2 text-xs text-[oklch(var(--color-ink-muted))]">{m.created_by?.display_name ?? <MissingValue kind="unrecorded" />}</td>
              <td className="px-3 py-2 text-right">
                {m.is_active ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setLifting(m)}>
                    {t("social_moderation.actions.lift")}
                  </Button>
                ) : (
                  <Badge tone="neutral" glyph="○">
                    {t(m.lifted_at ? "social_moderation.mute_lifted" : "social_moderation.mute_expired")}
                  </Badge>
                )}
              </td>
            </>
          );
        }}
        page={page}
        totalPages={list.data ? Math.ceil(list.data.count / PAGE_SIZE) : 0}
        totalCount={list.data?.count}
        onPageChange={setPage}
      />
      <ConfirmDialog
        isOpen={lifting !== null}
        variant="warning"
        title={t("social_moderation.mutes.confirm_title", { name: lifting?.user?.display_name ?? "" })}
        message={t("social_moderation.mutes.confirm_body")}
        confirmText={t("social_moderation.actions.lift")}
        confirmLoading={lift.isPending}
        onConfirm={() =>
          lifting &&
          lift.mutate(lifting.id, {
            onSuccess: () => showToast(t("social_moderation.done"), "success"),
            onError: fail,
            onSettled: () => setLifting(null),
          })
        }
        onCancel={() => setLifting(null)}
      />
    </>
  );
}
