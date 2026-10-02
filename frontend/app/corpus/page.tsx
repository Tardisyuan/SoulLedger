"use client";

import { Fragment, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import type { Statute, StatuteCorpus } from "@soulledger/core/api";
import { useAllStatutes } from "@soulledger/core/hooks/useStatutes";
import { citationOf, resolveCitation, statuteSigil } from "@soulledger/core/config/statuteCitation";
import { sigilSystemName } from "@soulledger/core/config/civilizationSigil";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Skeleton } from "@/components/ui/skeleton";
import { fieldControl } from "@/src/components/ui/Field";
import { DomainEnum, DomainNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { CorpusCitedBy } from "@/src/components/judgment/CorpusCitedBy";
import { CorpusInsertIntoDesk } from "@/src/components/judgment/CorpusInsertIntoDesk";
import { CorpusRelated, relatedStatutes } from "@/src/components/judgment/CorpusRelated";
import { usePermissions } from "@/src/hooks/usePermissions";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { cn } from "@/lib/utils";

/**
 * 律条语料 —— 长文本阅读页(Design A3 · /corpus):左目录(按部分组、可折叠;手机是下拉)、
 * 中阅读栏(正文限 34em)、右栏引文 / 被引用 / 相关 / 版本;手机底部一条「上一条 / 插入审判台 /
 * 下一条」。条号与被引用数是展示数字:宽屏标题字体 40(`lg:text-display`,lint `type-scale` 为这一个文件放行,用户 2026-10-02),
 * 窄屏 28(Design 393);编号类型(`sigilSystemName`)写在旁边。
 *
 * ── 衬线只给「原文」与「译文」 ────────────────────────────────────────────
 * 它们是「被说出的话」;条号用标题字体,编者注、元数据、目录用界面字体。
 * 这一页的衬线数由测试钉住:阅读栏里恰好两段。
 *
 * ── 原文 / 今译 取哪一列,以及为什么多数条目的「原文」是缺值 ───────────────
 * 库里存的是 `text_zh` / `text_en` / `text_egy` 与按语言解析的 `display_text`。
 * 只有《太微仙君功過格》是按原语转录的 —— 它的 `text_zh` 就是道藏原文,于是
 * 原文 = `text_zh`,译文 = 英译(`text_en`;egy 界面有 `text_egy` 时取它)。
 * 其余几部的原语(意大利语、希腊语、埃及语)没有入库,`text_*` 都是译文:
 * 不放「原文」一节(Design A3:原文只有功过格有),那一段明写「译文」。拿译文冒充
 * 原文,就是在一页讲出处的纸上编出处。
 *
 * ── 被引用 / 版本 ────────────────────────────────────────────────────────
 * `citation_count` 是调用者**看得见的**判决里引用它的件数(0 与 null 不同,见
 * core/api/judgment.ts);清单是 `GET /judgment/?statute=<id>`,新的在前、分页
 * (`CorpusCitedBy`)。件数与清单算在同一个集合上 —— 调用者的判决列表,含行级
 * DataScope —— 所以不会对不上。版本栏读 `revision` / `effective_from`(2026-10-02 起):
 * 条文改了(`seed_mythology --update` 就地改写)才升一版、施行日记那天;存量条目是第 1 版、
 * 施行日 = 入库那天。旧文本不在这里 —— 已结案子的引用另有结案时快照(apps/judgment/snapshot.py)。
 *
 * ── 检索与编号直达 ──────────────────────────────────────────────────────
 * 输入框同时是检索与跳转:与某条的节号(`IX · XXVI`、`救濟門 · 六`、`§ 27 / 42`、
 * `614b`)或 `code` 逐字相等(忽略空白与「·」、大小写)就直接打开那一条;否则按
 * 标题与正文检索(子串)。命中处 12% 墨底加 2 px 墨下线,当前那一处反白;框里
 * 「当前 / 总数」与 ↑ ↓(Enter / Shift+Enter)按目录顺序走过标题、原文、译文里画出来的每一处。
 *
 * ── `?code=<Statute.code>` ─────────────────────────────────────────────
 * 功过记录的条款(审判台证据行、灵魂详情台账,`ClauseLink`)链到这里:打开 `code` 逐字相等的那一条,
 * 目录展开它那一部(目录本来就展开打开的那条所在的部)。没有这一条(改过编号、别的租户的语料)
 * 不装作找到:页头下一行写明「没有编号为 X 的律条」,正文照常从第一条读起;读者自己选了别的条就收起。
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

/** Where a hit sits: the article, and its index among that article's hits. */
interface Hit {
  id: string;
  k: number;
}

function countHits(text: string | null, q: string): number {
  if (!q || !text) return 0;
  const lower = text.toLowerCase();
  let n = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, at + q.length)) n += 1;
  return n;
}

/** 原文 / 译文 取哪一列 —— 见文件头:只有功過格按原语转录。 */
function passages(s: Statute, locale: string): { original: string | null; translation: string | null } {
  const transcribedInOriginal = s.corpus === "GONGGUOGE";
  return {
    original: transcribedInOriginal ? s.text_zh || null : null,
    translation: transcribedInOriginal ? (locale === "egy" && s.text_egy) || s.text_en || null : s.display_text || null,
  };
}

/** The three passages hits are counted in, in reading order. */
const hitFields = (s: Statute, locale: string) => {
  const p = passages(s, locale);
  return [s.display_title, p.original, p.translation];
};

/**
 * 命中:12% 墨底 + 下沿 2 px 墨线;当前那一处反白(墨底、surface-1 字)。不改字重。
 * `base` 是这一段之前本条已有的命中数,`current` 是当前命中在本条里的序号(不在本条为 -1)。
 */
function MarkHits({ text, query, base = 0, current = -1 }: { text: string; query: string; base?: number; current?: number }) {
  if (!query) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  let k = base;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    parts.push(text.slice(from, at));
    const on = k === current;
    parts.push(
      <mark
        key={at}
        data-search-hit=""
        data-current={on ? "" : undefined}
        className={
          on
            ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))]"
            : "bg-[oklch(var(--color-ink)/0.12)] text-inherit shadow-[inset_0_-2px_0_oklch(var(--color-ink))]"
        }
      >
        {text.slice(at, at + query.length)}
      </mark>
    );
    from = at + query.length;
    k += 1;
  }
  parts.push(text.slice(from));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

export default function CorpusPage() {
  // useSearchParams needs a Suspense boundary under the App Router build (as app/users/page.tsx).
  return (
    <Suspense fallback={null}>
      <CorpusRoute />
    </Suspense>
  );
}

function CorpusRoute() {
  const { t, locale } = useI18n();
  const linkedCode = useSearchParams()?.get("code")?.trim() ?? "";
  const { data, isLoading, isError, refetch } = useAllStatutes();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hitIndex, setHitIndex] = useState(0);
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

  // 身份带(A3):题「律条语料」,右栏「N 部 · N 条」—— 都从已载入的条文数出来,没载入就不写。
  const hall = useHall(t("plaque.office.records"));
  usePlaque({
    title: t("plaque.corpus"),
    hall,
    meta: data?.length
      ? t("plaque.corpus_meta", { works: String(new Set(data.map((s) => s.corpus)).size), n: String(data.length) })
      : undefined,
  });

  const corpusName = (c: string) => t(`judgment.statute_corpus.${c}`);
  const linked = linkedCode ? articles.find((a) => a.statute.code === linkedCode) : undefined;
  // 链接给的那条在读者自己选之前算「选中」;找不到就说出来,直到读者自己选了一条。
  const openId = selectedId ?? linked?.statute.id ?? null;
  const unknownCode = linkedCode && data && !linked && selectedId === null ? linkedCode : "";
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
  const highlight = trimmed && !jump ? trimmed : "";

  /** Every hit that is drawn (title, 原文, 译文), in contents order — what ↑ ↓ walk. */
  const occurrences: Hit[] = useMemo(() => {
    if (!highlight) return [];
    const q = highlight.toLowerCase();
    return hits.flatMap(({ statute: s }) => {
      const n = hitFields(s, locale).reduce((sum, f) => sum + countHits(f, q), 0);
      return Array.from({ length: n }, (_, k) => ({ id: s.id, k }));
    });
  }, [hits, highlight, locale]);
  const currentHit = occurrences[hitIndex] as Hit | undefined;

  const selected =
    jump ??
    (currentHit ? hits.find((a) => a.statute.id === currentHit.id) : undefined) ??
    hits.find((a) => a.statute.id === openId) ??
    hits[0] ??
    null;
  const position = selected ? hits.indexOf(selected) : -1;

  const search = (value: string) => {
    setQuery(value);
    setHitIndex(0);
  };
  const choose = (id: string) => {
    setSelectedId(id);
    setCopied(false);
    // Opening an article during a search moves the current hit to its first one (or off, if it has none).
    setHitIndex(occurrences.findIndex((o) => o.id === id));
    // A jump is finished once taken: leave the typed code, drop the lock.
    if (jump) setQuery("");
  };
  const step = (by: 1 | -1) => {
    if (!occurrences.length) return;
    setHitIndex((i) => (Math.max(i, 0) + by + occurrences.length) % occurrences.length);
    setCopied(false);
  };

  useEffect(() => {
    document.querySelector("[data-search-hit][data-current]")?.scrollIntoView?.({ block: "nearest" });
  }, [hitIndex, highlight]);

  const citation = selected ? citationOf(selected.statute, corpusName) : "";
  const hitCorpora = new Set(occurrences.map((o) => hits.find((a) => a.statute.id === o.id)?.statute.corpus)).size;

  const searchBar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 w-full">
      <div
        className={cn(
          "flex items-center gap-2 flex-1 min-w-[200px] max-w-[640px] h-(--control-h-sm) lg:h-(--control-h-md) px-3 rounded-(--radius-control) border bg-[oklch(var(--color-surface-1))] focus-within:shadow-[0_0_0_2px_oklch(var(--color-focus)/0.35)]",
          occurrences.length ? "border-[oklch(var(--color-ink))]" : "border-[oklch(var(--color-line-strong))]"
        )}
      >
        <span aria-hidden="true" className="text-[oklch(var(--color-ink-muted))]">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && occurrences.length) {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder={t("judgment.corpus.search_paste")}
          aria-label={t("judgment.corpus.search_jump")}
          className="flex-1 min-w-0 h-full bg-transparent text-sm outline-none placeholder:text-[oklch(var(--color-ink-subtle))] [&::-webkit-search-cancel-button]:hidden"
        />
        {occurrences.length > 0 && (
          <span data-testid="corpus-hit-position" className="font-mono text-xs whitespace-nowrap">
            {Math.max(hitIndex, 0) + 1} / {occurrences.length}
          </span>
        )}
        {occurrences.length > 0 && (
          <>
            <button type="button" aria-label={t("judgment.corpus.hit_prev")} onClick={() => step(-1)} className="w-7 h-full hover:bg-[oklch(var(--color-surface-2))]">
              <span aria-hidden="true">↑</span>
            </button>
            <button type="button" aria-label={t("judgment.corpus.hit_next")} onClick={() => step(1)} className="w-7 h-full hover:bg-[oklch(var(--color-surface-2))]">
              <span aria-hidden="true">↓</span>
            </button>
          </>
        )}
        {query && (
          <button type="button" aria-label={t("judgment.corpus.clear_search")} onClick={() => search("")} className="w-7 h-full hover:bg-[oklch(var(--color-surface-2))]">
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
      {data && (
        <span className="text-xs text-[oklch(var(--color-ink-muted))]" data-testid="corpus-hit-count">
          {highlight
            ? t("judgment.corpus.hits_summary", { c: String(hitCorpora), n: String(occurrences.length) })
            : t("judgment.corpus.article_count", { n: String(jump ? 1 : hits.length) })}
        </span>
      )}
    </div>
  );

  const hitsIn = (pred: (a: Article) => boolean) => {
    const ids = new Set(hits.filter(pred).map((a) => a.statute.id));
    return occurrences.filter((o) => ids.has(o.id)).length;
  };

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
          <Button type="button" variant="secondary" size="sm" onClick={() => search("")}>
            {t("judgment.corpus.clear_search")}
          </Button>
        }
      />
    );
  } else {
    const prev = position > 0 ? hits[position - 1] : null;
    const next = position >= 0 && position < hits.length - 1 ? hits[position + 1] : null;
    const cited = selected?.statute.citation_count;
    body = (
      <div className="grid grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_288px] lg:pt-4 pb-6">
        <Toc
          articles={hits}
          selectedId={selected?.statute.id ?? null}
          onChoose={choose}
          corpusName={corpusName}
          count={highlight ? (a) => hitsIn((x) => x === a) : null}
          corpusCount={highlight ? (c) => hitsIn((x) => x.statute.corpus === c) : null}
        />
        {/* 393 px: the contents rail becomes one select. */}
        <div className="lg:hidden px-4 py-3 border-b border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]">
          <select
            aria-label={t("judgment.corpus.toc")}
            value={selected?.statute.id ?? ""}
            onChange={(e) => choose(e.target.value)}
            className={cn(fieldControl({ size: "sm" }), "w-full")}
          >
            {groupBy(hits).map(([corpus, list]) => (
              <optgroup key={corpus} label={corpusName(corpus)}>
                {list.map((a) => (
                  <option key={a.statute.id} value={a.statute.id}>
                    {corpusName(corpus)} › {a.sigil ?? a.statute.code} {a.statute.display_title}
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
            current={currentHit?.id === selected.statute.id ? currentHit.k : -1}
            locale={locale}
            corpusName={corpusName}
            prev={prev}
            next={next}
            onChoose={choose}
          />
        ) : (
          <p className="px-8 py-6 text-sm text-[oklch(var(--color-ink-muted))]">{t("judgment.corpus.select_prompt")}</p>
        )}
        {selected && (
          <aside
            data-testid="corpus-rail"
            className="space-y-4 px-4 lg:pl-4 lg:pr-0 py-6 lg:py-0 border-t lg:border-t-0 lg:border-l border-[oklch(var(--color-line))]"
          >
            <section>
              <RailLabel>{t("judgment.corpus.cite")}</RailLabel>
              <div className="flex items-center gap-2 h-(--control-h-sm) pl-3 border border-[oklch(var(--color-line-strong))] rounded-(--radius-control)">
                <span data-testid="corpus-citation" title={citation} className="flex-1 min-w-0 truncate font-mono text-xs">
                  {citation}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(citation).then(() => setCopied(true), () => setCopied(false));
                  }}
                >
                  {copied ? t("judgment.corpus.copied") : t("judgment.corpus.copy_cite")}
                </Button>
              </div>
              {canCite && (
                <div className="max-lg:hidden pt-2">
                  <CorpusInsertIntoDesk key={selected.statute.id} statuteId={selected.statute.id} />
                </div>
              )}
            </section>

            <section className="pt-4 border-t border-[oklch(var(--color-line))]">
              <RailLabel>{t("judgment.corpus.cited_by")}</RailLabel>
              <p data-testid="corpus-cited-by" className="flex items-baseline gap-2">
                {typeof cited === "number" ? (
                  <>
                    <span className="font-title text-xl font-semibold lg:text-display">{cited}</span>
                    <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t("judgment.corpus.cited_by_unit")}</span>
                  </>
                ) : (
                  <DomainNumber value={cited} missingKind="unrecorded" missingReason={t("judgment.corpus.citations_absent")} />
                )}
              </p>
              {(cited ?? 0) > 0 && <CorpusCitedBy key={selected.statute.id} statuteId={selected.statute.id} />}
            </section>

            {relatedStatutes(selected.statute, data) && (
              <section>
                <RailLabel>{t("judgment.corpus.related")}</RailLabel>
                {/* A related article may sit outside the current search hits: clear the search so it can open. */}
                <CorpusRelated
                  statute={selected.statute}
                  all={data}
                  onChoose={(id) => {
                    search("");
                    choose(id);
                  }}
                />
              </section>
            )}

            <section>
              <RailLabel>{t("judgment.corpus.versions")}</RailLabel>
              {/* 第几版 + 自哪天起施行(见文件头)。旧接口不带这两列时是「未记录」,不造一个 v1。 */}
              <p data-testid="corpus-versions" className="text-sm text-[oklch(var(--color-ink-muted))]">
                {selected.statute.revision ? (
                  <>
                    <span className="text-[oklch(var(--color-ink))]">{t("judgment.corpus.revision", { n: String(selected.statute.revision) })}</span>
                    <span className="block pt-1 text-2xs text-[oklch(var(--color-ink-subtle))]">
                      {t("judgment.corpus.effective_from", { date: selected.statute.effective_from })}
                    </span>
                  </>
                ) : (
                  <MissingValue kind="unrecorded" />
                )}
              </p>
            </section>
          </aside>
        )}
        {selected && (
          /* 393:上一条 / 插入审判台 / 下一条,吸在底栏上方。 */
          <div className="lg:hidden sticky bottom-(--bottom-bar) z-10 grid grid-cols-[56px_1fr_56px] gap-2 px-4 py-2 border-t border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]">
            <NavSquare article={prev} label={t("judgment.corpus.prev_article")} glyph="←" onChoose={choose} />
            {canCite ? (
              <CorpusInsertIntoDesk key={selected.statute.id} statuteId={selected.statute.id} size="lg" />
            ) : (
              <span />
            )}
            <NavSquare article={next} label={t("judgment.corpus.next_article")} glyph="→" onChoose={choose} />
          </div>
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
      {unknownCode && (
        <p role="status" data-testid="corpus-unknown-code" className="px-4 lg:px-0 pt-4 text-sm text-[oklch(var(--color-ink-muted))]">
          {t("judgment.corpus.unknown_code", { code: unknownCode })}
        </p>
      )}
      <div className="space-y-12">{body}</div>
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

function RailLabel({ children }: { children: ReactNode }) {
  return <h2 className="pb-2 text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">{children}</h2>;
}

/** 手机底条两端的 56 方格:等宽编号。没有上 / 下一条时禁用。 */
function NavSquare({ article, label, glyph, onChoose }: { article: Article | null; label: string; glyph: string; onChoose: (id: string) => void }) {
  return (
    <button
      type="button"
      disabled={!article}
      aria-label={article ? `${label} · ${article.sigil ?? article.statute.code}` : label}
      onClick={() => article && onChoose(article.statute.id)}
      title={article ? article.sigil ?? article.statute.code : undefined}
      className="size-(--control-h-lg) truncate px-1 border border-[oklch(var(--color-line-strong))] font-mono text-xs disabled:opacity-40"
    >
      {article ? article.sigil ?? article.statute.code : <span aria-hidden="true">{glyph}</span>}
    </button>
  );
}

/**
 * 目录:每部一行(▸ / ▾ + 名称 + 条数;检索时是命中数),点一部只展开 / 收起它;
 * 打开的那条所在的一部默认展开。当前条 7% 墨底 + 500。
 */
function Toc({
  articles,
  selectedId,
  onChoose,
  corpusName,
  count,
  corpusCount,
}: {
  articles: Article[];
  selectedId: string | null;
  onChoose: (id: string) => void;
  corpusName: (c: string) => string;
  count: ((a: Article) => number) | null;
  corpusCount: ((corpus: string) => number) | null;
}) {
  const { t } = useI18n();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const current = articles.find((a) => a.statute.id === selectedId)?.statute.corpus;
  return (
    <nav aria-label={t("judgment.corpus.toc")} className="max-lg:hidden pr-4 border-r border-[oklch(var(--color-line))] text-sm">
      {groupBy(articles).map(([corpus, list]) => {
        const open = toggled[corpus] ?? corpus === current;
        return (
          <div key={corpus} data-toc-corpus={corpus}>
            <button
              type="button"
              onClick={() => setToggled((o) => ({ ...o, [corpus]: !open }))}
              aria-expanded={open}
              className="w-full flex items-center gap-2 h-(--control-h-sm) text-left hover:bg-[oklch(var(--color-surface-2))]"
            >
              <span aria-hidden="true" className="w-3 text-[oklch(var(--color-ink-subtle))]">{open ? "▾" : "▸"}</span>
              <span title={corpusName(corpus)} className={`flex-1 min-w-0 truncate ${open ? "font-medium" : ""}`}>{corpusName(corpus)}</span>
              <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{corpusCount ? corpusCount(corpus) : list.length}</span>
            </button>
            {open && (
              <ol className="ml-3 border-l border-[oklch(var(--color-line))]">
                {list.map((a, i) => {
                  const on = a.statute.id === selectedId;
                  const newDivision = a.division && a.division !== list[i - 1]?.division;
                  return (
                    <li key={a.statute.id}>
                      {newDivision && (
                        <div className="pl-3 pt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{a.division}</div>
                      )}
                      <button
                        type="button"
                        aria-current={on ? "true" : undefined}
                        onClick={() => onChoose(a.statute.id)}
                        className={`w-full grid grid-cols-[minmax(28px,auto)_1fr_auto] items-center gap-2 min-h-10 pl-3 pr-1 text-left ${
                          on
                            ? "bg-[oklch(var(--color-ink)/0.07)] font-medium text-[oklch(var(--color-ink))]"
                            : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                        }`}
                      >
                        <span className="max-w-24 font-mono text-2xs truncate" title={a.sigil ?? a.statute.code}>{a.sigil ?? a.statute.code}</span>
                        <span className="text-xs truncate" title={a.statute.display_title}>{a.statute.display_title}</span>
                        {count ? <span className="font-mono text-2xs">{count(a) || ""}</span> : <span />}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Reading({
  article,
  highlight,
  current,
  locale,
  corpusName,
  prev,
  next,
  onChoose,
}: {
  article: Article;
  highlight: string;
  /** The current hit's index within this article, or -1. */
  current: number;
  locale: string;
  corpusName: (c: string) => string;
  prev: Article | null;
  next: Article | null;
  onChoose: (id: string) => void;
}) {
  const { t } = useI18n();
  const s = article.statute;
  const { original, translation } = passages(s, locale);
  const q = highlight.toLowerCase();
  // Hit numbering runs title → 原文 → 译文, the same order `hitFields` counts them in.
  const inTitle = countHits(s.display_title, q);
  const inOriginal = countHits(original, q);
  const serif = "font-serif text-md leading-7 font-normal max-w-[34em] text-pretty text-[oklch(var(--color-ink))]";
  const notes = s.source_notes?.length ? (
    <ul className="space-y-2 max-w-[40em] text-sm text-[oklch(var(--color-ink-muted))]">
      {s.source_notes.map((note, i) => (
        <li key={i}>{note}</li>
      ))}
    </ul>
  ) : null;

  return (
    <article data-testid="corpus-reading" className="min-w-0 space-y-4 px-4 lg:px-8 pt-4 lg:pt-0">
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">
        {corpusName(s.corpus)}
        {article.division && ` › ${article.division}`}
        {" · "}
        <DomainEnum namespace="souls.civilizations" value={s.civilization} />
      </p>
      <header className="pb-4 border-b border-[oklch(var(--color-line))]">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p data-testid="corpus-sigil" className="font-title text-xl font-semibold lg:text-display">
            {article.sigil ?? <MissingValue kind="unrecorded" reason={t("judgment.corpus.sigil_absent")} />}
          </p>
          <span className="text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">{sigilSystemName(s.civilization)}</span>
        </div>
        <h1 className="font-title text-lg mt-2">
          <MarkHits text={s.display_title} query={highlight} current={current} />
        </h1>
        <p className="text-2xs text-[oklch(var(--color-ink-subtle))] mt-1">
          <DomainEnum namespace="judgment.statute_polarity" value={s.polarity} />
        </p>
      </header>

      {/* 原文只有功過格有(见文件头);别的六部不放这一节,译文就是标成「译文」的那一段。 */}
      {s.corpus === "GONGGUOGE" && (
        <section className="space-y-3">
          <RailLabel>{t("judgment.corpus.original")}</RailLabel>
          {original ? (
            <p data-testid="corpus-original" className={serif}>
              <MarkHits text={original} query={highlight} base={inTitle} current={current} />
            </p>
          ) : (
            <p data-testid="corpus-original">
              <MissingValue kind="unrecorded" reason={t("judgment.corpus.original_absent")} />
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <RailLabel>{t("judgment.corpus.translation")}</RailLabel>
        {translation ? (
          <p data-testid="corpus-translation" className={serif}>
            <MarkHits text={translation} query={highlight} base={inTitle + inOriginal} current={current} />
          </p>
        ) : (
          <p data-testid="corpus-translation">
            <MissingValue kind="unrecorded" />
          </p>
        )}
      </section>

      {notes && (
        <>
          <section className="max-lg:hidden space-y-3">
            <RailLabel>{t("judgment.corpus.notes")}</RailLabel>
            {notes}
          </section>
          <details className="lg:hidden">
            <summary className="min-h-(--control-h-sm) flex items-center text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
              {t("judgment.corpus.notes")}
            </summary>
            {notes}
          </details>
        </>
      )}
      {s.source && (
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("judgment.corpus.source")} <span className="font-mono">{s.source}</span>
        </p>
      )}

      <nav className="max-lg:hidden grid grid-cols-2 gap-3 pt-3 border-t border-[oklch(var(--color-line))]">
        <ArticleLink article={prev} label={`← ${t("judgment.corpus.prev_article")}`} onChoose={onChoose} />
        <ArticleLink article={next} label={`${t("judgment.corpus.next_article")} →`} onChoose={onChoose} end />
      </nav>
    </article>
  );
}

function ArticleLink({ article, label, onChoose, end = false }: { article: Article | null; label: string; onChoose: (id: string) => void; end?: boolean }) {
  if (!article) return <span />;
  return (
    <button
      type="button"
      onClick={() => onChoose(article.statute.id)}
      className={`min-h-(--control-h-sm) min-w-0 py-1 hover:bg-[oklch(var(--color-surface-2))] ${end ? "text-right" : "text-left"}`}
    >
      <span className="block text-2xs text-[oklch(var(--color-ink-subtle))]">{label}</span>
      <span title={`${article.sigil ?? article.statute.code} ${article.statute.display_title}`} className="block truncate text-sm">
        {article.sigil ?? article.statute.code} {article.statute.display_title}
      </span>
    </button>
  );
}

/** 目录先出形状;正文按段落出骨架,行高与最终一致。 */
function CorpusSkeleton() {
  return (
    <div aria-busy="true" data-testid="corpus-skeleton" className="grid grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_288px] gap-6 pt-4">
      <div className="space-y-2 max-lg:hidden">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
      <div className="space-y-3 max-w-[34em]">
        <Skeleton className="h-12 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-11/12" />
        <Skeleton className="h-8 w-3/4" />
      </div>
      <div className="space-y-2 max-lg:hidden">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
