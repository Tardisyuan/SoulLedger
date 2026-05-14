"use client";

import { usePathname } from "next/navigation";
import { AppLayout } from "./AppLayout";

const AUTH_PATHS = ["/login", "/register"];

export function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));

  if (isAuthPage) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
