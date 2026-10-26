import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { themeBootScript } from "@/lib/prefs";

export const metadata: Metadata = {
  title: "REC Smart Audio — رسملة الطاقة للمقاولات",
  description: "نظام الإذاعة الداخلية والأذان الذكي",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1a21" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
