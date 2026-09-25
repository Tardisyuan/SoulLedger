"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import {
  judgmentApi,
  PAGE_SIZE,
  type Judgment,
  type JudgmentBatchOperation,
  type JudgmentQueueGroup,
} from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import {
  useBatchJudgments,
  useClaimJudgment,
  useJudgmentQueueCounts,
} from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { Pagination } from "@/src/components/ui/Pagination";
import { DomainEnum, DomainNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { Kbd } from "@/src/components/judgment/JudgmentDesk";
import { DeferDialog, ReassignDialog, claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { ROW_LINK } from "@/components/ui/data-table";
import { useHotkeys } from "@/src/lib/hotkeys";
import { ClaimAvatar } from "@/src/components/judgment/ClaimAvatar";
import { MISSING_LABEL_KEY } from "@/src/lib/domainDisplay";

/**
 * 审判队列的「待审」一面(规范 v1 第三类 A·02):按「谁在处理」分四组 —— 我认领 / 待认领 /
 * 他人认领 / 暂缓。组是服务端的 `?group=`,组头的数是 `queue-counts/`,两者用同一组
 * `court` / `search`,所以数与行出自同一个筛选。每组各自分页、各按等待最久在上
 * (`ordering=created_at`,队列本身就按它先进先出)。
 *
 * 键盘:J / K 在行间移焦点(焦点落在行里那条链接上,所以 ⏎ 就是链接自己的 ⏎,不另接),
 * X 勾选、C 认领焦点所在的行。打字时一概不接(`src/lib/hotkeys.ts`)。
 *
 * 批量只做认领、改派、暂缓(brief §4.2:不做批量裁决)。`/judgment/batch/` 全有或全无、
 * 一次至多 100 件;被拒时整批回滚,拒绝码说是哪一件、为什么。
 */

const GROUPS: readonly JudgmentQueueGroup[] = ["mine", "unclaimed", "others", "deferred"];
const BATCH_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 300;
const DAY_MS = 86_400_000;
/** 等待超过这么多天的行,等待数改警示色(稿子里的 137 天 / 53 天)。 */
const LONG_WAIT_DAYS = 30;

export function JudgmentClaimQueue() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const canExecute = hasPermission("judgment.execute");
  const canAssign = hasPermission("judgment.assign");

  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [court, setCourt] = useState("");
  const [pages, setPages] = useState<Record<JudgmentQueueGroup, number>>({ mine: 1, unclaimed: 1, others: 1, deferred: 1 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"defer" | "reassign" | null>(null);
  const [now] = useState(() => Date.now());
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term.trim());
      setPages({ mine: 1, unclaimed: 1, others: 1, deferred: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const filters: Record<string, string> = {};
  if (search) filters.search = search;
  if (court) filters.court = court;

  const counts = useJudgmentQueueCounts(filters);
  const groupQueries = useQueries({
    queries: GROUPS.map((group) => {
      const params = { ...filters, group, page: String(pages[group]), ordering: "created_at" };
      return {
        queryKey: judgmentKeys.list(params),
        queryFn: async () => (await judgmentApi.list(params)).data,
        placeholderData: (previous: unknown) => previous as never,
      };
    }),
  });
  const rowsOf = (i: number): Judgment[] => groupQueries[i].data?.results ?? [];
  const allRows = GROUPS.flatMap((_, i) => rowsOf(i));
  const selectable = new Set(allRows.map((j) => j.id));
  const chosen = [...selected].filter((id) => selectable.has(id));

  /* 殿的选项:当前各组行里出现过的殿,加上已选的那一个。后端没有「列出殿」的接口,
     `court` 是自由文本、按原值精确匹配,所以选项只能从真实的行里来。 */
  const courts = [...new Set([...allRows.map((j) => j.court).filter(Boolean), ...(court ? [court] : [])])].sort();

  const claim = useClaimJudgment();
  const batch = useBatchJudgments();

  const runBatch = (operation: JudgmentBatchOperation, extra: { to?: number; reason?: string } = {}) => {
    const ids = chosen.slice(0, BATCH_LIMIT);
    batch.mutate(
      { operation, ids, ...extra },
      {
        onSuccess: () => {
          showToast(t(`judgment.claim.done_${operation}`, { n: String(ids.length) }), "success");
          setSelected(new Set());
          setDialog(null);
        },
        onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
      }
    );
  };

  const claimOne = (id: string) =>
    claim.mutate(id, {
      onSuccess: () => showToast(t("judgment.claim.done_claim", { n: "1" }), "success"),
      onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
    });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** J / K:把 DOM 焦点移到相邻行的链接上。没有焦点行时,J 落到第一行、K 落到最后一行。 */
  const move = (step: 1 | -1) => {
    if (allRows.length === 0) return;
    const at = focused ? allRows.findIndex((j) => j.id === focused) : -1;
    const next = at === -1 ? (step === 1 ? 0 : allRows.length - 1) : Math.min(allRows.length - 1, Math.max(0, at + step));
    const id = allRows[next].id;
    tableRef.current?.querySelector<HTMLAnchorElement>(`[data-row-link="${id}"]`)?.focus();
    setFocused(id);
  };

  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    x: () => {
      if (focused && canExecute && selectable.has(focused)) toggle(focused);
    },
    c: () => {
      if (focused && canExecute && !claim.isPending) claimOne(focused);
    },
  });

  const waitingDays = (j: Judgment) => Math.max(0, Math.floor((now - new Date(j.created_at).getTime()) / DAY_MS));
  const colSpan = canExecute ? 8 : 7;

  return (
    <div>
      {/* ── 筛选条:搜索 · 殿 ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <label className="min-w-0 flex-1 sm:flex-none sm:w-64">
          <span className="sr-only">{t("judgment.claim.search")}</span>
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("judgment.claim.search")}
            className="w-full h-8 max-sm:h-11 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-2 text-sm text-[oklch(var(--color-ink))] placeholder:text-[oklch(var(--color-ink-subtle))]"
          />
        </label>
        <label>
          <span className="sr-only">{t("judgment.court")}</span>
          <select
            value={court}
            onChange={(e) => {
              setCourt(e.target.value);
              setPages({ mine: 1, unclaimed: 1, others: 1, deferred: 1 });
            }}
            className="h-8 max-sm:h-11 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-2 text-sm text-[oklch(var(--color-ink))]"
          >
            <option value="">{t("judgment.claim.court_all")}</option>
            {courts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── 批量条:只在有勾选时出现。认领 / 改派… / 暂缓,不做批量裁决。 ── */}
      {canExecute && chosen.length > 0 && (
        <div
          data-testid="batch-bar"
          className="flex flex-wrap items-center gap-2 px-3 py-1.5 mb-2 border border-[oklch(var(--color-block))] bg-[oklch(var(--color-surface-2))] text-sm"
        >
          <span className="font-mono text-xs tabular-nums">{t("judgment.claim.selected", { n: String(chosen.length) })}</span>
          <Button type="button" size="sm" variant="secondary" loading={batch.isPending} onClick={() => runBatch("claim")}>
            {t("judgment.claim.claim")}
          </Button>
          {canAssign && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setDialog("reassign")}>
              {t("judgment.claim.reassign")}
            </Button>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={() => setDialog("defer")}>
            {t("judgment.claim.defer")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("judgment.claim.clear_selection")}
          </Button>
          {chosen.length > BATCH_LIMIT && (
            <span className="text-xs text-[oklch(var(--color-warning))]">
              {t("judgment.claim.batch_limit", { n: String(BATCH_LIMIT) })}
            </span>
          )}
        </div>
      )}

      <table ref={tableRef} className="w-full text-sm border-t border-[oklch(var(--color-block))]" aria-label={t("judgment.pending")}>
        <thead>
          <tr className="font-mono text-2xs uppercase text-[oklch(var(--color-ink-subtle))] border-b border-[oklch(var(--color-block))]">
            {canExecute && <th scope="col" className="w-6"><span className="sr-only">{t("judgment.claim.select")}</span></th>}
            <th scope="col" className="px-2 py-1 text-left font-normal">{t("judgment.soul_name")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal max-md:hidden">{t("judgment.civilization")}</th>
            <th scope="col" className="px-2 py-1 text-left font-normal max-md:hidden">{t("judgment.court")}</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">{t("judgment.claim.balance")}</th>
            <th scope="col" className="px-2 py-1 text-right font-normal max-md:hidden">{t("judgment.detail.evidence")}</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">{t("judgment.waiting")}</th>
            <th scope="col" className="px-2 py-1 text-center font-normal">{t("judgment.claim.claimant")}</th>
          </tr>
        </thead>
        {GROUPS.map((group, gi) => {
          const q = groupQueries[gi];
          const rows = rowsOf(gi);
          const count = counts.data?.[group];
          const total = q.data?.count ?? 0;
          return (
            <tbody key={group} data-testid={`queue-group-${group}`}>
              {/* 分组头 GroupHeader:组名 · 服务端计数 · 一句提示。 */}
              <tr className="border-b border-[oklch(var(--color-line))]">
                <th scope="rowgroup" colSpan={colSpan} className="px-2 pt-4 pb-1 text-left font-normal">
                  <span className="text-xs font-semibold text-[oklch(var(--color-ink))]">{t(`judgment.claim.groups.${group}`)}</span>
                  <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]" data-testid={`group-count-${group}`}>
                    {" · "}
                    {count ?? "…"}
                  </span>
                  {(group === "unclaimed" || group === "others") && (
                    <span className="ml-3 text-xs text-[oklch(var(--color-ink-subtle))]">{t(`judgment.claim.hints.${group}`)}</span>
                  )}
                </th>
              </tr>
              {q.isError ? (
                <tr>
                  <td colSpan={colSpan}>
                    <QueryError onRetry={() => q.refetch()} />
                  </td>
                </tr>
              ) : q.isLoading ? (
                <tr aria-busy="true">
                  <td colSpan={colSpan} className="h-7 px-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="h-7 px-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.claim.group_empty")}</td>
                </tr>
              ) : (
                rows.map((j) => {
                  const isSel = selected.has(j.id);
                  const isFocus = focused === j.id;
                  const days = waitingDays(j);
                  const mine = j.claimed_by != null && j.claimed_by === user?.id;
                  return (
                    <tr
                      key={j.id}
                      data-testid="queue-row"
                      data-focused={isFocus ? "true" : undefined}
                      onFocus={() => setFocused(j.id)}
                      className={`relative h-7 max-sm:h-11 border-b border-[oklch(var(--color-rule))] hover:bg-[oklch(var(--color-surface-2))] ${
                        isSel || isFocus ? "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-accent))]" : ""
                      }`}
                    >
                      {canExecute && (
                        <td className="w-6 px-1 relative z-10">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(j.id)}
                            aria-label={t("judgment.claim.select_row", { name: j.soul_name || t(MISSING_LABEL_KEY.unrecorded) })}
                            className="h-3.5 w-3.5 max-sm:h-5 max-sm:w-5 accent-[oklch(var(--color-accent))]"
                          />
                        </td>
                      )}
                      <td className="px-2 font-medium text-[oklch(var(--color-ink))] whitespace-nowrap max-w-56 truncate" title={j.soul_name || undefined}>
                        <Link href={`/judgment/${j.id}`} data-row-link={j.id} className={ROW_LINK}>
                          {j.soul_name ? j.soul_name : <MissingValue kind="unrecorded" reason="soul_name 未随判决返回" />}
                        </Link>
                      </td>
                      <td className="px-2 text-xs text-[oklch(var(--color-ink-muted))] whitespace-nowrap max-md:hidden">
                        <DomainEnum namespace="souls.civilizations" value={j.civilization} />
                      </td>
                      <td className="px-2 text-xs text-[oklch(var(--color-ink-muted))] whitespace-nowrap max-w-48 truncate max-md:hidden" title={[j.court, j.judge_name].filter(Boolean).join(" · ") || undefined}>
                        {[j.court, j.judge_name].filter(Boolean).join(" · ") || <MissingValue kind="unrecorded" />}
                      </td>
                      <td className="px-2 text-right text-xs">
                        {/* 余额只有功过格有;别的文明服务端给 null,是「不适用」不是「没记」。 */}
                        <DomainNumber value={j.karmic_balance} signed toned missingKind={j.karmic_balance === null ? "inapplicable" : "unrecorded"} />
                      </td>
                      <td className="px-2 text-right text-xs max-md:hidden">
                        <DomainNumber value={j.evidence_count} />
                      </td>
                      <td
                        className={`px-2 text-right font-mono text-xs tabular-nums whitespace-nowrap ${
                          days > LONG_WAIT_DAYS ? "text-[oklch(var(--color-warning))]" : "text-[oklch(var(--color-ink-muted))]"
                        }`}
                        title={group === "deferred" && j.defer_reason ? j.defer_reason : undefined}
                      >
                        {t("judgment.waiting_days", { n: String(days) })}
                      </td>
                      <td className="px-2 relative z-10">
                        <span className="flex justify-center">
                          {j.claimed_by != null ? (
                            <ClaimAvatar name={j.claimed_by_name ?? ""} mine={mine} />
                          ) : canExecute && group !== "deferred" ? (
                            <button
                              type="button"
                              onClick={() => claimOne(j.id)}
                              className="text-xs underline text-[oklch(var(--color-accent-ink))] max-sm:min-h-11"
                            >
                              {t("judgment.claim.claim")}
                            </button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
              {total > PAGE_SIZE && (
                <tr>
                  <td colSpan={colSpan}>
                    <Pagination
                      page={pages[group]}
                      totalPages={Math.ceil(total / PAGE_SIZE)}
                      count={total}
                      onPageChange={(p) => setPages((prev) => ({ ...prev, [group]: p }))}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>

      <p className="mt-3 font-mono text-2xs text-[oklch(var(--color-ink-subtle))] max-md:hidden">
        <Kbd>J</Kbd>/<Kbd>K</Kbd> {t("judgment.claim.key_move")} · <Kbd>X</Kbd> {t("judgment.claim.select")} ·{" "}
        <Kbd>C</Kbd> {t("judgment.claim.claim")} · <Kbd>⏎</Kbd> {t("judgment.claim.key_open")}
      </p>

      <DeferDialog
        isOpen={dialog === "defer"}
        count={Math.min(chosen.length, BATCH_LIMIT)}
        pending={batch.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => runBatch("defer", { reason })}
      />
      <ReassignDialog
        isOpen={dialog === "reassign"}
        count={Math.min(chosen.length, BATCH_LIMIT)}
        pending={batch.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(to) => runBatch("reassign", { to })}
      />
    </div>
  );
}
