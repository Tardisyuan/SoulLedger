"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { judgmentApi, type JudgmentCitation, type Statute } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useDeferJudgment, useJudgmentPrecedents } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { DomainEnum, DomainNumber, DomainText } from "@/src/components/ui/DomainValue";
import { DeferDialog, claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { useHotkeys } from "@/src/lib/hotkeys";
import { verdictGlyph, verdictInk } from "@/src/lib/verdictGlyph";

/**
 * 审判台(规范 v1 第三类 A·01)的几个原语:键帽、队列进度条、区块标、引用签、律条检索。
 * 裁决键组留在页面里 —— 它和页面的单选状态、`firstClauseRef` 绑在一起,拆出来只会多一层传参。
 */

/** 键帽 Kbd:只有常态、不可交互。边与字取所在处的 currentColor(主按钮墨底上也看得见)。`aria-hidden`:它是视觉提示,不能混进按钮的可访问名。 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden="true"
      className="font-mono text-2xs border border-current px-1.5 opacity-70"
    >
      {children}
    </kbd>
  );
}

/**
 * 队列进度条 QueueBar:3 px 墨线。数据来自 `GET /judgment/next/?at=<id>` —— 服务端把 `at`
 * 当偏好而不是筛选,所以只有回来的那一件就是本案时,`position` 才是本案的位置;否则不画。
 *
 * S 暂缓(理由必填;与队列控制台同一个键,Design 第三类 F 组答复),只在进度条画出来时接 —— 暂缓的案子不在 `next/` 里,进度条随之消失,
 * 不会对同一件按两次。K 上一件 / J 下一件在页头(`/judgment/previous/?at=` 与 `/judgment/next/?after=`,
 * 见审判台页面)。
 */
export function QueueBar({ judgmentId, canDefer = false }: { judgmentId: string; canDefer?: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const defer = useDeferJudgment();
  const [asking, setAsking] = useState(false);
  const { data } = useQuery({
    queryKey: judgmentKeys.queue([], judgmentId),
    queryFn: () => judgmentApi.next({ at: judgmentId }).then((r) => r.data),
  });
  const shown = !!data && data.judgment?.id === judgmentId && data.position !== null;
  useHotkeys({ s: () => setAsking(true) }, shown && canDefer && !asking);
  if (!shown || !data || data.position === null) return null;
  const total = Math.max(data.total, 1);
  const label = t("judgment.queue.progress", { position: String(data.position), total: String(data.total) });
  return (
    <div
      data-testid="queue-bar"
      className="flex flex-wrap items-center gap-3 px-4 md:px-10 py-2 border-b border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] font-mono text-xs text-[oklch(var(--color-ink-muted))]"
    >
      <span className="font-semibold text-[oklch(var(--color-ink))] tabular-nums">{label}</span>
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={data.position}
        className="relative flex-1 min-w-20 h-[3px] bg-[oklch(var(--color-surface-3))]"
      >
        <span
          className="absolute inset-y-0 left-0 bg-[oklch(var(--color-ink))]"
          style={{ width: `${Math.min(100, (data.position / total) * 100)}%` }}
        />
      </span>
      {canDefer && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="inline-flex items-center gap-1.5 hover:text-[oklch(var(--color-ink))] max-sm:min-h-11"
        >
          <Kbd>S</Kbd>
          {t("judgment.claim.defer")}
        </button>
      )}
      <Link
        href={`/judgment/queue?at=${encodeURIComponent(judgmentId)}`}
        className="underline hover:text-[oklch(var(--color-ink))]"
      >
        {t("judgment.queue.enter")}
      </Link>
      <DeferDialog
        isOpen={asking}
        count={1}
        pending={defer.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={(reason) =>
          defer.mutate(
            { id: judgmentId, reason },
            {
              onSuccess: () => {
                setAsking(false);
                showToast(t("judgment.claim.done_defer", { n: "1" }), "success");
              },
              onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
            }
          )
        }
      />
    </div>
  );
}

/**
 * 据 · 先例(`GET /judgment/{id}/precedents/`):同租户、同文明的已结案审判,服务端按
 * 同殿 → 余额最近 → 共同援引排序,这里照序列出,不再排。余额对 VIEWER 是 null,写「不适用」
 * 不对 —— 那是「没给」,所以 `unrecorded`。
 */
export function PrecedentsPanel({ judgmentId }: { judgmentId: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError } = useJudgmentPrecedents(judgmentId);
  const rows = data ?? [];
  return (
    <section className="mt-6" data-testid="precedents">
      <div className="flex items-baseline gap-3 border-b border-[oklch(var(--color-block))] pb-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
        <h2 className="flex-1 text-2xs uppercase">{t("judgment.precedents.title")}</h2>
        {data && <span className="tabular-nums">{rows.length}</span>}
      </div>
      {isError ? (
        <p className="py-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.precedents.error")}</p>
      ) : isLoading ? (
        <p className="py-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.precedents.empty")}</p>
      ) : (
        <ul>
          {rows.map((p) => (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-2 border-b border-[oklch(var(--color-rule))]">
              <Link href={`/judgment/${p.id}`} title={p.name || undefined} className="min-w-0 truncate text-sm text-[oklch(var(--color-ink))] hover:underline">
                <DomainText value={p.name} />
              </Link>
              <span className="text-right text-xs">
                <DomainNumber value={p.balance} signed toned />
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-[oklch(var(--color-ink-muted))]" title={p.realm_name || p.realm_code || undefined}>
                <DomainText value={p.realm_name || p.realm_code} />
                {p.same_court && ` · ${t("judgment.precedents.same_court")}`}
                {p.shared_statutes > 0 && ` · ${t("judgment.precedents.shared", { n: String(p.shared_statutes) })}`}
              </span>
              <span className={`justify-self-end border border-current px-1.5 font-mono text-2xs whitespace-nowrap ${verdictInk(p.verdict)}`}>
                <span aria-hidden="true">{verdictGlyph(p.verdict)} </span>
                <DomainEnum namespace="judgment.verdicts" value={p.verdict} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 律条引用签 CitationChip:编号 + 撤回。撤回键只在能撤回时出现(未结案且持 judgment.execute)。 */
export function CitationChips({
  citations,
  onRemove,
}: {
  citations: JudgmentCitation[];
  onRemove?: (statuteId: string) => void;
}) {
  const { t } = useI18n();
  if (citations.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 mt-2" aria-label={t("judgment.grounds.title")}>
      {citations.map((c) => (
        <li
          key={c.id}
          title={c.statute.display_title || undefined}
          className="flex items-center gap-2 border border-[oklch(var(--color-line))] px-2 font-mono text-xs"
        >
          <span>{c.statute.code}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(c.statute.id)}
              aria-label={t("judgment.desk.uncite", { code: c.statute.code })}
              className="text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-danger))]"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 律条检索:`GET /judgment/statutes/?search=…&civilization=…`(StatuteViewSet 的
 * search_fields 是编号、中英标题与正文)。空查询不发请求 —— 172 条全列出来不是检索。
 */
export function StatuteSearch({
  civilization,
  cited,
  onCite,
}: {
  civilization: string;
  cited: ReadonlySet<string>;
  onCite?: (statuteId: string) => void;
}) {
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const query = term.trim();
  const { data, isFetching, isError } = useQuery({
    queryKey: [...judgmentKeys.all, "statute-search", civilization, query],
    queryFn: () =>
      judgmentApi.statutes({ search: query, civilization }).then((r) => r.data.results ?? []),
    enabled: query.length > 0,
    staleTime: 60_000,
  });
  const results: Statute[] = data ?? [];

  return (
    <div className="mt-2">
      <label className="block">
        <span className="sr-only">{t("judgment.desk.statute_search")}</span>
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("judgment.desk.statute_search")}
          className="w-full h-8 max-sm:h-11 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-2 text-sm text-[oklch(var(--color-ink))] placeholder:text-[oklch(var(--color-ink-subtle))]"
        />
      </label>
      {query && !isFetching && (isError || results.length === 0) && (
        <p className="py-2 text-xs text-[oklch(var(--color-ink-subtle))]">
          {isError ? t("common.error") : t("judgment.desk.statute_search_empty")}
        </p>
      )}
      <ul>
        {results.map((s) => {
          const isCited = cited.has(s.id);
          return (
            <li key={s.id} className="py-2 border-b border-[oklch(var(--color-rule))]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs">{s.code}</span>
                {isCited ? (
                  <span className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.cited")}</span>
                ) : onCite ? (
                  <button
                    type="button"
                    onClick={() => onCite(s.id)}
                    className="text-xs underline text-[oklch(var(--color-accent-ink))]"
                  >
                    {t("judgment.desk.cite")}
                  </button>
                ) : null}
              </div>
              {s.display_title && <p className="text-xs text-[oklch(var(--color-ink-muted))]">{s.display_title}</p>}
              {/* 条文是「有人说过的话」,所以衬线(规范 v1 表态 1)。 */}
              {s.display_text && (
                <p className="mt-1 font-serif text-sm text-[oklch(var(--color-ink))] line-clamp-3" title={s.display_text}>{s.display_text}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** `+347` / `−12` / `0`: a balance as the ledger writes it, sign first. */
function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
}

/**
 * 乙 · 功过 on a concluded case (第三类 F 组 2.3): the balance the verdict rested on,
 * frozen at conclusion (`admitted_balance.balance` is the snapshot there), on top
 * and closed by a double rule; today's figure (`current_balance`) under it, and how
 * many records were entered since. When the two agree there is one line, 「余额」,
 * and no 「现值」 at all.
 */
export function ConcludedBalance({
  snapshot,
  current,
  recordedAfter,
}: {
  snapshot: number;
  current: number | null | undefined;
  recordedAfter: number;
}) {
  const { t } = useI18n();
  if (current == null || current === snapshot) {
    return (
      <p data-testid="concluded-balance" className="flex items-baseline justify-between py-2 text-sm">
        <span className="text-[oklch(var(--color-ink-muted))]">{t("judgment.desk.balance_single")}</span>
        <span className="font-mono text-md font-semibold tabular-nums text-[oklch(var(--color-ink))]">{signed(snapshot)}</span>
      </p>
    );
  }
  const drift = current - snapshot;
  return (
    <dl data-testid="concluded-balance" className="py-2 text-sm">
      <div className="flex items-baseline justify-between border-b-3 border-double border-[oklch(var(--color-ink))] pb-1">
        <dt className="text-[oklch(var(--color-ink))]">{t("judgment.desk.balance_at_conclusion")}</dt>
        <dd className="font-mono text-md font-semibold tabular-nums text-[oklch(var(--color-ink))]">{signed(snapshot)}</dd>
      </div>
      <div className="flex items-baseline justify-between pt-1 text-[oklch(var(--color-ink-muted))]">
        <dt>{t("judgment.desk.balance_now")}</dt>
        <dd className="font-mono tabular-nums">{signed(current)}</dd>
      </div>
      <div className="flex items-baseline justify-between text-xs text-[oklch(var(--color-ink-subtle))]">
        <dt>{t("judgment.desk.recorded_after", { n: String(recordedAfter) })}</dt>
        <dd
          className={`font-mono tabular-nums ${
            drift > 0 ? "text-[oklch(var(--color-success))]" : "text-[oklch(var(--color-danger))]"
          }`}
        >
          {signed(drift)}
        </dd>
      </div>
    </dl>
  );
}
