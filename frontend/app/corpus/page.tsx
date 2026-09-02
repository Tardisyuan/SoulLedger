"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { PAGE_SIZE, type Statute, type StatuteCorpus } from "@/lib/api";
import { useStatutes, groupStatutesByCorpus, type CorpusGroup } from "@/src/hooks/useStatutes";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { PageSpinner } from "@/src/components/ui/Spinner";
import { fieldControl } from "@/src/components/ui/Field";
import { DomainEnum, DomainNumber, DomainText } from "@/src/components/ui/DomainValue";
import {
  CIVILIZATION_OPTIONS,
  CIVILIZATION_SHORT_CODES,
  isCivilizationOption,
} from "@/src/config/civilizations";
import {
  civilizationNamesOffences,
  formatSigil,
  sigilSystemName,
  type StatuteRef,
} from "@/src/config/civilizationSigil";
import { cn } from "@/lib/utils";

/**
 * The corpus browser — 172 transcribed articles, previously reachable from
 * nowhere.
 *
 * They existed before this page did: `judgmentApi.statutes` has been wired
 * since the grounds feature landed, and `StatuteViewSet` paginates, filters and
 * searches them. The only place any of them ever reached a screen was
 * `JudgmentGroundsPanel`, which shows the handful a single verdict cites. A
 * hundred and seventy-five articles of transcription with no index is a library
 * with no catalogue.
 *
 * ── WHY THIS IS SET AS A CODE AND NOT AS A MANUSCRIPT ────────────────────────
 *
 * The obvious move with this material is the illuminated page: centred column,
 * swash capitals, a drop cap. It is the wrong one. These articles are not read
 * for pleasure — they are the *norms verdicts are founded on*, and what a
 * reader does here is look one up, set it beside its neighbour, and ask how
 * often it has actually been relied on. Those are the three things a statute
 * book's layout is for: a numbered margin you can scan, a body column of even
 * measure, and a tally. A centred manuscript block defeats all three, because
 * ragged-both-sides text has no scannable edge and a decorated initial is a
 * hundred milliseconds spent on the letter rather than the article.
 *
 * So exactly one thing survives from the manuscript reading, and it is the one
 * that costs nothing: the article body is set in the serif. Everything around
 * it — sigil, headings, tally — is the mono/sans apparatus of a code.
 *
 * ── ORDERING, AND WHY IT DEPENDS ON THE FILTER ───────────────────────────────
 *
 * `StatuteViewSet.ordering_fields` allows `ordinal`, `code` and
 * `citation_count`, and there is no ordering here that is right in both cases:
 *
 *   * With one corpus chosen the rows are one document, so `ordinal` — which is
 *     that document's own order of articles — is the only correct sort. It is
 *     not `code`: 《太微仙君功過格》's codes are `CN-GGG-{門}-{門內序號}`, and the
 *     門 segments sort alphabetically (F-FX, F-JD, F-JJ, F-YS…) while the text's
 *     order is 救濟門, 教典門, 焚修門, 用事門, 不仁門… Sorting by code silently
 *     reprints the 功過格 with its gates shuffled.
 *   * With no corpus chosen the rows span up to six documents, and `ordinal`
 *     interleaves them: every corpus has an article 1, so page 1 would be six
 *     first articles, then six seconds. `code` is the only allowed field whose
 *     prefix (`CN-GGG`, `EG-NC`, `EU-DS`, `EU-INF`, `GR-ER`, `GR-GRG`) keeps a
 *     document's articles contiguous, which is what makes a page of twenty rows
 *     read as one or two rulebooks rather than a shuffled deck.
 *
 * Neither is a default that can be picked once, so it is picked from the
 * filter. The cost is stated rather than hidden: in the unfiltered view a
 * 功過格 page is in code order, gates out of the text's sequence — pick the
 * corpus and it comes back.
 */

/**
 * The six rulebooks, as a runtime list the corpus filter can render.
 *
 * Spelled as a `Record<StatuteCorpus, true>` rather than an array literal so
 * that `npx tsc --noEmit` fails on a member added to the union and not offered
 * here — an array typed `StatuteCorpus[]` catches a member that does not exist
 * but says nothing about one that is missing, and a filter silently short one
 * rulebook is a rulebook nobody can reach. The same caveat applies as in
 * `src/config/civilizationSigil.ts`: `isolatedModules` means ts-jest does not
 * type-check, so this is a `tsc` guard and the jest run proves nothing about it.
 *
 * HELL_LAW is listed even though the corpus is empty and stays empty. There is
 * no codified 冥律 to transcribe and the articles written against that shape
 * were withdrawn; selecting it lands on the empty state, which is the true
 * answer. Leaving it out of the filter would make the absence look like the
 * value never existed, when what happened is that it was retracted.
 */
const CORPUS_MEMBERS: Record<StatuteCorpus, true> = {
  GONGGUOGE: true,
  HELL_LAW: true,
  NEGATIVE_CONFESSION: true,
  DEADLY_SIN: true,
  INFERNO: true,
  GORGIAS: true,
  REPUBLIC_ER: true,
};

const CORPUS_OPTIONS = Object.keys(CORPUS_MEMBERS) as StatuteCorpus[];

/**
 * The parts of `payload_json` a sigil is built from, narrowed on the way out.
 *
 * `payload_json` is `Record<string, unknown>` on the wire and each corpus fills
 * a different subset, so every field is checked for its own type rather than
 * cast. A `stephanus` that arrived as a number is not a Stephanus page, and
 * handing it to the formatter would print a location that is not in Plato.
 */
function sigilRef(statute: Statute): StatuteRef {
  const payload = statute.payload_json ?? {};
  return {
    ordinal: statute.ordinal,
    division: typeof payload.gate === "string" ? payload.gate : undefined,
    // `gate_ordinal`, not `ordinal`: the 門 is a contiguous range of the
    // corpus-wide count, so `ordinal` beside a 門 name is a real-looking
    // citation that points nowhere. See StatuteRef.gateOrdinal.
    gateOrdinal:
      typeof payload.gate_ordinal === "number" ? payload.gate_ordinal : undefined,
    circle: typeof payload.circle === "number" ? payload.circle : undefined,
    stephanus: typeof payload.stephanus === "string" ? payload.stephanus : undefined,
  };
}

export default function CorpusPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [civilization, setCivilization] = useState("");
  const [corpus, setCorpus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Same 300ms the souls list uses, so typing costs one request rather than one
  // per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params: Record<string, string> = {
    page: String(page),
    // See the ordering note in the file header.
    ordering: corpus ? "ordinal" : "code",
  };
  if (civilization) params.civilization = civilization;
  if (corpus) params.corpus = corpus;
  if (search) params.search = search;

  const { data, isLoading, isError, refetch } = useStatutes(params);

  const statutes = data?.results ?? [];
  const groups = groupStatutesByCorpus(statutes);
  const total = data?.count ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 0;

  return (
    <PageShell
      /* `full`, not `page`: four columns of which one is a body column of even
         measure, beside a 2-up grid. Clamped to 1200 the two article columns
         fall to ~560px each and the serif body wraps every five or six words,
         which is the one thing a statute column must not do. */
      variant="full"
      title={t("judgment.corpus.title")}
      // The count comes from the response, not from the translation. All
      // three bundles said 175 while the real figure is 172 -- and the file
      // header of this very page had already been corrected to 172, so the
      // comment was right and the words on screen were wrong, one file apart.
      // Key parity across the bundles could not catch it: all three were
      // wrong together.
      subtitle={t("judgment.corpus.subtitle", { n: String(total) })}
      filters={
        /* Visible labels do not fit: the sticky slot is 32px of content height
           and a `Field`'s stacked label is taller than that. Each control
           carries an `aria-label` instead — a placeholder is not an accessible
           name and vanishes the moment the user types. Skin is `fieldControl`,
           the same one every form control in the app wears. */
        <>
          <input
            type="text"
            placeholder={t("search.placeholder")}
            aria-label={t("search.aria_label")}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[160px]")}
          />
          <select
            value={civilization}
            aria-label={t("judgment.civilization")}
            onChange={(event) => {
              setCivilization(event.target.value);
              setPage(1);
            }}
            className={cn(fieldControl({ size: "md" }), "w-auto shrink-0")}
          >
            <option value="">{t("filter.all")}</option>
            {CIVILIZATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`souls.civilizations.${option}`)}
              </option>
            ))}
          </select>
          <select
            value={corpus}
            aria-label={t("judgment.corpus.filter_corpus")}
            onChange={(event) => {
              setCorpus(event.target.value);
              setPage(1);
            }}
            className={cn(fieldControl({ size: "md" }), "w-auto shrink-0")}
          >
            <option value="">{t("filter.all")}</option>
            {CORPUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`judgment.statute_corpus.${option}`)}
              </option>
            ))}
          </select>
        </>
      }
      /* This page does not go through DataTable, so the slot is free — see
         PageShell's note on the two-pagination-bars trap. `<Pagination>` itself
         is deliberately NOT what goes in it: that component is one block with
         its own `justify-between mt-4 px-2`, and PageShell's slot already
         supplies the row, the 2px rule and the left/right split. Nesting it
         inside `controls` (a `shrink-0` right-hand cell) would collapse its own
         justify-between to nothing, print a second record count beside the one
         on the left, and hang a 16px top margin off a vertically centred row.
         So the count goes left as text and two plain buttons go right, which is
         the shape the slot was built for. */
      pagination={{
        count:
          total > 0 ? (
            <p className="text-02 font-mono tabular-nums text-ink-subtle">
              {t("pagination.info", {
                page: String(page),
                total: String(totalPages),
                count: String(total),
              })}
            </p>
          ) : null,
        controls: (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t("common.prev")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        ),
      }}
      isLoading={isLoading}
      skeleton={<PageSpinner />}
      isEmpty={!isError && groups.length === 0}
      empty={
        <EmptyState
          title={t("table.no_results")}
          reason={t("judgment.corpus.empty_reason")}
        />
      }
    >
      {isError ? (
        <EmptyState
          title={t("common.error")}
          reason={t("judgment.corpus.empty_reason")}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={() => refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        /* Two columns of cards, 40px apart in both axes and NO rule between
           them. That gap is load-bearing where a civilization has two corpora:
           the seven terraces and the nine circles sit side by side under two
           headings, and a divider drawn between them would read as a grouping
           line inside one table — the exact "these are one list with sections"
           claim that the two corpora exist to deny. Whitespace separates; a
           line joins. `items-start` so a 7-row card does not stretch to the
           height of a 26-row one and manufacture an alignment nobody meant. */
        <div data-corpus-grid="" className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          {groups.map((group) => (
            <CorpusCard
              key={group.key}
              group={group}
              // `data.count` is the count of the *filtered* query. It equals
              // this corpus's size only when the filter names one corpus;
              // otherwise it is every corpus added together and would be a
              // worse answer than "how many are listed".
              corpusTotal={corpus ? total : null}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function CorpusCard({
  group,
  corpusTotal,
}: {
  group: CorpusGroup;
  /** How many articles this corpus has in total, or null if unknown.
   *
   * Only the page component knows: it is `data.count` from the response, and
   * it only means "this corpus" when the list is filtered to one corpus. With
   * no filter the response counts every corpus together, so there is no
   * honest per-corpus figure on this page and the card says how many are
   * listed instead. */
  corpusTotal: number | null;
}) {
  const { t } = useI18n();

  /**
   * An unrecognised civilization is a data condition, not a programming error.
   * `formatSigil` and `civilizationNamesOffences` both throw for one, and that
   * is right at a call site holding a value it chose; this one reads whatever
   * the API sent. A fifth cosmology seeded before the frontend knows it would
   * take the whole page down through error.tsx, which is a worse answer than
   * showing its articles with no sigil.
   *
   * The offence column is KEPT in that case rather than dropped. Dropping a
   * column hides data; showing one the corpus does not fill costs a blank cell.
   * The conservative default belongs on the side that loses nothing.
   */
  const known = isCivilizationOption(group.civilization);
  const namesOffences = known ? civilizationNamesOffences(group.civilization) : true;

  return (
    <section
      data-corpus={group.corpus}
      data-civilization={group.civilization}
      data-names-offences={namesOffences ? "true" : "false"}
      /* `--civ-mark` is aliased by the `[data-civ="cn"|"eu"|"eg"|"gr"]` rules in
         globals.css, which TenantProvider normally stamps on <html>. Restamping
         it here re-points the alias for this subtree, so the rule takes the
         colour of the civilization whose corpus this is rather than the colour
         of whoever is logged in — the two differ as soon as anyone browses a
         corpus that is not their own. No `var(--civ-mark, …)` fallback: an
         unmapped civilization is meant to come out neutral grey, and grey says
         "no cosmology", which is true. */
      data-civ={CIVILIZATION_SHORT_CODES[group.civilization]}
      className="border-t-3 border-[hsl(var(--civ-mark))] pt-4"
    >
      <header className="flex items-baseline gap-3 mb-4">
        <h2 className="text-05 text-ink">
          <DomainEnum namespace="judgment.statute_corpus" value={group.corpus} />
        </h2>
        <p className="text-01 uppercase text-ink-subtle">
          <DomainEnum namespace="souls.civilizations" value={group.civilization} />
        </p>
        <p className="text-02 font-mono tabular-nums text-ink-subtle ml-auto">
          {/* `group.statutes` holds only the rows on *this page* (PAGE_SIZE
              20, both ends). Rendering that as "N articles" reported 功過格
              as 20 when it has 74, and split any corpus that straddles a page
              boundary into two groups each reporting a fraction. A number
              that looks entirely reasonable, about the wrong subject.

              Shown only when the list is filtered to a single corpus, where
              "how many are on screen" and "how big is this corpus" coincide
              -- and even then labelled as a count of what is listed. */}
          {corpusTotal !== null
            ? t("judgment.corpus.article_count", { n: String(corpusTotal) })
            : t("judgment.corpus.listed_count", {
                n: String(group.statutes.length),
              })}
        </p>
      </header>

      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {t("judgment.corpus.title")}
        </caption>
        {/* 88 / 180 / rest / 64. The offence column is absent for GREEK, so the
            Greek table is genuinely three columns wide — see the <th> note. */}
        <colgroup>
          <col className="w-[88px]" />
          {namesOffences ? <col className="w-[180px]" /> : null}
          <col />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-ink-subtle">
            <th
              scope="col"
              /* The numbering system's own name, for anyone wondering why the
                 column reads `§ 27 / 42` in one card and `614b` in the next.
                 Comes from the sigil table, so it cannot drift from the
                 formatter that produced the cells below it. */
              title={known ? sigilSystemName(group.civilization) : undefined}
              className="text-01 uppercase text-ink-subtle text-right pb-2 pr-2"
            >
              {t("judgment.corpus.col_sigil")}
            </th>
            {/* ONE COLUMN FEWER FOR GREECE, and not a column left blank.
                21 of the 23 Greek articles are PROCEDURE because
                neither Platonic myth contains a code of offences: the Gorgias
                and the Myth of Er say who judges, when, stripped of the body,
                and what follows — court rules, not charges. A blank 罪名 column
                would assert that Plato has offences and this deployment failed
                to transcribe them. The question is asked as
                `civilizationNamesOffences(civ)` rather than
                `civ === "GREEK"` so that a fifth cosmology which also names no
                offences gets the right table instead of the Greek accident. */}
            {namesOffences ? (
              <th scope="col" className="text-01 uppercase text-ink-subtle text-left pb-2 pr-3">
                {t("judgment.corpus.col_offence")}
              </th>
            ) : null}
            <th scope="col" className="text-01 uppercase text-ink-subtle text-left pb-2 pr-3">
              {t("judgment.corpus.col_text")}
            </th>
            <th scope="col" className="text-01 uppercase text-ink-subtle text-right pb-2">
              {t("judgment.corpus.col_citations")}
            </th>
          </tr>
        </thead>
        <tbody>
          {group.statutes.map((statute) => (
            <StatuteRow
              key={statute.id}
              statute={statute}
              civilizationIsKnown={known}
              namesOffences={namesOffences}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StatuteRow({
  statute,
  civilizationIsKnown,
  namesOffences,
}: {
  statute: Statute;
  civilizationIsKnown: boolean;
  namesOffences: boolean;
}) {
  const { t } = useI18n();

  /**
   * `null` here means "this article carries nothing this system can number
   * from" — a Greek article with no transcribed Stephanus page, a 功過格 ordinal
   * past the formatter's 99, an Egyptian ordinal outside the Forty-Two. It
   * never means "fall back to the ordinal": three of the four systems do not
   * number by ordinal at all, so `22` where `621b` belongs is a number in the
   * right place meaning nothing.
   */
  const sigil = civilizationIsKnown ? formatSigil(statute.civilization, sigilRef(statute)) : null;

  return (
    <tr className="border-b border-hairline last:border-b-0">
      <td className="text-02 font-mono text-right align-top py-3 pr-2 text-[hsl(var(--civ-ink))]">
        <DomainText
          value={sigil}
          missingKind="unrecorded"
          missingReason={t("judgment.corpus.sigil_absent")}
        />
      </td>
      {namesOffences ? (
        <td className="align-top py-3 pr-3">
          <p className="text-03 text-ink">{statute.display_title}</p>
          {/* Inside the offence column on purpose: the polarity says what KIND
              of naming this is — 功 or 過, a prohibition or a declaration of
              innocence — and a corpus that names no offences has no such kind
              to report. Putting it in its own column would hand Greece a column
              of "rule of the court" repeated twenty times. */}
          <p className="text-01 uppercase text-ink-subtle mt-1">
            <DomainEnum namespace="judgment.statute_polarity" value={statute.polarity} />
          </p>
        </td>
      ) : null}
      {/* The one thing kept from the manuscript reading. `display_text` and not
          `text_en`: the Egyptian Forty-Two are DERIVED — their `text_*` columns
          are empty by design and the body is read from the assessor's own
          record, so the resolved field is the only one with anything in it. */}
      <td className="font-serif text-05 text-ink align-top py-3 pr-3">
        <DomainText value={statute.display_text} missingKind="unrecorded" />
      </td>
      <td className="text-right align-top py-3">
        {/* Not `citation_count || 0`. Zero is a fact — this article exists and
            no verdict here has ever rested on it — and `null` is the absence of
            the annotation entirely. Printing 0 for the second would invent a
            reading of the tenant's own case history. <DomainNumber> prints the
            digit for one and a typed miss for the other. */}
        <DomainNumber
          value={statute.citation_count}
          missingKind="unrecorded"
          missingReason={t("judgment.corpus.citations_absent")}
        />
      </td>
    </tr>
  );
}
