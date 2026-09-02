"use client";

import { MissingValue } from "@/src/components/ui/DomainValue";

/**
 * The dot colour for each row tone, and the row chrome every spine row is laid
 * on. Lifted out of `SoulLifecycleTimeline` so the file that decides WHICH row
 * to draw stays separable from the one that decides what a row LOOKS like —
 * the terminal-variant argument below is the part worth reading on its own.
 */
export const TONE_DOT: Record<string, string> = {
  neutral: "bg-[hsl(var(--color-ink-subtle))]",
  merit: "bg-[hsl(var(--color-karma-merit))]",
  demerit: "bg-[hsl(var(--color-karma-demerit))]",
  info: "bg-[hsl(var(--color-status-info))]",
  accent: "bg-[hsl(var(--color-accent))]",
};

interface RowShellProps {
  date: string | null;
  dotClassName: string;
  dashed?: boolean;
  hideConnector?: boolean;
  highlight?: boolean;
  tint?: boolean;
  /** SETTLED-only spine terminal (see §3 of the Stage 5 design doc): "filled"
   * is a larger ringed dot — someone is still there (Aaru, Heaven, eternal
   * Hell). "flush" drops the dot for a bare line-end — annihilation, so
   * there is nobody left for a further entry to be about. Both render on the
   * row for the soul's terminal disposition; the badge and destination text
   * stay outcome-neutral, this is the one channel that carries the fate. */
  terminalVariant?: "filled" | "flush";
  children: React.ReactNode;
  right?: React.ReactNode;
}

export function RowShell({ date, dotClassName, dashed, hideConnector, highlight, tint, terminalVariant, children, right }: RowShellProps) {
  return (
    <div
      className={`flex items-stretch gap-3 ${tint ? "bg-[hsl(var(--color-accent)/0.06)]" : ""} ${
        highlight ? "bg-[hsl(var(--color-accent)/0.1)] border border-[hsl(var(--color-accent)/0.4)]" : ""
      }`}
    >
      <div className="w-16 shrink-0 text-02 text-[hsl(var(--color-ink-subtle))] text-right pt-2">{date ?? <MissingValue kind="unrecorded" />}</div>
      <div className="flex flex-col items-center shrink-0">
        {terminalVariant === "flush" ? (
          <span className="w-2.5 h-px mt-3 bg-[hsl(var(--color-hairline-strong))]" aria-hidden="true" />
        ) : (
          <span
            className={
              terminalVariant === "filled"
                ? `w-3.5 h-3.5 rounded-full mt-1.5 ring-2 ring-[hsl(var(--color-status-settled)/0.35)] ${dotClassName}`
                : `w-2.5 h-2.5 rounded-full mt-2 ${dotClassName}`
            }
            aria-hidden="true"
          />
        )}
        {!hideConnector && (
          <span
            className={`flex-1 w-0 mt-0.5 ${dashed ? "border-l border-dashed border-[hsl(var(--color-hairline-strong))]" : "border-l border-[hsl(var(--color-hairline))]"}`}
          />
        )}
      </div>
      <div className="flex-1 min-w-0 py-1.5">{children}</div>
      {right && <div className="shrink-0 text-right py-1.5 pl-2">{right}</div>}
    </div>
  );
}
