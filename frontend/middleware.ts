import { NextRequest, NextResponse } from "next/server";

const LOCALE_COOKIE = "soulledger-locale";
const SUPPORTED_LOCALES = ["zh-Hans", "en", "egy"];
const DEFAULT_LOCALE = "zh-Hans";

// Routes that don't require authentication
const PUBLIC_PATHS = ["/", "/welcome", "/(auth)/login", "/(auth)/register"];

// Routes that require ADMIN role (checked via localStorage in client)
const ADMIN_PATHS = ["/admin", "/permissions", "/menus"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname === p.replace("(auth)/", "")
  );
}

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((p) => pathname.startsWith(p));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Locale handling
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale =
    cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;

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

  // Admin route guard: add header for client-side verification
  // (Server-side role check requires JWT decode which middleware can't do)
  if (isAdminPath(pathname) && refreshToken) {
    response.headers.set("X-Requires-Admin", "true");
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
