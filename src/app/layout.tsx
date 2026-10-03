import type { Metadata, Viewport } from "next";
import { Sora, Vazirmatn } from "next/font/google";
import { Toaster } from "sonner";
import { BrandIntro } from "@/components/shell/brand-intro";
import { bootScript } from "@/components/shell/boot-script";
import "./globals.css";

const vazir = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazir", display: "swap" });
// brand typeface (Latin): wordmark, signature and Latin display text
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap", weight: ["300", "400", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "Task Flow", template: "%s · Task Flow" },
  description: "تسک‌دهی و انجام هوشمند کارها — By Taha Aghajani",
  applicationName: "Task Flow",
  authors: [{ name: "Taha Aghajani" }],
  appleWebApp: { capable: true, title: "Task Flow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060a13" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={`${vazir.variable} ${sora.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="app-backdrop min-h-full antialiased">
        <BrandIntro />
        {children}
        <Toaster dir="rtl" position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-vazir)" } }} />
      </body>
    </html>
  );
}
