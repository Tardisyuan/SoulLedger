"use client";

import { useSyncExternalStore } from "react";

/**
 * ≥ 1024 px, the one breakpoint 规范 v1 draws between "the desktop shell" and
 * "the narrow one". Two readers: the shell (sidebar vs number rail) and the
 * workflow editor (editable canvas vs the read-only view, design C · 03).
 *
 * No matchMedia (jsdom) reads as wide: both readers treat the narrow layout as
 * the fallback, and the jest suites were written against the wide one.
 */
export function useWideViewport(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)").matches : true),
    () => true
  );
}
