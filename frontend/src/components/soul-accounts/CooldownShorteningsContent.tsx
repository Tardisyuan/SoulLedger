"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PAGE_SIZE, type OfficerCooldownShortening } from "@soulledger/core/api";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import { useCooldownShortenings, useCooldownShorteningCounts } from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { CooldownShorteningDetail } from "./CooldownShorteningDetail";
import { COOLDOWN_FILTERS, cooldownEnded, cooldownTone, lifeNumber } from "./soulAccountsView";

// A11 列宽:灵魂 1.6fr、第几世 96、剩余冷却 220、状态 128、提交于 160、操作 112。
const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,1.6fr)_96px_220px_128px_160px_112px] md:items-center md:gap-4";

/** 「剩余冷却」格:N 天 + 已过 a / 共 b 天 + 2px 进度线;结束了只写 ○ 冷却已结束(整行不灰)。 */
function RemainingCell({ r }: { r: OfficerCooldownShortening }) {
  const { t } = useI18n();
  if (cooldownEnded(r)) {
    return <p className="text-sm text-[oklch(var(--color-ink-muted))]">○ {t("soul_accounts.cooldown.over")}</p>;
  }
  const pct = r.cooldown_total_days > 0 ? Math.min(100, (r.cooldown_past_days / r.cooldown_total_days) * 100) : 100;
  return (
    <div className="space-y-1">
      <p>
        <span className="font-mono text-md font-semibold">{t("soul_accounts.cooldown.remaining_days", { n: String(r.remaining_days) })}</span>{" "}
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("soul_accounts.cooldown.remaining_progress", { past: String(r.cooldown_past_days), total: String(r.cooldown_total_days) })}
        </span>
      </p>
      <div data-testid="shortening-progress" className="h-0.5 w-40 bg-[oklch(var(--color-line))]">
        <div className="h-full bg-[oklch(var(--color-ink))]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * 「缩短冷却申请」: the second tab of /rebirth-applications (A11). The table, the
 * detail and the decision follow the cross-civilization dialog's shape, with
 * `workflow.approve` gating the two buttons — the backend gates `approve/` and
 * `reject/` on the same codename (OfficerCooldownShorteningViewSet).
 */
export function CooldownShorteningsContent({ tabs }: { tabs: ReactNode }) {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("PENDING");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<OfficerCooldownShortening | null>(null);

  const list = useCooldownShortenings({ status: status || undefined, page });
  const counts = useCooldownShorteningCounts().data;
  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;

  const failed = list.isError && !list.data;
  const empty = failed ? (
    <QueryError onRetry={() => list.refetch()} />
  ) : status === "" ? (
    <EmptyState title={t("soul_accounts.cooldown.empty")} />
  ) : (
    <EmptyState
      title={t("soul_accounts.cooldown.empty_filtered")}
      action={
        <Button type="button" size="sm" variant="secondary" onClick={() => setStatus("")}>
          {t("soul_accounts.rebirth.filters.all")}
        </Button>
      }
    />
  );
  const total = counts ? counts.PENDING + counts.APPROVED + counts.REJECTED : undefined;
  const chipCount = (value: string) => (value ? counts?.[value as keyof typeof counts] : total);

  return (
    <PageShell
      variant="full"
      title={t("soul_accounts.cooldown.title")}
      subtitle={t("soul_accounts.cooldown.subtitle")}
      tabs={tabs}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void queryClient.invalidateQueries({ queryKey: soulAccountKeys.all })}
          aria-busy={list.isFetching}
        >
          <RefreshCw aria-hidden="true" className={`w-4 h-4 mr-1 inline ${list.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
          {t("soul_accounts.refresh")}
        </Button>
      }
      filters={
        <>
          <div role="group" aria-label={t("soul_accounts.rebirth.filters.label")} className="flex shrink-0 gap-2 [&>*]:shrink-0">
            {COOLDOWN_FILTERS.map((value) => (
              <FilterChipToggle
                key={value || "all"}
                pressed={status === value}
                onPressedChange={() => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                {value ? t(`soul_accounts.cooldown_status.${value}`) : t("soul_accounts.rebirth.filters.all")}
                {chipCount(value) !== undefined && <span className="font-mono">{chipCount(value)}</span>}
              </FilterChipToggle>
            ))}
          </div>
          <p className="ml-auto shrink-0 pl-4 text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">{t("soul_accounts.cooldown.sort_note")}</p>
        </>
      }
      isLoading={list.isLoading}
      skeleton={<ListSkeleton count={4} />}
      isEmpty={failed || rows.length === 0}
      empty={empty}
      pagination={
        count > PAGE_SIZE
          ? { controls: <Pagination page={page} totalPages={Math.ceil(count / PAGE_SIZE)} count={count} onPageChange={setPage} /> }
          : undefined
      }
    >
      <div className="rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]">
        <div
          aria-hidden="true"
          className={`hidden px-4 md:h-10 text-xs text-[oklch(var(--color-ink-muted))] border-b border-[oklch(var(--color-block))] ${ROW_GRID}`}
        >
          <span>{t("soul_accounts.fields.soul")}</span>
          <span>{t("soul_accounts.fields.cycle")}</span>
          <span>{t("soul_accounts.cooldown.fields.remaining")}</span>
          <span>{t("soul_accounts.fields.status")}</span>
          <span>{t("soul_accounts.cooldown.fields.created_at")}</span>
          <span />
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.id}
              data-shortening-id={r.id}
              className="relative border-b border-[oklch(var(--color-rule))] last:border-b-0"
            >
              {/* ≥ md: a table row. */}
              <div className={`hidden px-4 py-3 md:min-h-16 ${ROW_GRID}`}>
                <div className="min-w-0 space-y-1">
                  <Link href={`/souls/${r.soul}`} className="text-md font-medium text-[oklch(var(--color-ink))] hover:underline break-words">
                    {r.soul_name}
                  </Link>
                  <p className="font-mono text-xs text-[oklch(var(--color-ink-muted))] break-all">{r.soul_code}</p>
                </div>
                <p className="text-sm">{t("soul_accounts.life", { n: lifeNumber(r.cycle) })}</p>
                <div data-testid="shortening-remaining">
                  <RemainingCell r={r} />
                </div>
                <div>
                  <StatusBadge namespace="soul_accounts.cooldown_status" value={r.status} tone={cooldownTone(r.status)} />
                </div>
                <p className="font-mono text-xs">{formatDateTime(r.created_at)}</p>
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(r)}>
                    {t("soul_accounts.rebirth.view")}
                  </Button>
                </div>
              </div>
              {/* 393: one tappable row, min 88 — name · code · life / 剩 N 天 · 已过 a / 共 b 天 / filed; badge + › on the right. */}
              <button
                type="button"
                data-testid="shortening-row-compact"
                onClick={() => setSelected(r)}
                className="flex w-full min-h-22 items-center gap-3 px-4 py-3 text-left md:hidden"
              >
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block text-md font-medium break-words">
                    {r.soul_name} <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{r.soul_code}</span>{" "}
                    <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("soul_accounts.life", { n: lifeNumber(r.cycle) })}</span>
                  </span>
                  <span className="block text-xs text-[oklch(var(--color-ink-muted))]">
                    {cooldownEnded(r)
                      ? `○ ${t("soul_accounts.cooldown.over")}`
                      : `${t("soul_accounts.cooldown.remaining_days", { n: String(r.remaining_days) })} · ${t("soul_accounts.cooldown.remaining_progress", {
                          past: String(r.cooldown_past_days),
                          total: String(r.cooldown_total_days),
                        })}`}
                  </span>
                  <span className="block font-mono text-xs text-[oklch(var(--color-ink-muted))]">{formatDateTime(r.created_at)}</span>
                </span>
                <StatusBadge namespace="soul_accounts.cooldown_status" value={r.status} tone={cooldownTone(r.status)} />
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && <CooldownShorteningDetail key={selected.id} row={selected} onClose={() => setSelected(null)} />}
    </PageShell>
  );
}
