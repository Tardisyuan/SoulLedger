import type { Metadata } from "next";
// CJK 两支:包自带的 index.css 各含 101 条 @font-face,每条带自己的 unicode-range,
// 浏览器只取页面真正用到的分片。必须在 globals.css 之前 import,让 Tailwind 的
// base 层能覆盖它们带来的任何默认值。见 app/fonts.ts 顶部关于为何不走 next/font/local。
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-serif-sc";
import "./globals.css";
import { fontVariables } from "./fonts";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { ThemeProvider } from "@/src/contexts/ThemeContext";
import { TenantProvider } from "@/src/contexts/TenantContext";
import { WebSocketProvider } from "@/src/contexts/WebSocketContext";
import { SocialEventBusProvider } from "@/hooks/useSocialEventBus";
import { QueryProvider } from "@/src/components/providers/QueryProvider";
import { AppLayoutWrapper } from "@/src/components/layout/AppLayoutWrapper";

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
    <html lang="zh-Hans" className={`dark ${fontVariables}`}>
      <body className="antialiased min-h-screen">
        <QueryProvider>
          <I18nProvider>
            <ThemeProvider>
              <TenantProvider>
                <WebSocketProvider>
                  <SocialEventBusProvider>
                    <ToastProvider>
                    <AppLayoutWrapper>
                      {children}
                    </AppLayoutWrapper>
                  </ToastProvider>
                  </SocialEventBusProvider>
                </WebSocketProvider>
              </TenantProvider>
            </ThemeProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
