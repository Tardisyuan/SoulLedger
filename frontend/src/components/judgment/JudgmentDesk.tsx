"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { judgmentApi, type Judgment, type JudgmentCitation, type Statute } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useDeferJudgment, useJudgmentPrecedents } from "@soulledger/core/hooks/useJudgments";
import { useAllStatutes } from "@soulledger/core/hooks/useStatutes";
import { citationOf, resolveCitation } from "@soulledger/core/config/statuteCitation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { forgetOpenCase, rememberOpenCase } from "@/src/lib/lastOpenCase";
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
 * D 暂缓(理由必填),只在进度条画出来时接 —— 暂缓的案子不在 `next/` 里,进度条随之消失,
 * 不会对同一件按两次。K 上一件 / J 下一件在页头(`/judgment/previous/?at=` 与 `/judgment/next/?after=`,
 * 见审判台页面);S 跳过没有画:跳过只活在队列控制台的会话里。
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
  useHotkeys({ d: () => setAsking(true) }, shown && canDefer && !asking);
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
          <Kbd>D</Kbd>
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
 *
 * 粘进来的规范引用〔文献 · 条号〕或裸节号(「救濟門 · 六」「IX · XXVI」)服务端搜不到 ——
 * 节号是前端按文明拼出来的,不是一列。所以同一个输入先在本文明的全部律条里按语料页
 * 同一个 `resolveCitation` 解一次,解出来就只给那一条。
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
  const corpus = useAllStatutes({ enabled: query.length > 0 });
  const resolved = query
    ? resolveCitation(
        (corpus.data ?? []).filter((s) => s.civilization === civilization),
        query,
        (c) => t(`judgment.statute_corpus.${c}`)
      )
    : undefined;
  const { data, isFetching, isError } = useQuery({
    queryKey: [...judgmentKeys.all, "statute-search", civilization, query],
    queryFn: () =>
      judgmentApi.statutes({ search: query, civilization }).then((r) => r.data.results ?? []),
    // Wait for the local resolve to have had its chance (or to have failed), so a
    // pasted sigil never also goes out as a text search.
    enabled: query.length > 0 && !corpus.isPending && !resolved,
    staleTime: 60_000,
  });
  const results: Statute[] = resolved ? [resolved] : (data ?? []);

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
      {query && !resolved && !corpus.isPending && !isFetching && (isError || results.length === 0) && (
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

/**
 * 语料页「插入审判台」的落点:`/judgment/<id>?cite=<statute_id>`。
 *
 * 两件事:① 记住这个用户最后打开的未结案(`src/lib/lastOpenCase.ts`),语料页据此直达;
 * 打开的是已结案、且正是记着的那件,就忘掉。② 带着 `?cite=` 进来、案子未结、有权引用:
 * 先问「引用〔…〕到 <魂> 的审判？」,确认才引用 —— 从另一页带过来的动作,不替人按下。
 * 案子已结就说一句不能再引用。处理过的 `cite` 从地址栏抹掉,刷新不会再问一次。
 */
export function CiteFromCorpus({
  judgment,
  canCite,
  onCite,
}: {
  judgment: Pick<Judgment, "id" | "soul_name" | "is_final">;
  canCite: boolean;
  onCite: (statuteId: string) => void;
}) {
  const { t } = useI18n();
  const { user } = useTenant();
  const citeId = useSearchParams()?.get("cite") ?? null;
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (judgment.is_final) forgetOpenCase(user.id, judgment.id);
    else rememberOpenCase(user.id, { id: judgment.id, soul_name: judgment.soul_name });
  }, [user, judgment.id, judgment.soul_name, judgment.is_final]);

  const asking = !!citeId && !handled && !judgment.is_final && canCite;
  const { data: statute } = useQuery({
    queryKey: [...judgmentKeys.all, "statute", citeId],
    queryFn: () => judgmentApi.statute(citeId as string).then((r) => r.data),
    enabled: asking,
    staleTime: 60_000,
  });

  const done = () => {
    setHandled(true);
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } catch {
      /* the prompt is already closed; a stale query string only re-asks on reload */
    }
  };

  if (citeId && !handled && judgment.is_final) {
    return (
      <p role="status" data-testid="cite-from-corpus-closed" className="px-4 md:px-10 py-2 text-xs text-[oklch(var(--color-ink-subtle))]">
        {t("judgment.desk.cite_from_corpus_closed")}
      </p>
    );
  }
  if (!asking || !statute) return null;
  return (
    <ConfirmDialog
      isOpen
      variant="info"
      title={t("judgment.desk.cite_from_corpus_title")}
      message={t("judgment.desk.cite_from_corpus_confirm", {
        cite: citationOf(statute, (c) => t(`judgment.statute_corpus.${c}`)),
        soul: judgment.soul_name,
      })}
      confirmText={t("judgment.desk.cite")}
      onConfirm={() => {
        onCite(statute.id);
        done();
      }}
      onCancel={done}
    />
  );
}
