"use client";

import { useEffect, useRef } from "react";
import type React from "react";

/**
 * The keyboard contract for an off-canvas drawer.
 *
 * WHY THIS EXISTS. `AppLayout.tsx` and `SettingsDrawer.tsx` each had a
 * `<div onClick={close}>` scrim and nothing else: across all 722 lines of
 * AppLayout, `Escape|onKeyDown|keydown|tabIndex|role=` matched zero times.
 * The scrim was never the defect — it is the *mouse's* redundant way out. The
 * defect is that there was no keyboard way out at all, and no way *in* either:
 * opening the mobile drawer left focus wherever it was, so a screen-reader user
 * carried on walking a page that a full-screen overlay had just covered.
 *
 * A drawer that is presented modally owes three things, and this hook is all
 * three in one place so the two callers cannot drift:
 *
 *   1. **A way in.** On open, focus moves to the first focusable thing inside
 *      the drawer (or the drawer itself, hence `tabIndex: -1`).
 *   2. **A boundary.** Tab off the last item wraps to the first; Shift+Tab off
 *      the first wraps to the last. Escape closes.
 *   3. **A way back.** On close, focus returns to whatever had it when the
 *      drawer opened — the hamburger, or the settings gear.
 *
 * WHAT THE TESTS CAN AND CANNOT SEE. jsdom has no layout and no native tab
 * order. Two consequences, both load-bearing:
 *
 *   - The focusable scan below deliberately does NOT filter on visibility.
 *     `offsetParent`/`getClientRects()` are empty for *every* element in jsdom,
 *     so a visibility filter would return zero items there — a trap that traps
 *     nothing, passing its tests because it never had a candidate to reject.
 *     Filtering happens on `disabled`/`aria-hidden`, which jsdom does model.
 *   - jsdom does not move focus when a Tab key event fires. So only the two
 *     *wrap* edges are assertable — those are the moves this handler makes
 *     itself. "Tab from the middle lands on the next control" is the browser's
 *     job, and no test here claims to check it.
 *
 * The `keydown` handler is a React prop on the drawer element rather than a
 * `document` listener on purpose: AppLayout also hosts a Headless UI `Dialog`
 * (the logout confirmation), which does its own Escape handling on the
 * document. A capturing document listener here would race it.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Tab stops inside `root`, in document order. See the jsdom note above. */
export function focusablesWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute("aria-hidden") !== "true" && !el.hasAttribute("inert")
  );
}

export interface DrawerA11yOptions {
  open: boolean;
  onClose: () => void;
  /**
   * `id` of the element whose text names the drawer — its visible heading,
   * preferred over `label` so the name and the heading cannot say different
   * things.
   */
  labelledBy?: string;
  /** Fallback name, for a drawer with no visible heading to point at. */
  label?: string;
}

/**
 * Spread onto the drawer element. Empty while closed: AppLayout's `<aside>` is
 * the permanent desktop sidebar as well as the phone drawer, and a sidebar
 * that is always on screen is not a dialog and must not claim to be one.
 */
export interface DrawerA11yProps {
  role?: "dialog";
  "aria-modal"?: true;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  tabIndex?: -1;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function useDrawerA11y<T extends HTMLElement>({
  open,
  onClose,
  labelledBy,
  label,
}: DrawerA11yOptions): {
  drawerRef: React.RefObject<T>;
  drawerProps: DrawerA11yProps;
} {
  // `useRef<T>(null)`, not `useRef<T | null>(null)`. The latter types as
  // `RefObject<T | null>`, and @types/react measures `RefObject` as covariant,
  // so TS compares it to the `ref` prop's `RefObject<T>` by variance rather
  // than structurally and rejects it — despite the two having the identical
  // `readonly current: T | null`. Nothing here writes to `.current`; React
  // does.
  const drawerRef = useRef<T>(null);

  // Deps are `[open]` alone, and that is deliberate. `onClose` is written at
  // both call sites as an inline arrow (`() => setMobileMenuOpen(false)`), so a
  // fresh identity every render; listing it here would re-run this effect on
  // every render and yank focus back to the first item mid-interaction. The
  // handler below reads `onClose` from the render closure instead, where a new
  // identity is exactly what you want.
  useEffect(() => {
    if (!open) return;
    const node = drawerRef.current;
    if (!node) return;

    // Captured before focus moves, so it is the opener and not the drawer.
    const opener = document.activeElement;
    const restoreTo = opener instanceof HTMLElement ? opener : null;

    const first = focusablesWithin(node)[0];
    (first ?? node).focus();

    return () => {
      // `isConnected` because the opener can be unmounted by the same change
      // that closed the drawer; focusing a detached node silently does nothing
      // in a browser and would leave focus on `<body>`.
      if (restoreTo && restoreTo.isConnected) restoreTo.focus();
    };
  }, [open]);

  if (!open) {
    return { drawerRef, drawerProps: {} };
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const node = drawerRef.current;
    if (!node) return;
    const items = focusablesWithin(node);

    // A drawer with nothing focusable in it still must not leak focus to the
    // page underneath; the container itself is the single stop.
    if (items.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !node.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !node.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return {
    drawerRef,
    drawerProps: {
      role: "dialog",
      "aria-modal": true,
      tabIndex: -1,
      onKeyDown: handleKeyDown,
      ...(labelledBy ? { "aria-labelledby": labelledBy } : label ? { "aria-label": label } : {}),
    },
  };
}
