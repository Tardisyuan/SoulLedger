import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoulLedger — Cross-Civilization Soul Management",
  description: "Unified afterlife management across Chinese, European, and Egyptian mythological systems",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
