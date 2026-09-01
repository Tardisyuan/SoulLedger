"use client";

import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/src/components/ui/Badge";
import { DomainEnum, DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { useI18n } from "@/src/contexts/I18nContext";
import {
  CIVILIZATION_SIGILS,
  formatSigil,
  sigilSystemName,
  type StatuteRef,
} from "@/src/config/civilizationSigil";
import type { JudgmentCitation, Statute, StatutePolarity } from "@/lib/api";

/**
 * 附引条文 —— the articles a verdict rests on.
 *
 * Why this is a panel and not a line of text: the whole claim of the feature
 * is that a decided case can say *why*, and "why" is an article — a code, a
 * body, and where that body came from. A comma-separated list of titles would
 * make the citation decorative, which is the failure mode of every "reason"
 * field that ends up holding "see notes".
 *
 * ── THREE COLUMNS: 96px 节号 | 条文正文 | 160px 出处 ────────────────────────
 *
 * The sigil column is the reason this panel is the most civilization-specific
 * surface in the product, and it is why the layout gives it a fixed 96px slot
 * of its own instead of running the numbering inline with the title. A 功過格
 * article is cited as 救濟門 · 十七, an Inferno article as IX · XXVI, one of
 * the Forty-Two as § 27 / 42, and Plato by Stephanus page — four different
 * shapes, and the only way four different shapes read as one column is if they
 * are given one column. `formatSigil` builds all four; nothing here branches on
 * a civilization name, which is the whole point of that module living in
 * `src/config` rather than at four call sites.
 *
 * ── THREE THINGS THE RENDER MUST NOT SMOOTH OVER ──────────────────────────
 *
 *   * POLARITY. 功過相抵 is a rule of 冥律 — a cited 孝养父母 is credit, not an
 *     accusation, and the two must not read alike. Hence the tone split, and
 *     hence the badge rather than plain text.
 *   * DERIVATION. The Egyptian articles have no stored body; their text is
 *     read from the assessor's own record. `is_derived` is surfaced so a
 *     reader can tell a transcription from a reference, rather than being
 *     shown one thing that is silently two.
 *   * PROVENANCE AND ITS GAPS. `source` is always shown; `source_notes` carry
 *     the source's own caveats (docs/03 saying its Dante mapping is not
 *     one-to-one; docs/11's 十恶 table listing six). Dropping them would turn
 *     a documented uncertainty into an assertion.
 */

/**
 * Offence reads as a charge, merit as credit, denial as neither — a denial is
 * a claim the deceased makes, and Ma'at's scale is a threshold rather than an
 * accusation (see apps/ledger/readings.py).
 *
 * `error`/`success`/`info` all resolve to a 0.1-alpha fill in
 * `BADGE_TONE_CLASSES`, which is the cap src/__tests__/dataGridToneContract.ts
 * enforces; nothing here declares its own background.
 */
const POLARITY_TONE: Record<StatutePolarity, BadgeTone> = {
  OFFENCE: "error",
  MERIT: "success",
  DENIAL: "info",
  // Neither for the soul nor against it. A Greek article is usually a rule the
  // court is bound by — who judges, where, on what evidence, to what purpose —
  // so colouring it `error` would read as an accusation the article does not
  // make. `neutral` is the same tone the `?? "neutral"` fallback below gives an
  // unknown member, and that is deliberate rather than lazy: a rule of
  // procedure genuinely carries no charge, so the two cases look alike on
  // purpose. What distinguishes them is the LABEL, which resolves through
  // `judgment.statute_polarity` for a known member and reads "unrecognized"
  // for one no bundle knows.
  PROCEDURE: "neutral",
};

/**
 * The parts of `Statute` a sigil is built from, narrowed off the wire.
 *
 * `payload_json` is `Record<string, unknown>` and each corpus fills a different
 * subset of it, so every field is checked for its own type rather than cast.
 * A `circle` that arrived as the string `"9"` is not a circle number — handing
 * it to `formatSigil` would print `IX` off a value the backend never promised
 * was numeric, which is the shape of fabrication this whole panel exists
 * against. It becomes `undefined`, and the formatter renders the bare ordinal.
 *
 * The three payload keys are named in `StatuteRef`'s own doc comments:
 * `gate` → `division` (the 門 of a 功過格 article, already written in Chinese),
 * `circle` (Inferno, 1–9, absent on the seven terraces) and `stephanus`
 * (transcribed, never derived).
 */
function statuteRef(statute: Statute): StatuteRef {
  const payload: Record<string, unknown> = statute.payload_json ?? {};
  const gate = payload.gate;
  const gateOrdinal = payload.gate_ordinal;
  const circle = payload.circle;
  const stephanus = payload.stephanus;
  return {
    ordinal: typeof statute.ordinal === "number" ? statute.ordinal : undefined,
    division: typeof gate === "string" ? gate : undefined,
    gateOrdinal: typeof gateOrdinal === "number" ? gateOrdinal : undefined,
    circle: typeof circle === "number" ? circle : undefined,
    stephanus: typeof stephanus === "string" ? stephanus : undefined,
  };
}

/**
 * The heading rule every part of the judgment document uses — 主文, 事实, 理由,
 * 附引条文, 灵魂信息.
 *
 * `border-b-2 border-ink-subtle` is the section underline from
 * tailwind.config.js's four-step border ladder, and it is what carries
 * hierarchy on this page instead of a heavier heading weight.
 *
 * Exported from here rather than restated at each site: five sections across
 * three files spelling out the same class string is the copy-then-drift shape
 * this whole pass exists to end.
 */
export function JudgmentSectionHead({
  title,
  meta,
  id,
}: {
  title: ReactNode;
  /** Right-aligned count or figure. Mono + tabular, so columns of them line up. */
  meta?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b-2 border-ink-subtle pb-2">
      <h2 id={id} className="text-01 uppercase text-ink flex-1">
        {title}
      </h2>
      {meta ? (
        <span className="font-mono tabular-nums text-02 text-ink-subtle">{meta}</span>
      ) : null}
    </div>
  );
}

export function JudgmentGroundsPanel({ citations }: { citations: JudgmentCitation[] }) {
  const { t } = useI18n();

  return (
    <section className="mt-10">
      <JudgmentSectionHead
        title={t("judgment.grounds.title")}
        meta={
          citations.length > 0
            ? t("judgment.grounds.count", { n: String(citations.length) })
            : undefined
        }
      />

      {citations.length === 0 ? (
        <p className="text-04 text-ink-subtle py-6">
          {/* Not "no data": a verdict given without citing anything is a fact
              about that verdict, and saying so is the point of the panel. */}
          {t("judgment.grounds.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {citations.map((citation) => (
            <GroundRow key={citation.id} citation={citation} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GroundRow({ citation }: { citation: JudgmentCitation }) {
  const { t } = useI18n();
  const statute = citation.statute;

  /**
   * `formatSigil` THROWS for a civilization it has no numbering system for,
   * and that is correct for a programming error — but a statute's
   * `civilization` arrives as a wire string, and this union has drifted from
   * the backend before (see `StatuteCorpus`'s note in lib/api/judgment.ts,
   * where three declared members faced five real ones and the reader got a
   * badge saying "unrecognized"). A fifth civilization seeded server-side would
   * take the whole judgment page down rather than one row.
   *
   * So the miss is rendered instead of thrown — and rendered as a MISS, with
   * the em dash and the "not recorded" tooltip, not as a blank cell and never
   * as the ordinal. Three of the four systems do not number by ordinal at all,
   * so falling back to it would be a number in the right place meaning nothing.
   */
  const hasSystem = statute.civilization in CIVILIZATION_SIGILS;
  const sigil = hasSystem ? formatSigil(statute.civilization, statuteRef(statute)) : null;
  const system = hasSystem ? sigilSystemName(statute.civilization) : undefined;

  return (
    <li className="grid grid-cols-1 gap-2 py-4 md:grid-cols-[96px_1fr_160px] md:gap-6">
      {/* 节号 —— the article's number in its own civilization's system.
          `--civ-ink`, not `--civ-mark`: the sigil is glyphs, and the two
          aliases exist to keep that distinction (see globals.css). Both are
          the tenant's identity colour, stamped per [data-civ] on <html>, and
          both are NOT per-statute — a cross-civilization citation list marks
          every sigil in the viewing tenant's colour. That is what the token
          means, and the alternative — reading --color-civ-ink-{cn,eu,eg,gr}
          off the statute — is the four-way branch civilizationSigil.ts exists
          to prevent. */}
      <div className="min-w-0">
        <p
          className="font-mono tabular-nums text-03 text-[hsl(var(--civ-ink))]"
          title={system}
        >
          {sigil ?? <MissingValue kind="unrecorded" reason={system} />}
        </p>
        {/* The article code is a citation key, not an opaque identifier —
            "CN-HL-O01" is how a reader looks the article up, so it is content
            and IDENTIFIER_POLICY does not reach it. */}
        <p className="font-mono text-01 text-ink-tertiary mt-1">{statute.code}</p>
      </div>

      {/* 条文正文 */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-04 font-medium text-ink">{statute.display_title}</h3>
          <Badge tone={POLARITY_TONE[statute.polarity] ?? "neutral"}>
            <DomainEnum namespace="judgment.statute_polarity" value={statute.polarity} />
          </Badge>
          <Badge tone="neutral">
            <DomainEnum namespace="judgment.statute_corpus" value={statute.corpus} />
          </Badge>
        </div>

        {/* SERIF = WORDS SOMEONE SAID. An article is transcribed testimony from
            a document that exists — 《太微仙君功過格》, the Inferno, the Papyrus
            of Nebseni, the Gorgias — so it is set in the same serif the
            confession is, and not in the sans the court writes its own notes
            in. The rule is stated once, on the page, and this is its second
            landing site. */}
        <p className="font-serif text-05 text-ink mt-2">
          <DomainText value={statute.display_text} />
        </p>

        {citation.note && (
          <p className="text-03 text-ink-muted mt-2">
            {/* 适用理由 is the COURT's sentence about the article, not the
                article's own, so it stays sans. */}
            <span className="text-01 uppercase text-ink-subtle mr-2">
              {t("judgment.grounds.note")}
            </span>
            {citation.note}
          </p>
        )}
      </div>

      {/* 出处 */}
      <div className="min-w-0 text-02 text-ink-subtle">
        <p>
          <span className="text-01 uppercase text-ink-tertiary block">
            {statute.is_derived ? t("judgment.grounds.derived") : t("judgment.grounds.source")}
          </span>
          {statute.source}
        </p>
        {/* The caveat is prose, not a Latin title, so it separates from the
            source by ink and not by `italic` — this page reserves italic for
            what italic is for. */}
        {statute.source_notes?.map((note, index) => (
          <p key={index} className="text-ink-tertiary mt-2">
            {t("judgment.grounds.caveat")} {note}
          </p>
        ))}
      </div>
    </li>
  );
}
