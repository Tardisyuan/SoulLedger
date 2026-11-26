"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";

/**
 * A progress bar for navigations the operator cannot otherwise see.
 *
 * `nprogress` and `@types/nprogress` have been dependencies with **zero
 * imports anywhere in the source** — installed for this and never wired up.
 * Meanwhile several flows end in `router.push` after a mutation (dispatch
 * approve/reject/execute, judgment conclude): the toast fires, and then
 * nothing happens visibly until the next page's data arrives. On a slow query
 * that reads as a click that did not register.
 *
 * WHY A `history` PATCH AND NOT ROUTER EVENTS. The App Router has no
 * `routeChangeStart`; `next/navigation` exposes only the resulting pathname.
 * Both `<Link>` and `router.push` go through `history.pushState`, so patching
 * it catches every client-side navigation from one place — including the
 * post-mutation redirects, which an anchor-click listener would miss entirely.
 *
 * The bar is finished by the pathname/query effect below rather than by the
 * patch, because "the URL changed" and "the new route is on screen" are
 * different moments and only the second one is worth ending on.
 *
 * WHAT DOES NOT START IT (审计 2026-11-26 B1). Only that effect ends the bar,
 * and it runs only when the pathname or query changes — so a history call that
 * changes neither (a same-URL `replaceState`, `router.refresh`, a hash) used to
 * start a bar nothing would ever finish. Those no longer start one.
 * `replaceState` starts it only for a new pathname: a query-only replace is a
 * filter or the case desk's J / K, which already answer on screen. And the bar
 * waits {@link ROUTE_PROGRESS_DELAY_MS} before showing, so a route that is on
 * screen sooner never flashes it.
 */
export const ROUTE_PROGRESS_DELAY_MS = 150;

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** pathname + query of the route last put on screen. */
  const shown = useRef("");

  useEffect(() => {
    NProgress.configure({ showSpinner: false, trickleSpeed: 120, minimum: 0.15 });

    const { pushState, replaceState } = window.history;

    function start() {
      if (pending.current === undefined) pending.current = setTimeout(() => NProgress.start(), ROUTE_PROGRESS_DELAY_MS);
    }
    /** Whether `url` leads off the current pathname (or, with `query`, off the current query string). */
    function leaves(url: string | URL | null | undefined, query: boolean) {
      if (url == null) return false;
      const to = new URL(String(url), window.location.href);
      return to.pathname !== window.location.pathname || (query && to.search !== window.location.search);
    }

    window.history.pushState = function patchedPush(...args) {
      if (leaves(args[2], true)) start();
      return pushState.apply(window.history, args);
    };
    window.history.replaceState = function patchedReplace(...args) {
      if (leaves(args[2], false)) start();
      return replaceState.apply(window.history, args);
    };
    // Back/forward buttons do not call pushState. The URL has already changed when this fires, so
    // compare with the route on screen: going back over an in-page anchor changes only the hash.
    function onPop() {
      if (window.location.pathname + window.location.search !== shown.current) start();
    }
    window.addEventListener("popstate", onPop);

    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener("popstate", onPop);
      clearTimeout(pending.current);
      pending.current = undefined;
      NProgress.done();
    };
  }, []);

  // The route is on screen; stop — and cancel a bar still waiting out its delay.
  // Depends on the query string too, because a push may change only the query.
  useEffect(() => {
    clearTimeout(pending.current);
    pending.current = undefined;
    shown.current = window.location.pathname + window.location.search;
    NProgress.done();
  }, [pathname, searchParams]);

  return null;
}
