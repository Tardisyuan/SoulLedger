/**
 * Client-side Sentry. **This file exists because the old one did nothing, and
 * it loads Sentry dynamically because the obvious version of the fix made
 * every build pay for it.**
 *
 * WHY THE OLD ONE DID NOTHING. `sentry.client.config.ts` was the convention up
 * to Next 14 and the SDK still documents it, with one caveat this project sits
 * squarely inside: Next 16 builds with Turbopack by default, and
 * @sentry/nextjs's own build code says in as many words that under Turbopack
 * `sentry.client.config.ts` will no longer work. Measured 2026-09-01 on a
 * production build with `SENTRY_DSN` set — `withSentryConfig` demonstrably
 * applied (the exported config grows `serverExternalPackages` and `webpack`):
 *
 *   files under .next containing `Sentry.init`        0
 *   client chunks mentioning sentry (of 130)          0
 *   server chunks mentioning sentry                   0
 *
 * So the dependency, the DSN plumbing in next.config.js and three config files
 * were all in place, and no error has ever been reported from a browser.
 *
 * WHY THE IMPORT IS DYNAMIC. `instrumentation-client.ts` is a Next file
 * convention: Next bundles it on every build, whether or not `withSentryConfig`
 * wrapped anything. A static `import * as Sentry` therefore put **143 KB
 * gzipped** of SDK into builds with no DSN — dev builds, and any deployment
 * that never configured Sentry. `NEXT_PUBLIC_SENTRY_DSN` is inlined at build
 * time, so guarding the dynamic import on it lets a DSN-less build drop the
 * whole branch.
 *
 * REPLAY IS LOADED LAZILY on top of that. It was in the synchronous
 * `integrations` array while `replaysSessionSampleRate` is 0.1, so nine
 * sessions in ten downloaded the heaviest part of the SDK and recorded
 * nothing. `lazyLoadIntegration` fetches it from Sentry's CDN on demand —
 * which is a network call this app, an internal console, may not be able to
 * make. Hence the `.catch`: failing to load replay must not take error
 * reporting down with it, and it is logged rather than toasted because no
 * operator can act on it.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
});

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.lazyLoadIntegration("replayIntegration")
    .then((replayIntegration) => {
      Sentry.addIntegration(
        replayIntegration({ maskAllText: true, blockAllMedia: true })
      );
    })
    .catch((err) => {
      console.warn("[sentry] replay did not load; errors still report", err);
    });
}

/**
 * Required by Next 16 for navigation spans. Without it, client-side route
 * changes are invisible to tracing — which on this app is most of the
 * navigation, since every transition after login is client-side.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
