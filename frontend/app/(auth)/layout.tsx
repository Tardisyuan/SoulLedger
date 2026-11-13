import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { localeFromBrowser } from "@/proxy";
import "../globals.css";

/** 标签页标题跟界面语言走;与根布局的 `generateMetadata` 同一条规则(只在演示里读 cookie,正式版保持原样)。 */
export async function generateMetadata(): Promise<Metadata> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "1") return { title: "登录 - SoulLedger" };
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : localeFromBrowser((await headers()).get("accept-language"));
  return { title: locale === "zh-Hans" ? "登录 - SoulLedger" : "Sign in - SoulLedger" };
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Auth pages use minimal layout without AppLayout sidebar/header
  // to avoid infinite refresh loops from menus query
  return (
    <div className="min-h-screen bg-[oklch(var(--color-canvas))]">
      {children}
    </div>
  );
}
