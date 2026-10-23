import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

/**
 * Runs before first paint: enables reveal effects, restores the visitor's motion preference, and marks every
 * page view except the first home-page view of a session «intro-seen» (no intro curtain).
 */
const BOOT = `(function(){var d=document.documentElement;d.classList.add('js');try{if(localStorage.getItem('celin-motion')==='reduced')d.dataset.motion='reduced'}catch(e){}try{var s=sessionStorage,p=location.pathname.replace(/\\/$/,'');if(s.getItem('celin-intro')||(p!==''&&p!=='/en'))d.classList.add('intro-seen');s.setItem('celin-intro','1')}catch(e){d.classList.add('intro-seen')}})();`;

export function Document({ lang, fonts, children }: { lang: Lang; fonts: string; children: ReactNode }) {
  return (
    <html lang={lang} dir={lang === "fa" ? "rtl" : "ltr"} className={fonts} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
