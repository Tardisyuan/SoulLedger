import type { Metadata } from "next";
import "../globals.css";

/** 演示:与根布局同一种写法,一条中性的英文,不随语言换(用户 2026-11-14)。正式版不变。 */
export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_DEMO_MODE === "1" ? "Sign in – SoulLedger" : "登录 - SoulLedger",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Auth pages use minimal layout without AppLayout sidebar/header
  // to avoid infinite refresh loops from menus query
  return (
    <div className="min-h-screen bg-[oklch(var(--color-canvas))]">
      {children}
    </div>
  );
}
