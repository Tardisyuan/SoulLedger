"use client";

import { usePathname } from "next/navigation";
import { AppLayout } from "./AppLayout";

const AUTH_PATHS = ["/login", "/register"];
// Homepage is public. `/verdict-print` is the verdict PDF's print page, opened only by the headless renderer:
// no shell (and no AppLayout session handling) around the one document it prints.
const PUBLIC_PATHS = ["/", "/verdict-print"];

export function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (isAuthPage || isPublicPage) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
