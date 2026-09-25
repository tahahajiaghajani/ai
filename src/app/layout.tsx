import type { Metadata, Viewport } from "next";
import { Vazirmatn } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const vazir = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazir", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TaskFlow AI — اتوماسیون هوشمند کارها", template: "%s · TaskFlow AI" },
  description: "مدیریت، ارکستراسیون چندعاملی و اتوماسیون تسک‌ها با Gemini و Claude",
  applicationName: "TaskFlow AI",
  appleWebApp: { capable: true, title: "TaskFlow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070a14" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
  ],
};

// Applies the saved/system theme before paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('tf-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark')}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={`${vazir.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="app-backdrop min-h-full antialiased">
        {children}
        <Toaster dir="rtl" position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-vazir)" } }} />
      </body>
    </html>
  );
}
