/**
 * Forced-upgrade check, shared by both apps (the officer app borrows it through its `shared.ts`).
 *
 * The backend (`GET /api/v1/app-version/`) only hands out numbers; the comparison is here.
 * EVERY failure -- offline, timeout, bad status, malformed body, an unparseable version, an empty
 * "minimum" (the default: not configured) -- means "do not block". The one thing this module may
 * never do is keep a user out because the version endpoint is down.
 */
import { defaultApiBaseUrl } from "./platform";

export type VersionApp = "soul" | "officer";

export type VersionPolicy = { minSupported: string; latest: string; storeUrl: string };

const VERSION = /^\d+(\.\d+){0,3}$/;

/** -1 / 0 / 1, or `null` when either side is not a plain dotted-number version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (!VERSION.test(a) || !VERSION.test(b)) return null;
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True only when both are valid versions and `current` is strictly lower than `minimum`. */
export function isBelowMinimum(current: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!current || !minimum) return false;
  return compareVersions(current, minimum) === -1;
}

const TIMEOUT_MS = 5000;

/** The policy for this app and platform, or `null` for any failure (never throws). */
export async function fetchVersionPolicy(app: VersionApp, platform: "ios" | "android"): Promise<VersionPolicy | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${defaultApiBaseUrl()}/app-version/?app=${app}&platform=${platform}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return { minSupported: text(body?.min_supported), latest: text(body?.latest), storeUrl: text(body?.store_url) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
