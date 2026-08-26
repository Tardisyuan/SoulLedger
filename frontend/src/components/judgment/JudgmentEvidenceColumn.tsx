"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { JudgmentSectionHead } from "@/src/components/judgment/JudgmentGroundsPanel";
import { toHanNumeral } from "@/src/config/civilizationSigil";

/**
 * 事实 —— the facts column of a judgment.
 *
 * WHAT IT REPLACES. `app/judgment/[id]/page.tsx` rendered the whole of
 * `evidence_json` as `JSON.stringify(…, null, 2)` inside a `<pre>` and called
 * that the evidence section. A fact in a judgment is a numbered sentence with
 * a pointer to where it came from, not a serialisation of the record that
 * happens to contain it — and a reader who has to parse braces to find out
 * what the court considered is being shown the storage format instead of the
 * finding.
 *
 * So each entry becomes one numbered line: the value as prose, the key as the
 * source pointer beneath it. The raw document is not deleted — it moves one
 * disclosure away, for the person diagnosing a payload rather than reading a
 * judgment.
 *
 * WHAT IS NOT FLATTENED. A value that is genuinely not a sentence — a nested
 * object, an array — is shown compacted in mono rather than turned into
 * English the record does not support. Inventing "3 witnesses were heard" out
 * of `{"witnesses": 3}` would read better and assert more than the payload
 * says. An empty or absent value is a typed miss, never a blank line.
 *
 * WHY IT LIVES HERE and not in the page: the page is at the repo's 500-line
 * ceiling, and this column is separable in the same way `JudgmentGroundsPanel`
 * is — a section of the document with its own rules about what it may claim.
 */

/** One entry's value, rendered as what it actually is. */
function EvidenceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <MissingValue kind="unrecorded" />;
  }
  if (typeof value === "string") return <>{value}</>;
  if (typeof value === "number" || typeof value === "boolean") return <>{String(value)}</>;
  return <span className="font-mono text-02">{JSON.stringify(value)}</span>;
}

export function JudgmentEvidenceColumn({ evidence }: { evidence: Record<string, unknown> }) {
  const { t } = useI18n();
  const entries = Object.entries(evidence ?? {});

  return (
    <section className="min-w-0">
      <JudgmentSectionHead
        title={t("judgment.detail.evidence")}
        meta={entries.length > 0 ? String(entries.length) : undefined}
      />

      {entries.length === 0 ? (
        <p className="text-04 text-ink-subtle py-6">{t("judgment.no_evidence")}</p>
      ) : (
        <>
          <ol className="mt-4 divide-y divide-hairline">
            {entries.map(([key, value], index) => (
              <li key={key} className="grid grid-cols-[44px_1fr] gap-3 py-3">
                {/* Han numerals, the same numbering the main clauses carry, so
                    the two numbered lists on this page read as one document. */}
                <span className="font-mono tabular-nums text-02 text-ink-tertiary">
                  {toHanNumeral(index + 1) ?? String(index + 1)}
                </span>
                <span className="min-w-0">
                  <span className="text-04 text-ink block break-words">
                    <EvidenceValue value={value} />
                  </span>
                  {/* The source pointer: which key of the record this line is. */}
                  <span className="font-mono text-02 text-ink-subtle block mt-1 break-words">
                    {key}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <details className="mt-4">
            <summary className="text-02 text-ink-muted cursor-pointer hover:text-ink">
              {t("judgment.view")}
            </summary>
            <pre className="mt-2 bg-surface-2 p-3 font-mono text-02 text-ink overflow-auto max-h-64">
              {JSON.stringify(evidence, null, 2)}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
