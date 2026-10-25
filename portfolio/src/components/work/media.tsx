import Image from "next/image";
import type { Media as MediaData } from "@/content/types";
import type { Lang } from "@/lib/i18n";
import { Art } from "@/components/work/art";

/** One picture, video or generative cover, optionally framed as a browser window or a phone. */
export function Media({ m, lang, sizes = "100vw", priority = false, className = "", fill = false }: { m: MediaData; lang: Lang; sizes?: string; priority?: boolean; className?: string; fill?: boolean }) {
  if (m.kind === "art") {
    return (
      <div className={`relative overflow-hidden ${fill ? "size-full" : "aspect-[4/3]"} ${className}`} role="img" aria-label={m.alt[lang]}>
        <Art kind={m.art} seed={m.art.length * 13 + 5} />
      </div>
    );
  }
  if (m.kind === "video") {
    return (
      <video
        className={`w-full ${fill ? "size-full object-cover" : "h-auto"} ${className}`}
        src={m.src}
        poster={m.poster}
        width={m.w}
        height={m.h}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        aria-label={m.alt[lang]}
      />
    );
  }
  const img = fill ? (
    <Image src={m.src} alt={m.alt[lang]} fill sizes={sizes} priority={priority} quality={82} className={`object-cover ${m.tone === "mono" ? "mono-media" : ""}`} />
  ) : (
    <Image src={m.src} alt={m.alt[lang]} width={m.w} height={m.h} sizes={sizes} priority={priority} quality={82} className={`h-auto w-full ${m.tone === "mono" ? "mono-media" : ""}`} />
  );
  if (m.frame === "browser") {
    return (
      <div className={`overflow-hidden rounded-[8px] border border-line bg-bg-2 ${className}`}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2" aria-hidden>
          <span className="size-2 rounded-full border border-line-strong" />
          <span className="size-2 rounded-full border border-line-strong" />
          <span className="size-2 rounded-full border border-line-strong" />
          <span className="mx-auto h-4 w-1/3 rounded-full bg-fg/[0.06]" />
        </div>
        <div className={fill ? "relative size-full" : ""}>{img}</div>
      </div>
    );
  }
  if (m.frame === "phone") {
    return (
      <div className={`mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] border-[6px] border-fg/90 bg-bg-2 ${className}`}>
        <div className={fill ? "relative size-full" : ""}>{img}</div>
      </div>
    );
  }
  return <div className={`relative overflow-hidden ${fill ? "size-full" : ""} ${className}`}>{img}</div>;
}

export function MediaFigure({ m, lang, sizes }: { m: MediaData; lang: Lang; sizes?: string }) {
  return (
    <figure data-fade className="group">
      <Media m={m} lang={lang} sizes={sizes} />
      {m.caption ? <figcaption className="mt-3 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-faint">{m.caption[lang]}</figcaption> : null}
    </figure>
  );
}
