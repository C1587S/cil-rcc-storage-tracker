import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import "./globals.css";

const basePath = "/cil-rcc-tracker";

export const metadata: Metadata = {
  title: "CRC",
  description: "CIL RCC Console",
  icons: {
    icon: [
      { url: `${basePath}/favicon-32x32.png`, sizes: "32x32", type: "image/png" },
      { url: `${basePath}/favicon-16x16.png`, sizes: "16x16", type: "image/png" },
    ],
    apple: `${basePath}/apple-touch-icon.png`,
  },
  manifest: `${basePath}/site.webmanifest`,
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
