import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { ThemeProvider } from "@/src/contexts/ThemeContext";
import { TenantProvider } from "@/src/contexts/TenantContext";
import { QueryProvider } from "@/src/components/providers/QueryProvider";
import { AppLayoutWrapper } from "@/src/components/layout/AppLayoutWrapper";
import { ProgressBar } from "@/src/components/ui/progress-bar";

export const metadata: Metadata = {
  title: "SoulLedger",
  description: "Cross-civilization soul management system",
  icons: {
    icon: "/icon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hans" className="dark">
      <body className="antialiased min-h-screen">
        <QueryProvider>
          <ProgressBar />
          <I18nProvider>
            <ThemeProvider>
              <TenantProvider>
                <ToastProvider>
                  <AppLayoutWrapper>
                    {children}
                  </AppLayoutWrapper>
                </ToastProvider>
              </TenantProvider>
            </ThemeProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
