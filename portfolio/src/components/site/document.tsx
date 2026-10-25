import type { Lang } from "@/lib/i18n";

/**
 * Runs before the first paint: the saved theme (dark by default), and the `js` flag that lets scroll reveals start
 * hidden only when they can be played. `js-loading` hides the hero until the intro has run (removed by the intro,
 * or after 4 s by this script, so a script error never leaves the page blank).
 */
const BOOT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("theme");if(t==="light")d.dataset.theme="light"}catch(e){}d.classList.add("js","js-loading");setTimeout(function(){d.classList.remove("js-loading")},4000)})()`;

export function Document({ lang, fonts, children }: { lang: Lang; fonts: string; children: React.ReactNode }) {
  return (
    <html lang={lang} dir={lang === "fa" ? "rtl" : "ltr"} className={fonts} suppressHydrationWarning>
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="grain">{children}</body>
    </html>
  );
}
