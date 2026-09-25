"use client";

import { useState } from "react";
import type { MuteFilters, SocialMute } from "@soulledger/core/api/social-moderation";
import {
  useLiftMute,
  useMuteExecutors,
  useMuteSoul,
  useMuteSouls,
  useSocialMutes,
} from "@soulledger/core/hooks/useSocialModeration";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { ConfirmDialog, Modal } from "@/src/components/ui/Modal";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { fieldControl } from "@/src/components/ui/Field";
import { DataTable } from "@/components/ui/data-table";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { cn } from "@/lib/utils";
import { MUTE_DAYS, useFailureToast } from "./shared";

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

const STATUSES = ["ACTIVE", "EXPIRED", "LIFTED"] as const;
const TERMS = ["SHORT", "MEDIUM", "LONG"] as const;

/**
 * 「禁言…」(E-08c 页头):在本文明此刻的灵魂里按名字找一个,选天数(1–365,没有永久),写理由。
 * 选人框只列本世账号;服务端 `mutes/souls/` 与 `create` 按同一个文明收窄。
 */
function MuteDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const souls = useMuteSouls(q.trim(), isOpen);
  const mute = useMuteSoul();
  const close = () => {
    setQ("");
    setPicked(null);
    setReason("");
    onClose();
  };
  const submit = () =>
    picked !== null &&
    mute.mutate(
      { userId: picked, days, reason: reason.trim() },
      {
        onSuccess: () => {
          showToast(t("social_moderation.done"), "success");
          close();
        },
        onError: fail,
      }
    );
  const rows = souls.data ?? [];
  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t("social_moderation.mutes.new_title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={mute.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="warning" onClick={submit} loading={mute.isPending} disabled={picked === null}>
            {t("social_moderation.actions.mute")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("social_moderation.mutes.search")}
          placeholder={t("social_moderation.mutes.search")}
          className={cn(fieldControl({ size: "md" }), "w-full")}
        />
        <fieldset>
          <legend className="text-xs text-[oklch(var(--color-ink-muted))]">{t("social_moderation.mutes.pick_label")}</legend>
          {rows.length === 0 && !souls.isLoading ? (
            <p className="mt-1 text-sm text-[oklch(var(--color-ink-subtle))]">{t("social_moderation.mutes.no_match")}</p>
          ) : (
            <ul className="mt-1 max-h-48 overflow-y-auto border border-[oklch(var(--color-rule))]">
              {rows.map((s) => (
                <li key={s.user_id} className="border-b border-[oklch(var(--color-rule))] last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-[oklch(var(--color-surface-2))]">
                    <input
                      type="radio"
                      name="mute-soul"
                      value={s.user_id}
                      checked={picked === s.user_id}
                      onChange={() => setPicked(s.user_id)}
                    />
                    {s.display_name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <label className="block text-xs text-[oklch(var(--color-ink-muted))]">
          {t("social_moderation.mute_days")}
          <select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-describedby="mute-days-hint"
            className={cn(fieldControl({ size: "md" }), "mt-1 w-full")}
          >
            {MUTE_DAYS.map((n) => (
              <option key={n} value={n}>
                {t("social_moderation.mute_days_option", { n: String(n) })}
              </option>
            ))}
          </select>
        </label>
        <p id="mute-days-hint" className="text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("social_moderation.mutes.term_hint")}
        </p>
        <label className="block text-xs text-[oklch(var(--color-ink-muted))]">
          {t("social_moderation.fields.reason")}
          <textarea
            rows={2}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className={cn(fieldControl({ size: "md" }), "mt-1 h-auto w-full py-2")}
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * 禁言(E-08c)。「解除禁言」是这一区唯一的工作,所以按规则 15 的例外保留行尾按钮;
 * 点了先确认 —— 写明灵魂端会收到通知、这一步不能撤销但可以重新禁言。
 * 页头:搜索灵魂姓名、状态 / 时长 / 执行人三个过滤、「禁言…」。
 */
export function MutesSection() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<NonNullable<MuteFilters["status"]> | "">("");
  const [term, setTerm] = useState<NonNullable<MuteFilters["term"]> | "">("");
  const [executor, setExecutor] = useState("");
  const [muting, setMuting] = useState(false);
  const filters: MuteFilters = {
    ...(page > 1 ? { page } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(status ? { status } : {}),
    ...(term ? { term } : {}),
    ...(executor ? { created_by: Number(executor) } : {}),
  };
  const filtered = Boolean(q.trim() || status || term || executor);
  const list = useSocialMutes(filters);
  const executors = useMuteExecutors();
  const lift = useLiftMute();
  const [lifting, setLifting] = useState<SocialMute | null>(null);
  // One clock for the table, so every bar is measured against the same instant.
  // Read once per mount (a render must stay pure); the list refetches on every
  // write, and a bar that is a few minutes stale does not change a decision.
  const [now] = useState(() => Date.now());

  const all = t("filter.all");
  const refilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => refilter(setQ)(e.target.value)}
          aria-label={t("social_moderation.mutes.search")}
          placeholder={t("social_moderation.mutes.search")}
          className={cn(fieldControl({ size: "sm" }), "w-48")}
        />
        <FilterChipSelect
          label={t("social_moderation.mutes.filter_status")}
          value={status}
          options={[{ value: "", label: all }, ...STATUSES.map((s) => ({ value: s, label: t(`social_moderation.mutes.status.${s}`) }))]}
          clearLabel={t("filter.clear_one", { name: t("social_moderation.mutes.filter_status") })}
          onChange={refilter((v) => setStatus(v as typeof status))}
        />
        <FilterChipSelect
          label={t("social_moderation.mutes.col_term")}
          value={term}
          options={[{ value: "", label: all }, ...TERMS.map((s) => ({ value: s, label: t(`social_moderation.mutes.term.${s}`) }))]}
          clearLabel={t("filter.clear_one", { name: t("social_moderation.mutes.col_term") })}
          onChange={refilter((v) => setTerm(v as typeof term))}
        />
        <FilterChipSelect
          label={t("social_moderation.mutes.col_by")}
          value={executor}
          options={[
            { value: "", label: all },
            ...(executors.data ?? []).map((p) => ({ value: String(p.user_id), label: p.display_name })),
          ]}
          clearLabel={t("filter.clear_one", { name: t("social_moderation.mutes.col_by") })}
          onChange={refilter(setExecutor)}
        />
        <span className="flex-1" />
        <Button type="button" variant="secondary" size="sm" onClick={() => setMuting(true)}>
          {t("social_moderation.mutes.new")}
        </Button>
      </div>
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
        isFiltered={filtered}
        onClearFilters={() => {
          setQ("");
          setStatus("");
          setTerm("");
          setExecutor("");
          setPage(1);
        }}
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
      <MuteDialog isOpen={muting} onClose={() => setMuting(false)} />
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
