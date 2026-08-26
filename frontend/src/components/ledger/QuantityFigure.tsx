"use client";

import type { ReactNode } from "react";

import type { QuantityKind } from "@/lib/api/ledgerQuantities";

type TFunc = (key: string, params?: Record<string, string>) => string;

// ── One number, drawn as the kind of quantity it is ─────────────────────
//
// The defect this exists for: European `culpa` and a Greek road's count were
// both `text-xl font-bold`, so 22 and 4 sat side by side and read as two values
// of one quantity — "this soul is worse". 22 is a sum of `SoulRecord.weight`
// and 4 is a tally of ledger rows. Nothing relates them, and a cross-tenant
// listing will sort them into one column anyway.
//
// `3fdbbba` left the two class strings no longer identical, but only because
// the Greek fork had just been told to stop using the merit/demerit palette.
// A distinction arrived at as a side effect can be lost as a side effect, so
// the kind is now declared — `data-quantity` — rather than inferred from
// whatever styling a panel happens to have.
//
// WHY THIS LIVES HERE AND NOT IN `SoulReadingPanel`. It started there, as a
// local helper for the four cosmology panels, because the design review named
// those four. The numbers directly *underneath* those panels — the raw/decayed
// breakdown in `SoulKarmaLedgerCard`, and the same three sums again in the
// judgment queue's triage card — are the same weight sums with the same defect,
// and they were left bare. Adjacent is the worst place to be inconsistent: a
// marked figure above an unmarked one does not read as "one of these names its
// scale", it reads as "these are different quantities". A copy of this markup
// in each caller would have been three copies free to drift into three
// treatments, which is the failure this component was extracted from.
//
// WHY THE MARKER IS A SCALE AND NOT A UNIT. Three of the four kinds already
// say what they are inside the value or the caption next to it: a duration is
// "{{years}} 年", a ratio ends in "×", a count has its noun ("5 项记录",
// "桩在案过错"). Only magnitudes are mute, and they are mute because there is
// no honest unit to print. `SoulRecord.weight` calls itself "Significance
// weight (1-100)" — a scale this system invented. 分 is the 功過格's own unit
// and borrowing it for Purgatorio or the Hall of Two Truths would be the
// netting mistake in different clothes; "points" would sound like a score.
// So the marker names the scale rather than claiming a unit, and it is the one
// piece of copy on the panel whose job is to say "this number is not a tally".
//
// The copy key is `ledger.figure_scale_weight`, not the
// `souls.detail.reading.figure_scale_weight` it was born as. The scale is a
// fact about `SoulRecord.weight`, not about the reading panel, and it is now
// read by the judgment queue too — a key under `souls.detail.reading` would
// have told a translator that editing it could only affect one panel on one
// page, which stopped being true.
//
// The marker is NOT `aria-hidden`, unlike the em-dashes the panels draw in an
// empty figure's slot. Those are hidden because the sentence under them says
// the same thing; nothing else says what a weight sum is measured on, so hiding
// the marker would hand a screen reader the bare "22" this was fixed for.
export function Figure({
  field,
  quantity,
  className,
  numeralProps,
  children,
  t,
}: {
  /** The payload field this figure shows, or a name for a derived one. */
  field: string;
  quantity: QuantityKind;
  className: string;
  /** Extra attributes for the numeral itself — `Road` keeps its own
   *  `data-road-count` hook on the styled element rather than on a wrapper, so
   *  the fork's "both roads are drawn identically" assertions go on comparing
   *  the classes that actually draw them. */
  numeralProps?: Record<string, string>;
  children: ReactNode;
  t: TFunc;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      {/* The numeral, and nothing but the numeral: `data-quantity` elements are
          compared by text in the contract tests, and a marker inside this span
          would make a magnitude's text differ from the number it prints. */}
      <span {...numeralProps} data-quantity={quantity} data-quantity-field={field} className={className}>
        {children}
      </span>
      {quantity === "magnitude" && (
        <span
          data-quantity-scale={field}
          className="text-02 font-normal text-[hsl(var(--color-ink-subtle))]"
        >
          {t("ledger.figure_scale_weight")}
        </span>
      )}
    </span>
  );
}
