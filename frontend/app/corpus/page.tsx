"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import type { Statute, StatuteCorpus } from "@soulledger/core/api";
import { useAllStatutes } from "@soulledger/core/hooks/useStatutes";
import { citationOf, resolveCitation, statuteSigil } from "@soulledger/core/config/statuteCitation";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Skeleton } from "@/components/ui/skeleton";
import { fieldControl } from "@/src/components/ui/Field";
import { DomainEnum, DomainNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { CorpusCitedBy } from "@/src/components/judgment/CorpusCitedBy";
import { CorpusInsertIntoDesk } from "@/src/components/judgment/CorpusInsertIntoDesk";
import { usePermissions } from "@/src/hooks/usePermissions";
import { cn } from "@/lib/utils";

/**
 * 律条语料 —— 长文本阅读页(第三类 B · /corpus):左目录、中阅读栏(限 72ch)、
 * 右栏引用 / 被引用 / 版本。
 *
 * ── 衬线只给「原文」与「今译」 ────────────────────────────────────────────
 * 它们是「被说出的话」;编号用等宽,编者注、元数据、目录用无衬线(规范 v1 表态 1)。
 * 这一页的衬线数由测试钉住:阅读栏里恰好两段。
 *
 * ── 原文 / 今译 取哪一列,以及为什么多数条目的「原文」是缺值 ───────────────
 * 库里存的是 `text_zh` / `text_en` / `text_egy` 与按语言解析的 `display_text`。
 * 只有《太微仙君功過格》是按原语转录的 —— 它的 `text_zh` 就是道藏原文,于是
 * 原文 = `text_zh`,今译 = 英译(`text_en`;egy 界面有 `text_egy` 时取它)。
 * 其余五部的原语(意大利语、希腊语、埃及语)没有入库,`text_*` 都是译文:
 * 原文写成「未记录」并说明原因,今译 = `display_text`。拿译文冒充原文,就是在
 * 一页讲出处的纸上编出处。
 *
 * ── 被引用 / 版本 ────────────────────────────────────────────────────────
 * `citation_count` 是调用者**看得见的**判决里引用它的件数(0 与 null 不同,见
 * core/api/judgment.ts);清单是 `GET /judgment/?statute=<id>`,新的在前、分页
 * (`CorpusCitedBy`)。件数与清单算在同一个集合上 —— 调用者的判决列表,含行级
 * DataScope —— 所以不会对不上。律条没有版本模型(更正走 `seed_mythology --update`
 * 就地改写;已结案子的引用另有结案时快照,见 apps/judgment/snapshot.py),版本栏
 * 写明缺口,不造一个 v1。
 *
 * ── 检索与编号直达 ──────────────────────────────────────────────────────
 * 输入框同时是检索与跳转:与某条的节号(`IX · XXVI`、`救濟門 · 六`、`§ 27 / 42`、
 * `614b`)或 `code` 逐字相等(忽略空白与「·」、大小写)就直接打开那一条;否则按
 * 标题与正文检索,命中处用底色加 2 px 强调下线标出,不改字重。
 */

/** Contents order: the seven rulebooks, one civilization after another. */
const CORPUS_ORDER: StatuteCorpus[] = [
  "GONGGUOGE",
  "HELL_LAW",
  "INFERNO",
  "DEADLY_SIN",
  "NEGATIVE_CONFESSION",
  "GORGIAS",
  "REPUBLIC_ER",
];

interface Article {
  statute: Statute;
  sigil: string | null;
  division: string | null;
}

function MarkHits({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <mark
        key={at}
        data-search-hit=""
        className="bg-[oklch(var(--color-surface-2))] text-inherit shadow-[inset_0_-2px_0_oklch(var(--color-accent))]"
      >
        {text.slice(at, at + query.length)}
      </mark>
    );
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

export default function CorpusPage() {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = useAllStatutes();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 「插入审判台」cites — an act on a case, so it needs what citing needs.
  const canCite = usePermissions().hasPermission("judgment.execute");

  const articles: Article[] = useMemo(() => {
    const rank = (c: string) => {
      const i = CORPUS_ORDER.indexOf(c as StatuteCorpus);
      return i === -1 ? CORPUS_ORDER.length : i;
    };
    return [...(data ?? [])]
      .sort((a, b) => rank(a.corpus) - rank(b.corpus) || a.corpus.localeCompare(b.corpus) || a.ordinal - b.ordinal)
      .map((statute) => ({
        statute,
        sigil: statuteSigil(statute),
        division: typeof statute.payload_json?.gate === "string" ? (statute.payload_json.gate as string) : null,
      }));
  }, [data]);

  const corpusName = (c: string) => t(`judgment.statute_corpus.${c}`);
  const trimmed = query.trim();
  // The shared resolver (core/config/statuteCitation): a bare sigil, a code, or a
  // pasted 〔文献 · 条号〕 — the same bracket the rail copies — all land on the article.
  // Contents order, so a bare sigil two rulebooks share lands where it always did.
  const jumpTo = trimmed ? resolveCitation(articles.map((a) => a.statute), trimmed, corpusName) : undefined;
  const jump = jumpTo ? articles.find((a) => a.statute.id === jumpTo.id) : undefined;
  const hits = useMemo(() => {
    if (!trimmed || jump) return articles;
    const q = trimmed.toLowerCase();
    return articles.filter(({ statute: s }) =>
      [s.display_title, s.display_text, s.text_zh, s.text_en, s.code].some((f) => (f ?? "").toLowerCase().includes(q))
    );
  }, [articles, trimmed, jump]);

  const selected =
    jump ?? hits.find((a) => a.statute.id === selectedId) ?? hits[0] ?? null;
  const highlight = trimmed && !jump ? trimmed : "";
  const position = selected ? hits.indexOf(selected) : -1;

  const choose = (id: string) => {
    setSelectedId(id);
    setCopied(false);
    // A jump is finished once taken: leave the typed code, drop the lock.
    if (jump) setQuery("");
  };

  const citation = selected ? citationOf(selected.statute, corpusName) : "";

  const searchBar = (
    <div className="flex flex-wrap items-center gap-3 w-full">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("judgment.corpus.search_jump")}
        aria-label={t("judgment.corpus.search_jump")}
        className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
      />
      {data && (
        <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" data-testid="corpus-hit-count">
          {t("judgment.corpus.article_count", { n: String(jump ? 1 : hits.length) })}
        </span>
      )}
    </div>
  );

  let body: ReactNode;
  if (isError) {
    body = <QueryError onRetry={() => refetch()} />;
  } else if (isLoading || !data) {
    body = <CorpusSkeleton />;
  } else if (articles.length === 0) {
    body = <EmptyState title={t("table.no_results")} reason={t("judgment.corpus.empty_reason")} />;
  } else if (hits.length === 0) {
    body = (
      <EmptyState
        title={t("judgment.corpus.no_match", { q: trimmed })}
        reason={t("judgment.corpus.search_jump")}
        action={
          <Button type="button" variant="secondary" size="sm" onClick={() => setQuery("")}>
            {t("judgment.corpus.clear_search")}
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] border-t border-[oklch(var(--color-line))]">
        <Toc articles={hits} selectedId={selected?.statute.id ?? null} onChoose={choose} corpusName={corpusName} />
        {/* 393 px: the contents rail becomes one select. */}
        <div className="lg:hidden px-4 pt-3">
          <select
            aria-label={t("judgment.corpus.toc")}
            value={selected?.statute.id ?? ""}
            onChange={(e) => choose(e.target.value)}
            className={cn(fieldControl({ size: "md" }), "w-full")}
          >
            {groupBy(hits).map(([corpus, list]) => (
              <optgroup key={corpus} label={corpusName(corpus)}>
                {list.map((a) => (
                  <option key={a.statute.id} value={a.statute.id}>
                    {a.sigil ?? a.statute.code} · {a.statute.display_title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {selected ? (
          <Reading
            article={selected}
            highlight={highlight}
            locale={locale}
            corpusName={corpusName}
            prev={position > 0 ? hits[position - 1] : null}
            next={position >= 0 && position < hits.length - 1 ? hits[position + 1] : null}
            onChoose={choose}
          />
        ) : (
          <p className="px-10 py-6 text-sm text-[oklch(var(--color-ink-muted))]">{t("judgment.corpus.select_prompt")}</p>
        )}
        {selected && (
          <aside
            data-testid="corpus-rail"
            className="px-4 md:px-6 py-6 border-t lg:border-t-0 lg:border-l border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]"
          >
            <RailLabel>{t("judgment.corpus.cite")}</RailLabel>
            <p data-testid="corpus-citation" className="font-mono text-sm py-2">{citation}</p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(citation).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? t("judgment.corpus.copied") : t("judgment.corpus.copy_cite")}
            </Button>
            {canCite && (
              <div className="pt-2">
                <CorpusInsertIntoDesk key={selected.statute.id} statuteId={selected.statute.id} />
              </div>
            )}

            <RailLabel className="pt-6">{t("judgment.corpus.cited_by")}</RailLabel>
            <p data-testid="corpus-cited-by" className="text-sm py-2">
              {typeof selected.statute.citation_count === "number" ? (
                t("judgment.corpus.cited_by_count", { n: String(selected.statute.citation_count) })
              ) : (
                <DomainNumber
                  value={selected.statute.citation_count}
                  missingKind="unrecorded"
                  missingReason={t("judgment.corpus.citations_absent")}
                />
              )}
            </p>
            {(selected.statute.citation_count ?? 0) > 0 && (
              <CorpusCitedBy key={selected.statute.id} statuteId={selected.statute.id} />
            )}

            <RailLabel className="pt-6">{t("judgment.corpus.versions")}</RailLabel>
            <p data-testid="corpus-versions" className="text-xs text-[oklch(var(--color-ink-subtle))] py-2">
              {t("judgment.corpus.versions_gap")}
            </p>
          </aside>
        )}
      </div>
    );
  }

  return (
    <PageShell
      variant="full"
      /* `document`: this is the long-reading page — the one route whose body is
         prose to be read rather than rows to be scanned. */
      density="document"
      title={t("judgment.corpus.title")}
      subtitle={t("judgment.corpus.subtitle", { n: String(articles.length) })}
      filters={searchBar}
    >
      <div className="space-y-10">{body}</div>
    </PageShell>
  );
}

function groupBy(list: Article[]): [string, Article[]][] {
  const out: [string, Article[]][] = [];
  for (const a of list) {
    const last = out[out.length - 1];
    if (last && last[0] === a.statute.corpus) last[1].push(a);
    else out.push([a.statute.corpus, [a]]);
  }
  return out;
}

function RailLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pb-1 border-b border-[oklch(var(--color-block))] ${className}`}>
      {children}
    </h2>
  );
}

/** 目录:每部一组,当前一部展开;当前条 surface-2 底 + 左 3 px 墨线。 */
function Toc({
  articles,
  selectedId,
  onChoose,
  corpusName,
}: {
  articles: Article[];
  selectedId: string | null;
  onChoose: (id: string) => void;
  corpusName: (c: string) => string;
}) {
  const { t } = useI18n();
  const current = articles.find((a) => a.statute.id === selectedId)?.statute.corpus;
  return (
    <nav aria-label={t("judgment.corpus.toc")} className="max-lg:hidden border-r border-[oklch(var(--color-line))] py-3 text-sm">
      {groupBy(articles).map(([corpus, list]) => (
        <div key={corpus} data-toc-corpus={corpus}>
          <button
            type="button"
            onClick={() => onChoose(list[0].statute.id)}
            aria-expanded={corpus === current}
            className="w-full flex justify-between px-4 py-2 border-b border-[oklch(var(--color-rule))] font-medium text-left hover:bg-[oklch(var(--color-surface-2))]"
          >
            <span>{corpusName(corpus)}</span>
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{list.length}</span>
          </button>
          {corpus === current && (
            <ol>
              {list.map((a, i) => {
                const on = a.statute.id === selectedId;
                const newDivision = a.division && a.division !== list[i - 1]?.division;
                return (
                  <li key={a.statute.id}>
                    {newDivision && (
                      <div className="px-6 pt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{a.division}</div>
                    )}
                    <button
                      type="button"
                      aria-current={on ? "true" : undefined}
                      onClick={() => onChoose(a.statute.id)}
                      className={`w-full grid grid-cols-[5.5rem_1fr] gap-2 px-6 py-1 text-left border-b border-[oklch(var(--color-rule))] ${
                        on
                          ? "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-ink))] font-medium text-[oklch(var(--color-ink))]"
                          : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                      }`}
                    >
                      <span className="font-mono text-2xs truncate" title={a.sigil ?? a.statute.code}>{a.sigil ?? a.statute.code}</span>
                      <span className="text-xs truncate" title={a.statute.display_title}>{a.statute.display_title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
    </nav>
  );
}

function Reading({
  article,
  highlight,
  locale,
  corpusName,
  prev,
  next,
  onChoose,
}: {
  article: Article;
  highlight: string;
  locale: string;
  corpusName: (c: string) => string;
  prev: Article | null;
  next: Article | null;
  onChoose: (id: string) => void;
}) {
  const { t } = useI18n();
  const s = article.statute;
  // See the file header: only the 功過格 is stored in its source language.
  const transcribedInOriginal = s.corpus === "GONGGUOGE";
  const original = transcribedInOriginal ? s.text_zh || null : null;
  const translation = transcribedInOriginal
    ? (locale === "egy" && s.text_egy) || s.text_en || null
    : s.display_text || null;
  const serif = "font-serif text-quote mt-3 text-[oklch(var(--color-ink))]";

  return (
    <article data-testid="corpus-reading" className="px-4 md:px-10 py-6 min-w-0">
      <div className="max-w-[72ch]">
        <p className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          {corpusName(s.corpus)}
          {article.division && ` › ${article.division}`}
          {" · "}
          <DomainEnum namespace="souls.civilizations" value={s.civilization} />
        </p>
        <h1 data-testid="corpus-sigil" className="font-mono text-lg font-medium mt-2">
          {article.sigil ?? <MissingValue kind="unrecorded" reason={t("judgment.corpus.sigil_absent")} />}
        </h1>
        <p className="text-md font-medium mt-1">
          <MarkHits text={s.display_title} query={highlight} />
        </p>
        <p className="text-2xs text-[oklch(var(--color-ink-subtle))] mt-1">
          <DomainEnum namespace="judgment.statute_polarity" value={s.polarity} />
        </p>

        <h2 className="font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pt-6 pb-1 border-b border-[oklch(var(--color-block))]">{t("judgment.corpus.original")}</h2>
        {original ? (
          <p data-testid="corpus-original" className={serif}>
            <MarkHits text={original} query={highlight} />
          </p>
        ) : (
          <p data-testid="corpus-original" className="text-sm mt-3 text-[oklch(var(--color-ink-muted))]">
            <MissingValue kind="unrecorded" reason={t("judgment.corpus.original_absent")} />{" "}
            {t("judgment.corpus.original_absent")}
          </p>
        )}

        <h2 className="font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pt-6 pb-1 border-b border-[oklch(var(--color-block))]">{t("judgment.corpus.translation")}</h2>
        {translation ? (
          <p data-testid="corpus-translation" className={serif}>
            <MarkHits text={translation} query={highlight} />
          </p>
        ) : (
          <p data-testid="corpus-translation" className="mt-3">
            <MissingValue kind="unrecorded" />
          </p>
        )}

        {s.source_notes?.length > 0 && (
          <>
            <h2 className="font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pt-6 pb-1 border-b border-[oklch(var(--color-block))]">{t("judgment.corpus.notes")}</h2>
            <ul className="mt-3 space-y-2 text-sm text-[oklch(var(--color-ink-muted))]">
              {s.source_notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </>
        )}
        {s.source && (
          <>
            <h2 className="font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))] pt-6 pb-1 border-b border-[oklch(var(--color-block))]">{t("judgment.corpus.source")}</h2>
            <p className="mt-3 text-xs text-[oklch(var(--color-ink-muted))]">{s.source}</p>
          </>
        )}

        <div className="flex justify-between gap-3 pt-8">
          <Button type="button" variant="ghost" size="sm" disabled={!prev} onClick={() => prev && onChoose(prev.statute.id)}>
            ‹ {prev ? prev.sigil ?? prev.statute.code : t("common.prev")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!next} onClick={() => next && onChoose(next.statute.id)}>
            {next ? next.sigil ?? next.statute.code : t("common.next")} ›
          </Button>
        </div>
      </div>
    </article>
  );
}

/** 目录先出形状;正文按段落出骨架,行高与最终一致。 */
function CorpusSkeleton() {
  return (
    <div aria-busy="true" data-testid="corpus-skeleton" className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-6 pt-4">
      <div className="space-y-2 max-lg:hidden">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
      <div className="space-y-3 max-w-[72ch]">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-11/12" />
        <Skeleton className="h-8 w-3/4" />
      </div>
      <div className="space-y-2 max-lg:hidden">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
