"use client";

import { usePathname } from "next/navigation";
import { AppLayout } from "./AppLayout";
import { DeskShell } from "@/src/components/desk/DeskShell";

// Prefix match (`/login` covers `/login/verify`). The guards read these two arrays from this
// source (src/__tests__/support/appRoutes.ts, backend/tests/web_routes.py), so keep them one-line
// string literals; every entry must be a page under app/ (`/register` had none, removed 2026-11-10).
const AUTH_PATHS = ["/login"];
// Homepage is public. `/verdict-print` is the verdict PDF's print page, opened only by the headless renderer:
// no shell (and no AppLayout session handling) around the one document it prints.
// `/goodbye` is the farewell shown right after signing out (2026-11-10): no shell, no session.
const PUBLIC_PATHS = ["/", "/verdict-print", "/goodbye"];
// 案卷台与总簿(Design 第三十批 第 2 步,prefix match):signed in like any other page, but in their own full-bleed shell
// with the door rail (`DeskShell`) instead of AppLayout's sidebar, toolbar and title row. The global sidebar's redesign is step 4.
const DESK_PATHS = ["/desk"];

export function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (isAuthPage || isPublicPage) {
    return <>{children}</>;
  }

  if (DESK_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
    return <DeskShell>{children}</DeskShell>;
  }

  return <AppLayout>{children}</AppLayout>;
}
