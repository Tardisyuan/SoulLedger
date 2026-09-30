"use client";

import { useState, useSyncExternalStore } from "react";
import { assistBlocks, assistShownText, type AssistStreamFetch } from "@soulledger/core/api/assist-stream";

/**
 * The streamed answer on the web (canvas「问一问 · 流式输出」A2–A3, A11), shared by the officer
 * panel and the admin page's 试问. Only opacity moves: each new fragment fades in over 120 ms, a
 * static ▍ in ink3 sits at the end until the answer is done. No typewriter. Markdown is
 * progressive (`assistBlocks`): only what has closed is formatted.
 *
 * Reduced motion: no fade, no cursor, and text arrives a paragraph at a time (`assistShownText`).
 * The global `prefers-reduced-motion` rule in globals.css already collapses the CSS animations;
 * the paragraph gate and the cursor need to know in JS, hence `useReducedMotion`.
 */

/** The browser's `fetch`, in the shape `streamAssist` takes (the DOM's init wants a DOM `AbortSignal`). */
export const webStreamFetch: AssistStreamFetch = (url, init) => fetch(url, init as RequestInit);

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(REDUCE);
  mql.addEventListener?.("change", onChange);
  return () => mql.removeEventListener?.("change", onChange);
};
const reducedNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedNow, () => false);
}

/** 1d waiting: three dots brightening one after another, 400 ms each, looping; still under reduced motion. */
export function WaitingDots() {
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5" data-testid="assist-dots">
      {[0, 400, 800].map((delay) => (
        <span
          key={delay}
          className="h-1 w-1 bg-[oklch(var(--color-ink-subtle))] motion-safe:animate-[assist-dot_1200ms_steps(1,end)_infinite]"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function StreamingText({ text, streaming, className = "" }: { text: string; streaming: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const shown = assistShownText(text, streaming, reduced);
  const blocks = assistBlocks(shown, streaming);
  // The fragment that arrived since the last render fades in; keyed by length so each new one restarts.
  const [seen, setSeen] = useState({ length: shown.length, fresh: 0 });
  if (seen.length !== shown.length) setSeen({ length: shown.length, fresh: Math.max(0, shown.length - seen.length) });
  const fresh = streaming && !reduced ? seen.fresh : 0;
  const last = blocks.length - 1;

  return (
    <div data-testid="assist-stream-text" className={`text-sm text-[oklch(var(--color-ink))] ${className}`}>
      {blocks.map((b, i) => {
        const spans = b.spans.map((s, j) => {
          const tail = i === last && j === b.spans.length - 1 ? Math.min(fresh, s.text.length) : 0;
          const Tag = s.bold ? "strong" : "span";
          return (
            <Tag key={j} className={s.bold ? "font-semibold" : undefined}>
              {tail ? s.text.slice(0, s.text.length - tail) : s.text}
              {tail ? (
                <span key={shown.length} className="animate-[row-enter_120ms_linear_both]">
                  {s.text.slice(s.text.length - tail)}
                </span>
              ) : null}
            </Tag>
          );
        });
        const cursor =
          i === last && streaming && !reduced ? (
            <span aria-hidden="true" data-testid="assist-cursor" className="text-[oklch(var(--color-ink-subtle))]">
              ▍
            </span>
          ) : null;
        const gap = b.gap ? "mt-3" : i ? "mt-1" : "";
        return b.kind === "li" ? (
          <p key={i} className={`flex gap-2 ${gap}`}>
            <span aria-hidden="true" className="shrink-0 text-[oklch(var(--color-ink-subtle))]">
              {b.marker}
            </span>
            <span>
              {spans}
              {cursor}
            </span>
          </p>
        ) : (
          <p key={i} className={gap}>
            {spans}
            {cursor}
          </p>
        );
      })}
      {blocks.length === 0 && streaming && !reduced ? (
        <span aria-hidden="true" data-testid="assist-cursor" className="text-[oklch(var(--color-ink-subtle))]">
          ▍
        </span>
      ) : null}
    </div>
  );
}
