"use client";

import type { LedgerReading } from "@/lib/api/ledger";
import { READING_QUANTITIES, type QuantityKind } from "@/lib/api/ledgerQuantities";
import { Figure } from "@/src/components/ledger/QuantityFigure";

type TFunc = (key: string, params?: Record<string, string>) => string;

// ── GREEK (千年轮回) — one rule, two roads, one clock nobody started ──
//
// A fork, not two stacked rows: the shared tenfold rule at the apex, the two
// counts diverging beneath it, and the shared circuit and the shared elapsed
// absence rejoining below. The lower half keeps GuiltAndPenaltyReading's
// grammar — a dashed rule, an em-dash where a number would go — because
// Europe's absence and Greece's are the same drawing problem and this
// repository has already argued it out once.
//
// Why a fork rather than the two rows this used to be. "The roads never
// combine" cannot survive as a sentence in a comment: two figures sitting one
// above the other in the same column invite the next reader to subtract them,
// and nothing in the layout resists it. A fork has nowhere to put the answer.
// There is no row spanning both roads inside `Fork` and no axis shared between
// them — the gutter is a column of its own and it is empty — so adding a
// derived figure means first inventing a slot for it, and inventing a slot is
// the kind of diff that gets noticed in review. That is the whole argument:
// the prohibition is enforced by the geometry, not by this paragraph.
//
// Neither road is coloured. The merit green and demerit red are the two halves
// of the BALANCE reading's subtraction — that palette *is* a net figure, so
// wearing it here would smuggle the netting back in through the colours after
// the layout had just been rebuilt to forbid it. Both counts are plain ink, and
// they are plain ink at identical weight and size: a road drawn louder than the
// other is a claim about which one matters that Republic X does not make. That
// applies to an empty road too — see `Fork` below.
//
// Road order follows the copy catalogue: owed, then requited.
//
// What is deliberately NOT here:
//   * anything derived from both roads. Not their difference (that is the
//     Chinese balance), not their sum, not a bar split between them. They are
//     parallel repayments over one circuit and the payload relates them by
//     nothing; a figure that relates them would be this panel's invention.
//   * `wrongs × repayment_multiple`, or the same for `benefactions`. Tenfold
//     repayment is the rule Republic X states, not a balance it computes;
//     printing "40" for four wrongs would read as "owes 40", a quantity no
//     source asserts and this system has no unit for. The counts and the rule
//     are shown as what they are and the reader holds them apart.
//   * a second multiple. 615b gives both roads *the same measure*, so the rule
//     is stated once, at the apex, above the point where the roads part. It
//     used to be interpolated into each road's caption, which drew one fact
//     twice and left the two copies free to drift.
//   * a progress bar or a percentage. The denominator is a term length nobody
//     has computed — `circuit_years` is the unit of repayment, not this soul's
//     term — and the prohibition survived `elapsed_years` becoming a real
//     number. It used to rest on both ends being missing; only one of them
//     ever was.
//   * `circuit_years` as a headline. 1000 is the length of one circuit — the
//     unit the repayment is reckoned in — and rendering it large next to the
//     word "sentence" would say this soul was sentenced to a thousand years.
//     It sits below the fork because it is the unit of both roads.
//   * an em-dash for an empty road. A road with no recorded deeds is 0, which
//     the ledger knows; the em-dash is reserved for an elapsed figure it does
//     not. Spending the glyph on both would flatten that distinction — and the
//     distinction is now load-bearing in both directions, because a term start
//     *can* be recorded and 0 years served is then a real answer sitting in the
//     same slot the glyph used to own unconditionally.
export function SentenceReading({
  reading,
  t,
}: {
  reading: Extract<LedgerReading, { kind: "SENTENCE" }>;
  t: TFunc;
}) {
  return (
    <div className="space-y-4">
      <Fork
        rule={t("souls.detail.reading.sentence_repayment_rule", {
          multiple: String(reading.repayment_multiple),
        })}
        t={t}
        owed={{
          label: t("souls.detail.reading.sentence_owed_label"),
          count: reading.wrongs,
          // Both roads are counts of deeds — Republic X counts wrongs done, not
          // this system's severity weights — so neither carries the weight
          // scale marker and the two stay identically drawn.
          quantity: READING_QUANTITIES.SENTENCE.wrongs,
          detail: t("souls.detail.reading.sentence_owed_detail"),
        }}
        requited={{
          label: t("souls.detail.reading.sentence_requited_label"),
          count: reading.benefactions,
          quantity: READING_QUANTITIES.SENTENCE.benefactions,
          detail: t("souls.detail.reading.sentence_requited_detail"),
        }}
      />

      {/* Below the fork, where the roads have rejoined, because the circuit is
          the unit of both and 615b gives them one. Prose, and outside `Fork`:
          the fork's own subtree holds the apex and the two columns and nothing
          else, which is what keeps a derived figure homeless. */}
      <p className="text-[11px] text-[hsl(var(--color-ink-subtle))]">
        {t("souls.detail.reading.sentence_circuit", { years: String(reading.circuit_years) })}
      </p>

      {/* Same dashed rule, em-dash and absent shared axis as poena *when the
          figure is absent*, and for the same reason: time served is not zero,
          it is unknown. A 0 there would be a claim that the term has not begun,
          which is a fact about a sentence and not one this ledger held. One row
          for both roads: they leave the same judgment and return to the same
          meadow, so there is one elapsed figure.

          The branch is new and the defect it closes is a real one, not a
          hypothetical. `elapsed_years` was typed `null` and this slot drew the
          em-dash unconditionally — it never asked. The moment the backend could
          send a number (Disposition.term_start), an unchanged panel would have
          gone on drawing "—" over a figure it had been given: an absence
          rendered on top of a fact, which is worse than either the old honest
          blank or the new number.

          The condition is `!== null`, not truthiness. 0 is a real answer here
          now — a term that began this year has served no years of it — and
          `elapsed_years && ...` would have redrawn the em-dash over it, which
          is the same defect wearing a shorter operator.

          What is deliberately still NOT here: a progress bar, a percentage, a
          remainder. The denominator would be a term length nobody computes;
          `circuit_years` is the unit of repayment and not this soul's term, and
          dividing by it would state a fraction Republic X does not. And no
          colour on either path — the two roads are plain ink and so is their
          clock. */}
      <div className="border-t border-dashed border-[hsl(var(--color-hairline))] pt-3">
        <div className="flex justify-between items-center">
          <span className="text-04 text-[hsl(var(--color-ink-muted))]">
            {t("souls.detail.reading.sentence_elapsed_label")}
          </span>
          {reading.elapsed_years !== null ? (
            /* Not aria-hidden, unlike the em-dash: this one is the value.
               Carried through a copy key rather than printed bare, because
               "2424" under a label reading 已服 states no unit — and the unit
               is the one thing a term of years is measured in.

               A duration, and therefore no weight-scale marker: the unit is
               already inside the value, and appending the severity scale to it
               would say the years were measured in weight. That is the same
               category error as the counts, arriving from the other side. */
            <Figure
              field="elapsed_years"
              quantity={READING_QUANTITIES.SENTENCE.elapsed_years}
              t={t}
              className="text-06 tabular-nums text-[hsl(var(--color-ink))]"
            >
              {t("souls.detail.reading.sentence_elapsed_years", {
                years: String(reading.elapsed_years),
              })}
            </Figure>
          ) : (
            /* aria-hidden for the same reason as the poena slot above, and
               `data-quantity-absent` for a different reason than poena's: this
               one names the kind that belongs in the slot. A duration is what
               the ledger would hold if it held a start date, so the slot can
               say so; poena is a quantity this cosmology has no inputs for at
               all, and naming a kind there would invent one. */
            <span
              data-quantity-absent="elapsed_years"
              className="text-06 text-[hsl(var(--color-ink-subtle))]"
              aria-hidden="true"
            >
              —
            </span>
          )}
        </div>
        {reading.elapsed_years === null && (
          <>
            <p className="text-02 text-[hsl(var(--color-ink-subtle))] mt-1">
              {t("souls.detail.reading.elapsed_unavailable_heading")}
            </p>
            {/* One bullet per member the backend sent, key derived from the
                member, exactly as the poena list does it — including the
                failure mode: a member with no copy shows its raw key rather
                than vanishing. */}
            {reading.elapsed_missing.length > 0 && (
              <ul className="text-[11px] text-[hsl(var(--color-ink-subtle))] mt-2 space-y-0.5 list-disc list-inside">
                {reading.elapsed_missing.map((missing) => (
                  <li key={missing}>{t(`souls.detail.reading.elapsed_missing_${missing.toLowerCase()}`)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface RoadProps {
  label: string;
  count: number;
  /** Always `count` — declared rather than assumed, so the day a road stops
   *  being a tally of deeds the change has to be made here and is visible. */
  quantity: QuantityKind;
  detail: string;
}

/** The three columns every row of the fork is laid on. The middle one is the
 *  gutter — a real column with a width, not the boundary between two cells.
 *  That distinction is the whole reason the connector below can be drawn
 *  without putting a line in the gap between the two counts. */
const FORK_COLUMNS = "grid grid-cols-[1fr_10px_1fr]";

/** One hairline, in the one place hairlines are allowed inside the fork. */
const FORK_LINE = "absolute border-[hsl(var(--color-hairline))]";

// The fork itself: the rule that governs both roads, the join where they part,
// and the two roads.
//
// The connector is built from geometry rather than from cell borders, and that
// is a correction rather than a preference. Drawn the obvious way — a
// `border-right` on the left-hand cell — the line lands on the *boundary*
// between the two columns, which is to say in the gap between the two numbers,
// which is exactly the "these two combine" hint the rest of this file exists to
// refuse. So the gap is a column (`FORK_COLUMNS`), the crossbar is inset to the
// two outer columns' centres, and each drop line is centred inside its own
// column. Nothing is ever drawn on a column boundary, and nothing at all is
// drawn beside or between the counts: the connector sits in its own row, above
// them, and the gutter column of the roads row is empty.
//
// `data-fork` / `data-road` / `data-fork-gutter` are here for the tests, which
// assert the structure rather than the pixels — a screenshot cannot say "there
// is no place to put a derived number" but the DOM can.
function Fork({
  rule,
  owed,
  requited,
  t,
}: {
  rule: string;
  owed: RoadProps;
  requited: RoadProps;
  t: TFunc;
}) {
  return (
    <div data-fork="">
      {/* The apex. One rule, above the point where the roads part, because
          615b gives both roads the same measure and this panel states it once. */}
      <p
        data-fork-rule=""
        className="text-02 text-center text-[hsl(var(--color-ink-muted))]"
      >
        {rule}
      </p>

      {/* Geometry only, and therefore aria-hidden: everything it says is said
          in words by the apex above it and the two labels below it. */}
      <div data-fork-connector="" aria-hidden="true" className={`${FORK_COLUMNS} h-4`}>
        <div className="relative">
          <span className={`${FORK_LINE} left-1/2 right-0 top-1/2 border-t`} />
          <span className={`${FORK_LINE} left-1/2 top-1/2 bottom-0 border-l`} />
        </div>
        {/* The gutter, in the connector row only: the stem descending from the
            apex and the middle of the crossbar. Both are above the counts. */}
        <div className="relative">
          <span className={`${FORK_LINE} inset-x-0 top-1/2 border-t`} />
          <span className={`${FORK_LINE} left-1/2 top-0 h-1/2 border-l`} />
        </div>
        <div className="relative">
          <span className={`${FORK_LINE} left-0 right-1/2 top-1/2 border-t`} />
          <span className={`${FORK_LINE} left-1/2 top-1/2 bottom-0 border-l`} />
        </div>
      </div>

      {/* The two roads, and the empty gutter between them. Three cells, and
          there is no fourth: a difference, a sum or a ratio has no cell to sit
          in, and giving it one is a change to this grid that a reviewer sees. */}
      <div className={FORK_COLUMNS}>
        <Road road="owed" t={t} {...owed} />
        <div data-fork-gutter="" />
        <Road road="requited" t={t} {...requited} />
      </div>
    </div>
  );
}

// One road: a label, a count of deeds, and what the count counts.
//
// Extracted so the two roads cannot drift into two different treatments — the
// class strings below are literally the same string on both, which is what the
// tests compare. `count` is rendered as given, including 0.
//
// 0 gets no treatment of its own. An empty right-hand road is an *assessed*
// fact, not an unassessed one: counting MERIT records and counting DEMERIT
// records is the same operation on the same ledger, so "no benefactions" is
// something this system checked and found. Hiding the road would make the
// panel's shape depend on the data and leave a reader unable to tell "no good
// deeds" from "this build has no such field"; styling the zero — dimming it,
// greying it, marking it — would re-introduce a verdict through emphasis, which
// is the same mistake as colouring the roads and is refused for the same
// reason. So the structure is always drawn and the zero is drawn like any
// other number.
//
// The count is a `count`, and that is the half of the review's pair that needed
// no new copy: the caption directly beneath already names what is being counted
// (桩在案过错 / recorded wrongs), so the road says what it is without borrowing
// the weight scale culpa now carries. Both roads pass the same kind through, so
// the two remain literally the same class string — which is what the tests
// compare, and what a marker on one road alone would break.
function Road({ road, label, count, quantity, detail, t }: RoadProps & { road: string; t: TFunc }) {
  return (
    <div data-road={road} className="flex flex-col items-center text-center">
      <span className="text-04 text-[hsl(var(--color-ink-muted))]">{label}</span>
      <Figure
        field={road === "owed" ? "wrongs" : "benefactions"}
        quantity={quantity}
        t={t}
        numeralProps={{ "data-road-count": road }}
        className="text-06 tabular-nums text-[hsl(var(--color-ink))]"
      >
        {count}
      </Figure>
      <span className="text-02 text-[hsl(var(--color-ink-subtle))] mt-0.5">{detail}</span>
    </div>
  );
}
