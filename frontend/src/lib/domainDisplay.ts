/**
 * The display convention for domain enums, identifiers and missing values.
 * (docs/design-handoff/BRIEF.md §4.6 "Raw system values leak into the
 * interface".)
 *
 * This file is the single place the rules live. Everything below is pure —
 * no React, no DOM — so `src/__tests__/domainDisplayContract.test.tsx` can
 * assert on the rules directly, and `src/components/ui/DomainValue.tsx` is
 * the only module that turns them into pixels.
 *
 * ── The three missing semantics ────────────────────────────────────────────
 *
 * Before this file, "not recorded yet", "zero" and "not applicable" all
 * rendered as the same em dash, so a soul with no death date, a ledger that
 * genuinely balances to nothing, and a column that does not apply to that
 * civilization at all were indistinguishable. They are now three different
 * glyphs at three different ink levels:
 *
 *   unrecorded    "—"  ink-tertiary   the fact could exist; nothing written yet
 *   zero          "0"  ink-muted      a real recorded measurement that is zero
 *   inapplicable  "·"  ink-subtle     the field has no meaning for this row
 *
 * `zero` is deliberately NOT a placeholder: it renders the number. A zero is
 * data. The distinction that matters visually is "there is a digit here" vs
 * "there is no digit here", and then dash-vs-dot separates the two reasons
 * there is no digit. Each carries a translated `title` naming which one it is,
 * because a middle dot on its own is not self-explaining.
 *
 * ── Enums ─────────────────────────────────────────────────────────────────
 *
 * A raw enum key is never rendered. `resolveEnumDisplay` is the only way to
 * turn one into text; the raw key travels in `title` for triage, the same
 * arrangement the judgment queue uses.
 *
 * The trap this closes: `t()` in src/contexts/I18nContext.tsx returns the KEY
 * when a bundle has no entry for it, so `t(\`souls.states.${s}\`)` prints
 * "souls.states.ASCENDED" — worse than the raw enum, not better. So
 * `resolveEnumDisplay` compares the result against the key it asked for and
 * reports `unrecognized` rather than passing the key through.
 *
 * ── Identifiers ───────────────────────────────────────────────────────────
 *
 * See `IDENTIFIER_POLICY`. A UUID is shown in exactly one situation.
 */

// ---------------------------------------------------------------------------
// Missing values
// ---------------------------------------------------------------------------

/** The three reasons a cell has nothing to say. They are not interchangeable. */
export type MissingKind = "unrecorded" | "zero" | "inapplicable";

/**
 * The glyph each kind renders. `zero` has none — it renders the formatted
 * number, and appears here only so the map is total and the contract test can
 * assert all three are distinguishable without special-casing.
 */
export const MISSING_GLYPH: Record<MissingKind, string> = {
  unrecorded: "—", // em dash
  zero: "0",
  inapplicable: "·", // middle dot
};

/**
 * The ink token each kind renders at, dimmest last. Three distinct tokens: a
 * reader who cannot tell an em dash from a middle dot at 11px still gets a
 * weight difference. No fills, so the 0.1 badge-tint cap
 * (src/__tests__/dataGridToneContract.test.ts) is not in play here.
 */
export const MISSING_INK: Record<MissingKind, string> = {
  unrecorded: "text-[hsl(var(--color-ink-tertiary))]",
  zero: "text-[hsl(var(--color-ink-muted))]",
  inapplicable: "text-[hsl(var(--color-ink-subtle))]",
};

/** i18n key naming each kind, used as the `title` so the glyph is explainable. */
export const MISSING_LABEL_KEY: Record<MissingKind, string> = {
  unrecorded: "common.value.unrecorded",
  zero: "common.value.zero",
  inapplicable: "common.value.inapplicable",
};

/** Every i18n key this convention needs present in all three bundles. */
export const DOMAIN_DISPLAY_I18N_KEYS: readonly string[] = [
  ...Object.values(MISSING_LABEL_KEY),
  "common.value.unrecognized",
  "common.value.copy_id",
  "common.value.id_copied",
  "common.value.id_copy_failed",
  "common.value.copied",
];

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Minimal shape of `useI18n().t` — keeps this module free of React imports. */
export type Translate = (key: string, params?: Record<string, string>) => string;

export type EnumDisplay =
  /** Field was null/undefined/"" — nothing was recorded, so it is `unrecorded`. */
  | { state: "missing"; raw: null; label: null }
  /** Bundle had an entry. `label` is translated copy; `raw` is for `title`. */
  | { state: "known"; raw: string; label: string }
  /**
   * Backend sent a value the bundles do not cover — a new enum member, or a
   * tenant misconfiguration. Shows translated "unrecognized" copy, never the
   * key, with the raw value in `title` so it is still diagnosable.
   */
  | { state: "unrecognized"; raw: string; label: string };

/**
 * The only sanctioned path from a domain enum to text.
 *
 * @param namespace dotted bundle path, e.g. `"souls.states"`.
 * @param raw the value straight off the API.
 */
export function resolveEnumDisplay(
  t: Translate,
  namespace: string,
  raw: string | null | undefined
): EnumDisplay {
  if (raw === null || raw === undefined || raw === "") {
    return { state: "missing", raw: null, label: null };
  }
  // The bundles are not consistent about case — `souls.states` is keyed
  // ALIVE/JUDGING while `workflow.node_type` is keyed trial/evaluation. That
  // inconsistency is why two screens grew private Record<string, string> maps
  // just to bridge an enum member to its key. Trying the member as written,
  // then folded both ways, retires those maps here instead of in each caller.
  for (const candidate of [raw, raw.toLowerCase(), raw.toUpperCase()]) {
    const key = `${namespace}.${candidate}`;
    const translated = t(key);
    // t() echoes the key back on a miss (I18nContext), so an untranslated
    // enum would otherwise leak a dotted path into the UI.
    if (translated !== key && translated !== "") {
      return { state: "known", raw, label: translated };
    }
  }
  return { state: "unrecognized", raw, label: t("common.value.unrecognized") };
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * When is a UUID ever shown? Only under all four of these at once:
 *
 *   1. It is the identifier of the entity the page is *about* — a detail page,
 *      never a list row, never a nested reference.
 *   2. At most once per page, in the header sub-line, after the human name.
 *   3. It is copyable: truncated for reading, full value on the clipboard and
 *      in `title`. A UUID nobody can paste is decoration.
 *   4. It never substitutes for a name. A missing name is `unrecorded`, not
 *      the row's primary key.
 *
 * Everything else — breadcrumbs, table cells, body copy, empty states — shows
 * the name, and shows `unrecorded` when there is no name. React keys and URL
 * segments are not display and are unaffected.
 */
export const IDENTIFIER_POLICY = "detail-page header, copyable, once, never as a name" as const;

/** Characters of a UUID shown before the copy affordance. */
export const IDENTIFIER_SHORT_LENGTH = 8;

/** Reading form of an opaque id. The full value still goes to `title`/clipboard. */
export function shortIdentifier(id: string): string {
  return id.length > IDENTIFIER_SHORT_LENGTH ? id.slice(0, IDENTIFIER_SHORT_LENGTH) : id;
}

/**
 * True for values that carry no meaning to a reader — UUIDs and bare numeric
 * primary keys. Used to keep such values out of anywhere the policy above
 * does not sanction.
 */
export function isOpaqueIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^\d+$/.test(value);
}

// ---------------------------------------------------------------------------
// Columns that earn no space
// ---------------------------------------------------------------------------

/**
 * BRIEF §4.6's closing complaint: 03-souls-list carries a 死亡时间 column that
 * is `—` on every row and a 业力 column that is `+0` on every row — "columns
 * earning no space".
 *
 * The rule adopted: a column whose every row on the current page renders a
 * missing value is dropped for that page, header and all. Not greyed, not
 * collapsed to a sliver — removed, and restored the moment one row has a
 * value. Hiding beats merging because the column is legitimate; it just has
 * nothing to say about *these* rows, and the next page may differ.
 *
 * A column of real zeros is NOT uninformative — `+0` was noise because the
 * sign was fabricated, not because zero is meaningless. `signedNumber` fixes
 * the sign; this function is only about genuinely absent values.
 *
 * Returns false for an empty page: with no rows there is nothing to conclude,
 * and the table's own empty state already handles it.
 */
export function isColumnUninformative<T>(rows: readonly T[], hasValue: (row: T) => boolean): boolean {
  return rows.length > 0 && !rows.some(hasValue);
}

/** `hasValue` for the common case of "any non-empty scalar". */
export function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

// ---------------------------------------------------------------------------
// Signed numbers
// ---------------------------------------------------------------------------

/**
 * `+0` is a lie: zero has no sign, and printing one implies a positive
 * balance the ledger does not have. A sign is only ever attached to a value
 * that has one.
 */
export function signedNumber(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`; // U+2212 minus, not a hyphen
  return "0";
}

/** Ink for a signed number. Zero is neutral — it is neither good news nor bad. */
export function signedTone(n: number): "success" | "error" | "neutral" {
  if (n > 0) return "success";
  if (n < 0) return "error";
  return "neutral";
}
