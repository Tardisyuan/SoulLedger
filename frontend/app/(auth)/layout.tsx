import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "登录 - SoulLedger",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
