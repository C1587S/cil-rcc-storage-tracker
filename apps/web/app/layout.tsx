import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CIL-rcc-tracker",
  description: "Filesystem snapshot explorer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-mono antialiased terminal-texture">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
