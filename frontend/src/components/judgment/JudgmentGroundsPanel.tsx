"use client";

import { EnumBadge, type EnumTone } from "@/components/ui/data-grid";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { useI18n } from "@/src/contexts/I18nContext";
import type { JudgmentCitation, StatutePolarity } from "@/lib/api";

/**
 * The articles a verdict rests on.
 *
 * Why this is a panel and not a line of text: the whole claim of the feature
 * is that a decided case can say *why*, and "why" is an article — a code, a
 * body, and where that body came from. A comma-separated list of titles would
 * make the citation decorative, which is the failure mode of every "reason"
 * field that ends up holding "see notes".
 *
 * Three things the render must not smooth over, all of them the same
 * not-fabricating discipline the seed data holds:
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
 * ENUM_TONE_CLASSES, which is the cap src/__tests__/dataGridToneContract.ts
 * enforces; nothing here declares its own background.
 */
const POLARITY_TONE: Record<StatutePolarity, EnumTone> = {
  OFFENCE: "error",
  MERIT: "success",
  DENIAL: "info",
};

export function JudgmentGroundsPanel({ citations }: { citations: JudgmentCitation[] }) {
  const { t } = useI18n();

  return (
    <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
      <div className="px-5 py-3 border-b border-[hsl(var(--color-hairline))] flex items-center gap-3">
        <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase flex-1">
          {t("judgment.grounds.title")}
        </h2>
        {citations.length > 0 && (
          <span className="font-mono tabular-nums text-xs text-[hsl(var(--color-ink-subtle))]">
            {t("judgment.grounds.count", { n: String(citations.length) })}
          </span>
        )}
      </div>

      {citations.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[hsl(var(--color-ink-subtle))]">
          {/* Not "no data": a verdict given without citing anything is a fact
              about that verdict, and saying so is the point of the panel. */}
          {t("judgment.grounds.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--color-hairline))]">
          {citations.map((citation) => (
            <GroundRow key={citation.id} citation={citation} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroundRow({ citation }: { citation: JudgmentCitation }) {
  const { t } = useI18n();
  const statute = citation.statute;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        {/* The article code is a citation key, not an opaque identifier —
            "CN-HL-O01" is how a reader looks the article up, so it is content
            and IDENTIFIER_POLICY does not reach it. */}
        <span className="font-mono text-xs text-[hsl(var(--color-ink-subtle))]">
          {statute.code}
        </span>
        <span className="text-sm font-semibold text-[hsl(var(--color-ink))]">
          {statute.display_title}
        </span>
        <EnumBadge
          value={{
            tone: POLARITY_TONE[statute.polarity] ?? "neutral",
            label: <DomainEnum namespace="judgment.statute_polarity" value={statute.polarity} />,
          }}
        />
        <EnumBadge
          value={{
            tone: "neutral",
            label: <DomainEnum namespace="judgment.statute_corpus" value={statute.corpus} />,
          }}
        />
      </div>

      <p className="text-sm text-[hsl(var(--color-ink))] leading-relaxed">
        <DomainText value={statute.display_text} />
      </p>

      {citation.note && (
        <p className="mt-2 text-sm text-[hsl(var(--color-ink-muted))]">
          <span className="text-xs uppercase tracking-wide text-[hsl(var(--color-ink-subtle))] mr-2">
            {t("judgment.grounds.note")}
          </span>
          {citation.note}
        </p>
      )}

      <div className="mt-2 space-y-1 text-xs text-[hsl(var(--color-ink-subtle))]">
        <p>
          <span className="mr-2">
            {statute.is_derived ? t("judgment.grounds.derived") : t("judgment.grounds.source")}
          </span>
          {statute.source}
        </p>
        {statute.source_notes?.map((note, index) => (
          <p key={index} className="italic">
            {t("judgment.grounds.caveat")} {note}
          </p>
        ))}
      </div>
    </li>
  );
}
