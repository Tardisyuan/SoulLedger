import { NextRequest, NextResponse } from "next/server";

// Imported, not copied. `src/config/locale.ts`'s header has claimed since it
// was written that "middleware.ts 同样从这里取值" — and it did not:
// `git log -p --all -- frontend/middleware.ts | grep config/locale` matched
// **nothing**, ever. The three literals below lived here in their own copy
// while a comment elsewhere announced the consolidation as done.
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/src/config/locale";

// Routes that don't require authentication
const PUBLIC_PATHS = ["/", "/welcome", "/(auth)/login", "/(auth)/register"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname === p.replace("(auth)/", "")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Locale handling
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  // `isLocale` rather than `SUPPORTED_LOCALES.includes`: it is the type
  // guard the rest of the app narrows with, so the two cannot disagree about
  // what counts as a locale.
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  const response = NextResponse.next();
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
  // (pinned by src/__tests__/middlewareAuthGate.test.ts and
  // backend/tests/test_page_gates_match_the_backend.py), and
  // `CodenamePermission` on every API the pages call. Middleware cannot
  // verify a role without decoding and trusting a JWT it has no key for, and
  // a guard that only hides links is not one.

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
