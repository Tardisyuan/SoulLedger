import { NextRequest, NextResponse } from "next/server";

// Imported, not copied. `src/config/locale.ts`'s header has claimed since it
// was written that "middleware.ts 同样从这里取值" — and it did not:
// `git log -p --all -- frontend/middleware.ts | grep config/locale` matched
// **nothing**, ever. The three literals below lived here in their own copy
// while a comment elsewhere announced the consolidation as done.
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@soulledger/core/config/locale";

/** Request header the per-request nonce travels in; app/layout.tsx reads it
 *  for the one inline script this repo writes. */
const NONCE_HEADER = "x-nonce";

/** The REST API origin and the notifications-socket origin derived from it.
 *
 *  The socket URL is `baseUrl` with `http` → `ws` and `/api/v1` dropped
 *  (packages/core/src/platform/index.ts), so connect-src must name both
 *  forms. `NEXT_PUBLIC_API_URL` is inlined at build — the same value, with
 *  the same fallback, that frontend/lib/platform/web.ts hands the browser.
 *  A relative value (`/api/v1`) is same-origin, which `'self'` covers. */
function apiOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  if (!/^https?:\/\//.test(raw)) return [];
  const origin = new URL(raw).origin;
  return [origin, origin.replace(/^http/, "ws")];
}

/** The document CSP. **It lives here, not in nginx.conf**: a nonce is per
 *  request, and only this layer sees the request before Next renders it.
 *  nginx.conf adds its own policy only to responses that arrive without one
 *  (API JSON, /admin/, static files) — two CSP headers are intersected by
 *  the browser, so a second, looser nginx copy on documents would be dead
 *  weight at best and, if it ever tightened script-src, would block the
 *  nonced scripts.
 *
 *  script-src: `'nonce-…' 'strict-dynamic'`, **no `'unsafe-inline'`**
 *  (proxyAuthGate.test.ts fails if it comes back). Next reads the nonce out
 *  of the *request* CSP header during SSR and stamps it on its own scripts.
 *  `'strict-dynamic'` extends trust to scripts those create — Next's lazy
 *  chunks, and Sentry's `lazyLoadIntegration`, which appends a `<script>`
 *  from browser.sentry-cdn.com (instrumentation-client.ts). The CDN host is
 *  listed for CSP2-only browsers, which ignore `'strict-dynamic'`; CSP3
 *  browsers ignore host sources when `'strict-dynamic'` is present.
 *
 *  style-src keeps `'unsafe-inline'`: React `style={…}` props and xyflow /
 *  recharts write inline styles, and a nonce in style-src would disable
 *  `'unsafe-inline'` there. img-src names the API origin because avatars are
 *  served from its /media/ when the API is not same-origin (dev, E2E).
 *
 *  `'unsafe-eval'` only under `next dev` (React's dev-only stack rebuilding). */
export function contentSecurityPolicy(nonce: string, host: string): string {
  const api = apiOrigins();
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://browser.sentry-cdn.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data:", ...api.slice(0, 1)].join(" "),
    ["connect-src 'self'", ...api, `wss://${host}`, "https://*.sentry.io"].join(" "),
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

// Routes that don't require authentication
const PUBLIC_PATHS = ["/", "/welcome", "/(auth)/login", "/(auth)/register"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname === p.replace("(auth)/", "")
  );
}

// Next 16 renamed the `middleware` file convention to `proxy` (same contract,
// same `config.matcher`; the old name only printed a deprecation warning).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Locale handling
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  // `isLocale` rather than `SUPPORTED_LOCALES.includes`: it is the type
  // guard the rest of the app narrows with, so the two cannot disagree about
  // what counts as a locale.
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  // Fresh per request. Next takes the nonce from the request's CSP header;
  // `x-nonce` is for our own inline script (app/layout.tsx).
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, request.nextUrl.host);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // Auth guard: check for refresh token cookie
  const refreshToken = request.cookies.get("soulledger_refresh")?.value;
  if (!refreshToken && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // NO ADMIN GATE HERE, DELIBERATELY.
  //
  // This used to set an `X-Requires-Admin: true` response header on
  // `["/admin", "/permissions", "/menus"]`, described as "for client-side
  // verification". Nothing read it — a grep for `Requires-Admin` across the
  // repo matched only that one line, and it could not have been read: it is a
  // header on the *document* response, which client code has no access to.
  //
  // Its path list was also short by four: `/tenants`, `/users`,
  // `/organizations` and `/audit` are admin surfaces and were not in it. So
  // the thing that looked like an admin route guard both did nothing and
  // covered the wrong set — the worse of the two failures, because the list
  // reads as authoritative.
  //
  // The real gates: `<RequireAdmin>` / `<RequirePermission>` on each page
  // (pinned by src/__tests__/proxyAuthGate.test.ts and
  // backend/tests/test_page_gates_match_the_backend.py), and
  // `CodenamePermission` on every API the pages call. Proxy cannot
  // verify a role without decoding and trusting a JWT it has no key for, and
  // a guard that only hides links is not one.

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
