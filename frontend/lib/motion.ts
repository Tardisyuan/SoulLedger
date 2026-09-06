/**
 * The one place that asks whether the operator wants motion.
 *
 * WHY THIS IS NOT A STYLESHEET QUESTION. `app/globals.css` already collapses
 * every CSS animation and transition to 1ms under
 * `@media (prefers-reduced-motion: reduce)`, with `*, *::before, *::after` and
 * `!important`, so everything drawn by CSS is covered and covered well. What
 * that rule cannot reach is motion a library draws from JavaScript on a
 * `requestAnimationFrame` loop — gsap writing `transform` on the workflow
 * canvas, and recharts growing its bars and arcs on mount. No stylesheet can
 * shorten either one. Those are the only two places in this application where
 * the preference has to be read in JS, and until now only the first one did:
 * an operator who had asked their OS for no motion still got the dashboard's
 * four charts animating on every mount.
 *
 * Read at the moment it is needed rather than subscribed to. A `matchMedia`
 * listener would need a `useEffect` and a re-render to answer the same
 * question, and would answer it one interaction late; every caller here is
 * either a click handler or a mount, both of which can just ask.
 *
 * `window.matchMedia` is guarded because callers are reachable from a test
 * environment that does not implement it — jsdom provides `window` but not
 * `matchMedia`, so the `typeof window !== "undefined"` check alone is not
 * enough and dropping the second condition throws rather than degrading.
 *
 * Returning `false` when there is no `window` is the deliberate default: on
 * the server there is no operator to have a preference, and the two callers
 * are both client-only (`ssr: false` on the charts, a click handler on the
 * canvas), so no server render ever depends on this answer.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
