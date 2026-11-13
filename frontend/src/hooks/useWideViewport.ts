"use client";

import { useSyncExternalStore } from "react";

/**
 * ≥ 1024 px, the one breakpoint 规范 v1 draws between "the desktop shell" and
 * "the narrow one". Two readers: the shell (sidebar vs number rail) and the
 * workflow editor (editable canvas vs the read-only view, design C · 03).
 * `minPx` asks about another line instead — the underworld map's toolbar turns
 * from a column into a row under Tailwind's `md` (768 px) and says so in
 * `aria-orientation`.
 *
 * No matchMedia (jsdom) reads as wide: the readers treat the narrow layout as
 * the fallback, and the jest suites were written against the wide one.
 */
export function useWideViewport(minPx = 1024): boolean {
  const query = `(min-width: ${minPx}px)`;
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true),
    () => true
  );
}
