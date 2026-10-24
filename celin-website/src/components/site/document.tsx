import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { BootScript } from "@/components/site/boot-script";

export function Document({ lang, fonts, children }: { lang: Lang; fonts: string; children: ReactNode }) {
  return (
    <html lang={lang} dir={lang === "fa" ? "rtl" : "ltr"} className={fonts} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <BootScript />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
