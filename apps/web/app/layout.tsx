import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CIL-rcc-tracker",
  description: "Filesystem snapshot explorer",
  icons: {
    icon: "/logo_tracker.png",
    apple: "/logo_tracker.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light">
      <body className="font-mono antialiased terminal-texture">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
