/**
 * Crash reporting for both apps (the officer app borrows it through its `shared.ts`).
 *
 * OFF UNLESS A DSN IS CONFIGURED. `initCrashReporting` returns false and touches nothing when the
 * public env var is empty: the SDK is not even `require`d, so an unconfigured build behaves exactly
 * as it did before this file existed. No DSN lives in the repo.
 *
 * WHAT MAY LEAVE THE DEVICE. A crash report is a stack, the device/OS/app version and an internal
 * numeric user id. Never request bodies, headers, screenshots, replays or traces (all off below), and
 * never the things this product handles: tokens, passwords, one-time codes, two-step secrets and
 * recovery codes, letters (书信), 问一问 questions. `scrubEvent` / `scrubBreadcrumb` are pure and are
 * the last thing that runs before an event is sent; anything under a sensitive key name, and any
 * string that looks like a bearer token / JWT, is replaced. It is a deny-list on key names, so a new
 * field with an innocuous name is not covered: keep user content out of `extra` and exception text.
 */

export type CrashApp = "soul" | "officer";

const FILTERED = "[Filtered]";

/** Key names (case/separator-insensitive substrings) whose values never leave the device. */
const SENSITIVE = [
  "authorization", "cookie", "token", "password", "passwd", "secret", "otp", "totp", "mfa",
  "recovery", "backup", "verif", "code", "email", "phone", "body", "content", "question",
  "prompt", "letter", "draft", "caption", "answer", "text", "payload", "input", "message", "soul", "name",
];
/** Present in every report and not secret. */
const ALLOWED_KEYS = new Set(["statuscode"]);

function sensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !ALLOWED_KEYS.has(k) && SENSITIVE.some((s) => k.includes(s));
}

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]+/gi;

/** Redacts bearer tokens / JWTs in free text and drops any URL query string. */
export function scrubString(s: string): string {
  return s.replace(JWT, FILTERED).replace(BEARER, `$1 ${FILTERED}`).replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1");
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return FILTERED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sensitiveKey(k) ? FILTERED : scrubValue(v, depth + 1);
  }
  return out;
}

type Loose = Record<string, any>;

/** The event as it may be sent. Returns a copy; the input is not modified. */
export function scrubEvent<T extends Loose>(event: T): T {
  const e: Loose = { ...event };
  // Identity: the internal id only -- no name, email, soul code, IP.
  const id = e.user?.id;
  e.user = id === undefined || id === null ? undefined : { id: String(id) };
  delete e.request; // headers, cookies, bodies, query strings: none of it is needed for a crash
  delete e.server_name;
  for (const section of ["extra", "contexts", "tags"]) {
    if (e[section]) e[section] = scrubValue(e[section], 0);
  }
  if (typeof e.message === "string") e.message = scrubString(e.message);
  if (e.logentry?.message) e.logentry = { ...e.logentry, message: scrubString(e.logentry.message), params: undefined };
  if (e.exception?.values) {
    e.exception = {
      ...e.exception,
      values: e.exception.values.map((v: Loose) => ({ ...v, value: typeof v.value === "string" ? scrubString(v.value) : v.value })),
    };
  }
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs.map((b: Loose) => scrubBreadcrumb(b)).filter(Boolean);
  }
  return e as T;
}

/** `null` drops the breadcrumb. Console output and typed input can carry anything the user wrote. */
export function scrubBreadcrumb<T extends Loose>(crumb: T): T | null {
  if (crumb.category === "console" || String(crumb.category ?? "").startsWith("ui.input")) return null;
  const c: Loose = { ...crumb };
  if (typeof c.message === "string") c.message = scrubString(c.message);
  if (c.data) c.data = scrubValue(c.data, 0);
  return c as T;
}

/** Set only by a successful init: every other entry point is a no-op (and loads nothing) before it. */
let started = false;

/**
 * Starts the SDK when `dsn` is non-empty. Returns whether it started. Session replay, screenshots,
 * view hierarchy, tracing and default PII are all left off.
 */
export function initCrashReporting(dsn: string | undefined, app: CrashApp): boolean {
  if (!dsn) return false;
  try {
    // Required lazily so a build without a DSN never loads the SDK.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableUserInteractionTracing: false,
      enableAutoPerformanceTracing: false,
      enableCaptureFailedRequests: false,
      maxBreadcrumbs: 30,
      beforeSend: (event) => scrubEvent(event as Loose) as typeof event,
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as Loose) as typeof crumb | null,
    });
    Sentry.setTag("app", app);
    started = true;
    return true;
  } catch {
    return false;
  }
}

/** Internal numeric id only; `null` on sign-out. A no-op when reporting is off. */
export function setCrashUser(id: number | null): void {
  if (!started) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    Sentry.setUser(id === null ? null : { id: String(id) });
  } catch {
    /* reporting is best-effort */
  }
}

/** How long to wait for the SDK to say an event reached the server. */
const DELIVERY_WAIT_MS = 5000;

/**
 * Reports a render error caught by the error boundary and resolves `true` only when the server
 * accepted it. `captureException` returns an event id the moment the event is queued -- not a
 * delivery -- and `flush()` resolves `true` once the queue is empty, which a failed send also
 * leaves. The one signal that carries the outcome is the client's `afterSendEvent` hook: it fires
 * with the transport response (a 2xx `statusCode`) for that event id, and with an error object when
 * the send failed. An event the SDK drops (no client, deduped, sampled) never reaches it, so the
 * wait times out and answers `false`. Off, or anything unexpected: `false`, never a throw.
 */
export function captureCrash(error: unknown): Promise<boolean> {
  if (!started) return Promise.resolve(false);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    const client = Sentry.getClient() as unknown as
      | { on?: (hook: string, cb: (event: Loose, response: unknown) => void) => void | (() => void) }
      | undefined;
    const on = client?.on?.bind(client);
    if (!on) {
      Sentry.captureException(error);
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      let id: string | undefined;
      let off: void | (() => void);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        if (typeof off === "function") off();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), DELIVERY_WAIT_MS);
      off = on("afterSendEvent", (event, response) => {
        if (id === undefined || event?.event_id !== id) return;
        const status = (response as { statusCode?: unknown } | undefined)?.statusCode;
        finish(typeof status === "number" && status >= 200 && status < 300);
      });
      id = Sentry.captureException(error);
    });
  } catch {
    return Promise.resolve(false); // reporting is best-effort
  }
}
