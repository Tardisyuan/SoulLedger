"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether the element at `ref` is at least `need` px wide, kept current with a
 * ResizeObserver. Before the first measurement the guess is the viewport less the
 * expanded nav (252 px, 规范 v3) — close enough that a remembered-open panel does not
 * flash as an overlay and then push. No ResizeObserver (jsdom) reads as roomy, the
 * same fallback `useWideViewport` takes.
 */
export function useRoomBeside(ref: RefObject<HTMLElement | null>, need: number): boolean {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" || typeof ResizeObserver === "undefined" ? Infinity : window.innerWidth - 252
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width >= need;
}
