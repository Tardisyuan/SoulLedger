"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

/** 粘贴来的「123 456」「123-456」照收;恢复码还去掉大小写差别。 */
export function normalizeCode(raw: string, kind: "totp" | "recovery"): string {
  const stripped = raw.replace(/[\s\-‑–]/g, "");
  return kind === "totp" ? stripped.replace(/\D/g, "").slice(0, 6) : stripped.toLowerCase().slice(0, 8);
}

interface CodeInputProps {
  id?: string;
  /** totp: ONE 56-high box, mono 28, letter-spacing 0.5em, numeric, 6 digits, auto-submits at 6.
   *  recovery: mono 22, 8 alphanumerics, case-insensitive, dashes optional, no auto-submit. */
  kind: "totp" | "recovery";
  value: string;
  onChange: (next: string) => void;
  /** Called once the value reaches the full length (totp only). */
  onComplete?: (code: string) => void;
  label: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  className?: string;
}

/**
 * The code box (A12). One input, not six: a six-cell input is a keyboard-navigation and
 * screen-reader maze, and the spec draws one. `autocomplete="one-time-code"` lets iOS / Android
 * offer the SMS-style fill; `inputmode="numeric"` brings the number pad.
 *
 * Errors live OUTSIDE (the page renders them in `role="alert"` and moves focus back here with
 * select-all); this component only wires `aria-invalid` / `aria-describedby` to the hint.
 * No `autoFocus` prop either (jsx-a11y): the owner focuses it through the ref when the step opens.
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  { id, kind, value, onChange, onComplete, label, hint, error, disabled, className },
  ref
) {
  const generated = useId();
  const inputId = id ?? `code-${generated}`;
  const hintId = `${inputId}-hint`;
  const full = kind === "totp" ? 6 : 8;

  const apply = (raw: string) => {
    const next = normalizeCode(raw, kind);
    onChange(next);
    if (kind === "totp" && next.length === full && onComplete) onComplete(next);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={inputId} className="text-xs text-[oklch(var(--color-ink-muted))]">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        type="text"
        inputMode={kind === "totp" ? "numeric" : "text"}
        autoComplete={kind === "totp" ? "one-time-code" : "off"}
        autoCapitalize="off"
        spellCheck={false}
        maxLength={kind === "totp" ? 6 : 9}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        data-kind={kind}
        onChange={(e) => apply(e.target.value)}
        onPaste={(e) => {
          e.preventDefault();
          apply(e.clipboardData.getData("text"));
        }}
        className={cn(
          "w-full border bg-[oklch(var(--color-canvas))] px-4 font-mono text-[oklch(var(--color-ink))] outline-none",
          "focus-visible:border-[oklch(var(--color-ink))] disabled:cursor-not-allowed disabled:bg-[oklch(var(--color-disabled-surface))]",
          error ? "border-[oklch(var(--color-danger))]" : "border-[oklch(var(--color-line-strong))]",
          kind === "totp" ? "h-14 text-xl tracking-[0.5em]" : "h-14 text-lg tracking-[0.2em]"
        )}
      />
      {hint ? (
        <p id={hintId} className="text-2xs text-[oklch(var(--color-ink-subtle))]">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
