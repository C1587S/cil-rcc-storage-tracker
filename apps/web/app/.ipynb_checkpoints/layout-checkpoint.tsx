import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CIL-RCC-TRACKER",
  description: "Filesystem snapshot explorer",
  icons: {
    icon: "/favicon/favicon.svg",
    shortcut: "/favicon/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-mono antialiased terminal-texture">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
