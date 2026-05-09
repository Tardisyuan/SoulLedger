import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TenantProvider } from "@/src/contexts/TenantContext";
import { QueryProvider } from "@/src/components/providers/QueryProvider";

export const metadata: Metadata = {
  title: "SoulLedger",
  description: "Cross-civilization soul management system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hans">
      <body className="antialiased">
        <QueryProvider>
          <I18nProvider>
            <TenantProvider>
              <ToastProvider>
                <nav className="fixed top-0 left-0 z-40 p-4">
                  <LanguageSwitcher />
                </nav>
                {children}
              </ToastProvider>
            </TenantProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
