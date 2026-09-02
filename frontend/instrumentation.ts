import * as Sentry from "@sentry/nextjs";

/**
 * Server and edge Sentry.
 *
 * `sentry.server.config.ts` and `sentry.edge.config.ts` were sitting on disk
 * with nothing importing them: Next only loads them through this file's
 * `register()`, and there was no `instrumentation.ts`. Same measured result as
 * the client — zero server chunks mentioning sentry in a build with the DSN
 * set. The two config files are kept and imported rather than inlined, so the
 * runtime split stays visible.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** Server-side render and route-handler errors. Also never wired up before. */
export const onRequestError = Sentry.captureRequestError;
