"use client";

import { useEffect } from "react";
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
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    NProgress.configure({ showSpinner: false, trickleSpeed: 120, minimum: 0.15 });

    const { pushState, replaceState } = window.history;

    function start() {
      NProgress.start();
    }

    window.history.pushState = function patchedPush(...args) {
      start();
      return pushState.apply(window.history, args);
    };
    window.history.replaceState = function patchedReplace(...args) {
      start();
      return replaceState.apply(window.history, args);
    };
    // Back/forward buttons do not call pushState.
    window.addEventListener("popstate", start);

    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener("popstate", start);
      NProgress.done();
    };
  }, []);

  // The route is on screen; stop. Depends on the query string too, because a
  // filter change is a navigation here (PageShell writes filters into the URL).
  useEffect(() => {
    NProgress.done();
  }, [pathname, searchParams]);

  return null;
}
