import type { Lang } from "@/lib/i18n";

/**
 * Runs before the first paint: the saved theme (dark by default; a light one also gets its own theme-color meta, put
 * first, because editing the server's would make hydration add a second), and the `js` flag that lets scroll reveals
 * start hidden only when they can be played. On the first page of a visit with motion allowed, `intro` shows the
 * opening curtain from the first paint (see Preloader). The intro drops `js-loading` and `intro`, or this script does
 * after 4 s, so a script error or a slow start never leaves the page covered.
 */
const BOOT = `(function(){var d=document.documentElement;try{if(localStorage.getItem("theme")==="light"){d.dataset.theme="light";var m=document.createElement("meta");m.name="theme-color";m.content="#f3f3ef";document.head.prepend(m)}}catch(e){}var i=false;try{i=!matchMedia("(prefers-reduced-motion: reduce)").matches&&sessionStorage.getItem("intro")!=="1"}catch(e){}d.classList.add("js","js-loading");if(i)d.classList.add("intro");setTimeout(function(){d.classList.remove("js-loading","intro")},4000)})()`;

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
