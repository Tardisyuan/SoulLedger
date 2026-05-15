"use client";

import { usePathname } from "next/navigation";
import { AppLayout } from "./AppLayout";

const AUTH_PATHS = ["/login", "/register"];
const PUBLIC_PATHS = ["/"];  // Homepage is public

export function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (isAuthPage || isPublicPage) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
