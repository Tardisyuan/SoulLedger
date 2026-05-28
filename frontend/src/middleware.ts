import { NextRequest, NextResponse } from "next/server";

const LOCALE_COOKIE = "soulledger-locale";
const SUPPORTED_LOCALES = ["zh-Hans", "en", "egy"];
const DEFAULT_LOCALE = "zh-Hans";

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

  // Auth guard: check for refresh token cookie (access token is in sessionStorage, inaccessible to middleware)
  const refreshToken = request.cookies.get("soulledger_refresh")?.value;
  if (!refreshToken && !isPublicPath(pathname)) {
    const loginUrl = new URL("/welcome", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
