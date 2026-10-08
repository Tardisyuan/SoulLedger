"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PAGE_SIZE, type OfficerCooldownShortening } from "@soulledger/core/api";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import {
  classifySoulAccountError,
  useApproveCooldownShortening,
  useCooldownShortenings,
  useRejectCooldownShortening,
} from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Pagination } from "@/src/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { BaseModal } from "@/src/components/ui/Modal";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { TextAreaField, TextField } from "@/src/components/ui/Field";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";
import { failureKey, lifeNumber } from "./soulAccountsView";

/** Status → tone; the same table shape as `rebirthTone`, for the three decision states. */
const COOLDOWN_TONE: Record<string, BadgeTone> = { PENDING: "warning", APPROVED: "success", REJECTED: "error" };
export const cooldownTone = (status: string): BadgeTone => COOLDOWN_TONE[status] ?? "neutral";
export const COOLDOWN_FILTERS = ["", "PENDING", "APPROVED", "REJECTED"] as const;

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_5rem] md:items-center md:gap-4";

/**
 * 「缩短冷却申请」: the second tab of /rebirth-applications. Same table and the
 * same decision shape as the cross-civilization dialog, with `workflow.approve`
 * gating the two buttons — the backend gates `approve/` and `reject/` on the
 * same codename (OfficerCooldownShorteningViewSet).
 */
export function CooldownShorteningsContent({ tabs }: { tabs: ReactNode }) {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<OfficerCooldownShortening | null>(null);

  const list = useCooldownShortenings({ status: status || undefined, page });
  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const shown = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null;

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
  const label = "md:hidden text-2xs text-[oklch(var(--color-ink-muted))]";

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
            </FilterChipToggle>
          ))}
        </div>
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
      <div>
        <div
          aria-hidden="true"
          className={`hidden px-3 md:min-h-11 text-2xs text-[oklch(var(--color-ink-muted))] border-b border-[oklch(var(--color-block))] ${ROW_GRID}`}
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
              className={`px-3 py-3 md:py-2 md:min-h-(--table-row-h) space-y-3 md:space-y-0 border-b border-[oklch(var(--color-rule))] ${ROW_GRID}`}
            >
              <div className="min-w-0 space-y-1">
                <Link href={`/souls/${r.soul}`} className="text-sm font-medium text-[oklch(var(--color-ink))] hover:underline break-words">
                  {r.soul_name}
                </Link>
                <p className="font-mono text-xs text-[oklch(var(--color-ink-tertiary))] break-all">{r.soul_code}</p>
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.fields.cycle")}</p>
                <p className="text-sm">{t("soul_accounts.life", { n: lifeNumber(r.cycle) })}</p>
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.cooldown.fields.remaining")}</p>
                <p className="text-sm" data-testid="shortening-remaining">
                  {r.cooldown_until ? t("soul_accounts.cooldown.remaining_days", { n: String(r.remaining_days) }) : t("soul_accounts.cooldown.over")}
                </p>
              </div>
              <div className="min-w-0 space-y-1">
                <p className={label}>{t("soul_accounts.fields.status")}</p>
                <StatusBadge namespace="soul_accounts.cooldown_status" value={r.status} tone={cooldownTone(r.status)} />
              </div>
              <div className="min-w-0">
                <p className={label}>{t("soul_accounts.cooldown.fields.created_at")}</p>
                <p className="font-mono text-xs">{formatDateTime(r.created_at)}</p>
              </div>
              <div className="flex md:justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(r)}>
                  {t("soul_accounts.rebirth.view")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {shown && <CooldownShorteningDetail key={shown.id} row={shown} onClose={() => setSelected(null)} />}
    </PageShell>
  );
}

function CooldownShorteningDetail({ row: r, onClose }: { row: OfficerCooldownShortening; onClose: () => void }) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const approve = useApproveCooldownShortening();
  const reject = useRejectCooldownShortening();
  const [days, setDays] = useState("0");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const pending = r.status === "PENDING" && r.cooldown_until !== null;
  const canDecide = pending && hasPermission("workflow.approve");
  const busy = approve.isPending || reject.isPending;
  const onError = (error: unknown) =>
    showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.cooldown.failed")), "error");
  const onSuccess = () => showToast(t("soul_accounts.cooldown.decided"), "success");

  const doApprove = () => {
    const n = Number(days);
    // The backend's rule, applied before the round trip: 0 ≤ days < remaining_days.
    if (!Number.isInteger(n) || n < 0 || n >= r.remaining_days) return setFieldError(t("soul_accounts.cooldown.invalid_days"));
    setFieldError(null);
    approve.mutate({ id: r.id, days: n, note }, { onSuccess, onError });
  };
  const doReject = () => {
    if (!note.trim()) return setFieldError(t("soul_accounts.cooldown.note_required"));
    setFieldError(null);
    reject.mutate({ id: r.id, note }, { onSuccess, onError });
  };

  const field = (label: string, value: ReactNode) => (
    <>
      <dt className="text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="min-w-0 break-words text-[oklch(var(--color-ink))]">{value}</dd>
    </>
  );

  return (
    <BaseModal isOpen onClose={onClose} title={t("soul_accounts.cooldown.detail_title", { name: r.soul_name })}>
      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {field(t("soul_accounts.fields.soul_code"), <span className="font-mono">{r.soul_code}</span>)}
          {field(t("soul_accounts.fields.cycle"), t("soul_accounts.life", { n: lifeNumber(r.cycle) }))}
          {field(t("soul_accounts.fields.status"), <DomainEnum namespace="soul_accounts.cooldown_status" value={r.status} className={badgeVariants({ tone: cooldownTone(r.status) })} />)}
          {field(
            t("soul_accounts.cooldown.fields.cooldown_until"),
            r.cooldown_until ? <span className="font-mono">{formatDateTime(r.cooldown_until)}</span> : <MissingValue kind="inapplicable" reason={t("soul_accounts.cooldown.over")} />
          )}
          {field(t("soul_accounts.cooldown.fields.remaining"), t("soul_accounts.cooldown.remaining_days", { n: String(r.remaining_days) }))}
          {r.status === "APPROVED" && field(t("soul_accounts.cooldown.fields.approved_days"), t("soul_accounts.cooldown.remaining_days", { n: String(r.approved_days ?? 0) }))}
          {r.decided_at &&
            field(
              t("soul_accounts.cooldown.fields.decided_by"),
              <span>
                {r.decided_by_username ?? <MissingValue kind="unrecorded" />} · <span className="font-mono">{formatDateTime(r.decided_at)}</span>
              </span>
            )}
          {field(t("soul_accounts.cooldown.fields.created_at"), <span className="font-mono">{formatDateTime(r.created_at)}</span>)}
        </dl>

        <section>
          <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.cooldown.fields.reason")}</h3>
          <p className="text-sm whitespace-pre-wrap break-words">{r.reason}</p>
        </section>
        {r.decision_note && (
          <section>
            <h3 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] mb-1">{t("soul_accounts.cooldown.fields.note")}</h3>
            <p className="text-sm whitespace-pre-wrap break-words">{r.decision_note}</p>
          </section>
        )}

        {canDecide && (
            <section className="border-t border-[oklch(var(--color-hairline))] pt-3 space-y-3" data-testid="cooldown-decision">
              <TextField
                label={t("soul_accounts.cooldown.days_label")}
                description={t("soul_accounts.cooldown.days_hint", { n: String(r.remaining_days) })}
                type="number"
                inputMode="numeric"
                min={0}
                max={r.remaining_days - 1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                data-testid="shortening-days"
              />
              <TextAreaField
                label={t("soul_accounts.cooldown.note_label")}
                description={t("soul_accounts.cooldown.note_hint")}
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                data-testid="shortening-note"
                error={fieldError}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="primary" loading={approve.isPending} disabled={busy} onClick={doApprove} data-testid="shortening-approve">
                  {t("soul_accounts.cooldown.approve")}
                </Button>
                <Button type="button" size="sm" variant="secondary" loading={reject.isPending} disabled={busy} onClick={doReject} data-testid="shortening-reject">
                  {t("soul_accounts.cooldown.reject")}
                </Button>
              </div>
            </section>
        )}
      </div>
    </BaseModal>
  );
}
