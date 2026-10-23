import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

/** Runs before first paint: enables reveal effects and restores the visitor's motion preference. */
// html.js, the saved motion choice, and data-moved once the visitor scrolls (anchor-scroll.tsx then keeps their place)
const BOOT = `(function(){var d=document.documentElement;d.classList.add('js');try{if(localStorage.getItem('pars-motion')==='reduced')d.dataset.motion='reduced'}catch(e){}var m=function(){d.dataset.moved='1'};['wheel','touchstart','keydown'].forEach(function(t){addEventListener(t,m,{passive:true,once:true})})})();`;

export function Document({ lang, fonts, children }: { lang: Lang; fonts: string; children: ReactNode }) {
  return (
    <html lang={lang} dir={lang === "fa" ? "rtl" : "ltr"} className={fonts} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
