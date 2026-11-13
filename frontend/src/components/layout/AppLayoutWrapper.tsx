"use client";

import { usePathname } from "next/navigation";
import { AppLayout } from "./AppLayout";

// Prefix match (`/login` covers `/login/verify`). The guards read these two arrays from this
// source (src/__tests__/support/appRoutes.ts, backend/tests/web_routes.py), so keep them one-line
// string literals; every entry must be a page under app/ (`/register` had none, removed 2026-11-10).
const AUTH_PATHS = ["/login"];
// Homepage is public. `/verdict-print` is the verdict PDF's print page, opened only by the headless renderer:
// no shell (and no AppLayout session handling) around the one document it prints.
// `/goodbye` is the farewell shown right after signing out (2026-11-10): no shell, no session.
const PUBLIC_PATHS = ["/", "/verdict-print", "/goodbye"];
// 案卷台与总簿(Design 第三十批 第 2 步,prefix match):the same shell and door rail as every signed-in page (step 4),
// but `bare` — full-bleed, no toolbar (they carry their own head), so no 问一问 entry and no ⌘K there.
const DESK_PATHS = ["/desk"];

export function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (isAuthPage || isPublicPage) {
    return <>{children}</>;
  }

  const bare = DESK_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  return <AppLayout bare={bare}>{children}</AppLayout>;
}
