import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "SoulLedger — Cross-Civilization Soul Management",
  description:
    "Unified afterlife management across Chinese, European, and Egyptian mythological systems",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hans" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Egyptian+Hieroglyphs&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <I18nProvider>
          <NavBar />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
