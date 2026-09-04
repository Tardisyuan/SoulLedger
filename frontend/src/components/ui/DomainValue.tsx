"use client";

/**
 * The rendering half of the display convention in src/lib/domainDisplay.ts.
 * (docs/design-handoff/BRIEF.md §4.6.)
 *
 * Every screen that shows a domain enum, an opaque identifier, or a value it
 * does not have goes through one of these four components. The point is the
 * single choke point, not the components themselves: the repo's recurring
 * failure mode is the same idiom pasted into twenty files and then drifting,
 * which is why `t(\`souls.states.${x}\`)` was right on /souls and raw
 * `{tmpl.civilization}` on /workflow.
 *
 * `src/__tests__/domainDisplayContract.test.tsx` scans the source tree and
 * fails when a new copy appears.
 */

import { useCallback, useState, type ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import {
  MISSING_GLYPH,
  MISSING_INK,
  MISSING_LABEL_KEY,
  resolveEnumDisplay,
  shortIdentifier,
  signedNumber,
  signedTone,
  type MissingKind,
} from "@/src/lib/domainDisplay";

// ---------------------------------------------------------------------------
// Missing values
// ---------------------------------------------------------------------------

export interface MissingValueProps {
  kind: Exclude<MissingKind, "zero">;
  /**
   * Extra context for the tooltip, e.g. "balance does not apply to Egyptian
   * souls". Appended after the kind's own name.
   */
  reason?: string;
  className?: string;
}

/**
 * "Not recorded yet" or "not applicable" — never both spelled the same way.
 * A recorded zero is not a missing value and does not come through here; use
 * `<DomainNumber>`, which prints the digit.
 */
export function MissingValue({ kind, reason, className }: MissingValueProps) {
  const { t } = useI18n();
  const name = t(MISSING_LABEL_KEY[kind]);
  // THE REASON GOES IN THE ACCESSIBLE NAME, not only in `title`.
  //
  // It used to be `title={name — reason}` beside `aria-label={name}`, so the
  // reason — "balance does not apply to Egyptian souls", the sentence that
  // explains WHY the cell is a dash — reached neither a screen reader nor a
  // touch device. `title` is mouse-hover only. 26 call sites pass a `reason`,
  // and on every one of them the explanation was the one thing an operator
  // without a mouse could not get.
  //
  // `title` stays, and stays with the same string: it is still the fastest way
  // for a sighted mouse user to check a dash, and dropping it would be trading
  // one audience for another. The fix is that the two attributes now say the
  // same thing instead of the accessible one saying less.
  //
  // mobile-chrome is one of this repo's three playwright projects
  // (`playwright.config.ts:53`), so "touch" is not a hypothetical audience.
  const full = reason ? `${name} — ${reason}` : name;
  return (
    <span
      title={full}
      aria-label={full}
      className={`${MISSING_INK[kind]}${className ? ` ${className}` : ""}`}
      data-missing={kind}
    >
      {MISSING_GLYPH[kind]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export interface DomainEnumProps {
  /** Dotted bundle path, e.g. `"souls.states"`. */
  namespace: string;
  value: string | null | undefined;
  /** How an absent value reads. Defaults to "nothing was recorded". */
  missingKind?: Exclude<MissingKind, "zero">;
  /** Context appended to the missing-value tooltip. */
  missingReason?: string;
  className?: string;
}

/**
 * A translated domain enum. The raw key goes to `title` for triage and never
 * to the text node — that is exactly the `ALIVE — 存活` defect §4.6 names.
 */
export function DomainEnum({ namespace, value, missingKind = "unrecorded", missingReason, className }: DomainEnumProps) {
  const { t } = useI18n();
  const resolved = resolveEnumDisplay(t, namespace, value);

  if (resolved.state === "missing") {
    return <MissingValue kind={missingKind} reason={missingReason} className={className} />;
  }
  return (
    <span
      title={resolved.raw}
      className={
        resolved.state === "unrecognized"
          ? `italic text-[hsl(var(--color-ink-subtle))]${className ? ` ${className}` : ""}`
          : className
      }
      data-enum-state={resolved.state}
    >
      {resolved.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_TONE_INK: Record<"success" | "error" | "neutral", string> = {
  success: "text-[hsl(var(--color-status-success))]",
  error: "text-[hsl(var(--color-status-error))]",
  neutral: MISSING_INK.zero,
};

export interface DomainNumberProps {
  value: number | null | undefined;
  /** Prefix a sign on non-zero values. Zero is never signed. */
  signed?: boolean;
  /** Colour by sign. Off for counts and other quantities with no valence. */
  toned?: boolean;
  missingKind?: Exclude<MissingKind, "zero">;
  missingReason?: string;
  className?: string;
}

/**
 * A number, or the reason there isn't one. Zero prints as `0` in neutral ink,
 * never as `+0` and never as a dash: §4.6's 业力 column was `+0` on every row,
 * which read as a fabricated positive balance rather than an empty ledger.
 */
export function DomainNumber({
  value,
  signed = false,
  toned = false,
  missingKind = "unrecorded",
  missingReason,
  className,
}: DomainNumberProps) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span className={`font-mono tabular-nums${className ? ` ${className}` : ""}`}>
        <MissingValue kind={missingKind} reason={missingReason} />
      </span>
    );
  }
  const tone = toned ? signedTone(value) : "neutral";
  return (
    <span
      className={`font-mono tabular-nums ${NUMBER_TONE_INK[tone]}${className ? ` ${className}` : ""}`}
      data-zero={value === 0 ? "true" : undefined}
    >
      {signed ? signedNumber(value) : String(value)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export interface IdentifierChipProps {
  id: string;
  /** Accessible name for the copy button, e.g. "Copy soul ID". */
  ariaLabel?: string;
  /**
   * `chip` — a bordered pill. Correct where the policy's normal case puts it:
   * one id, alone in a detail-page header, where the chrome is what says
   * "this is a thing you can take with you".
   *
   * `inline` — same button, same clipboard behaviour, no chrome: monospace at
   * the surrounding text size, sigil instead of a border. For a registered
   * `IDENTIFIER_POLICY_EXCEPTIONS` site, where the affordance repeats once per
   * row; ten pills down a metadata column would out-shout the rows they
   * annotate and read as the page's main content, which is exactly the
   * "raw system values leak into the interface" complaint the policy answers.
   */
  variant?: "chip" | "inline";
}

const IDENTIFIER_VARIANT_CLASSES: Record<"chip" | "inline", string> = {
  chip:
    "font-mono text-02 px-1.5 py-0.5 bg-[hsl(var(--color-surface-2))] " +
    "border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-3))] " +
    "text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors",
  // No fill at all, so nothing here can approach the 0.1 badge-tint cap
  // (src/__tests__/dataGridToneContract.test.ts). The dotted underline is the
  // only affordance, and it only firms up on hover/focus.
  inline:
    "font-mono text-inherit underline decoration-dotted decoration-[hsl(var(--color-hairline))] " +
    "underline-offset-2 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] " +
    "hover:decoration-[hsl(var(--color-ink-muted))] transition-colors",
};

/**
 * The one sanctioned way a UUID reaches a reader — see `IDENTIFIER_POLICY` in
 * src/lib/domainDisplay.ts. Reads short, copies whole; a truncated,
 * unselectable id is useless to anyone pasting it into a ticket or a query.
 */
export function IdentifierChip({ id, ariaLabel, variant = "chip" }: IdentifierChipProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      showToast(t("common.value.id_copied"), "success");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast(t("common.value.id_copy_failed"), "error");
    }
  }, [id, showToast, t]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={id}
      aria-label={ariaLabel ?? t("common.value.copy_id")}
      className={IDENTIFIER_VARIANT_CLASSES[variant]}
      data-identifier-variant={variant}
    >
      {copied
        ? t("common.value.copied")
        : // The `#` sigil does the work the border does in the chip variant:
          // says "record number" where there is no chrome to say it.
          `${variant === "inline" ? "#" : ""}${shortIdentifier(id)} ⧉`}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export interface DomainTextProps {
  value: ReactNode;
  missingKind?: Exclude<MissingKind, "zero">;
  missingReason?: string;
  className?: string;
}

/** Free text, or a typed missing value in its place. */
export function DomainText({ value, missingKind = "unrecorded", missingReason, className }: DomainTextProps) {
  if (value === null || value === undefined || value === "" || value === false) {
    return <MissingValue kind={missingKind} reason={missingReason} className={className} />;
  }
  return <span className={className}>{value}</span>;
}
