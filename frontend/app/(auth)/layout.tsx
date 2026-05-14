import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "登录 - SoulLedger",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Auth pages use minimal layout without AppLayout sidebar/header
  // to avoid infinite refresh loops from menus query
  return (
    <div className="min-h-screen bg-canvas">
      {children}
    </div>
  );
}
