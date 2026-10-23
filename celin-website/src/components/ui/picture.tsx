import type { CSSProperties } from "react";
import { altOf, mediaUrl, srcSet, type Media } from "@/lib/media";

/**
 * A responsive picture without an image optimiser: <img srcset> over the stored widths, a blurred tiny
 * preview painted behind it until it loads, and the focal point as object-position so every crop keeps the
 * jewel in view. With `ratio` the box keeps its shape before the file arrives (no layout shift).
 * `mobile` swaps in a separate phone picture below 768px (art direction via <picture>).
 */
export function Picture({
  media,
  mobile,
  lang = "fa",
  alt,
  sizes = "100vw",
  ratio,
  priority = false,
  className = "",
  imgClassName = "",
  style,
}: {
  media: Media | null | undefined;
  mobile?: Media | null;
  lang?: "fa" | "en";
  alt?: string;
  sizes?: string;
  /** e.g. "3/4", "4/5", "1/1"; omit when the parent sets the size */
  ratio?: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
  style?: CSSProperties;
}) {
  const boxStyle: CSSProperties = { ...(ratio ? { aspectRatio: ratio } : {}), ...style };
  // a box the parent places absolutely keeps its position (no competing `relative`)
  const position = /(^|\s)!?absolute!?(\s|$)/.test(className) ? "" : "relative";
  if (!media) return <div aria-hidden className={`bg-tile ${className}`} style={boxStyle} />;
  const text = alt ?? altOf(media, lang);
  const pos = `${media.fx}% ${media.fy}%`;
  const img = (
    <img
      src={mediaUrl(media, 960)}
      srcSet={srcSet(media)}
      sizes={sizes}
      width={media.width || undefined}
      height={media.height || undefined}
      alt={text}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      className={`absolute inset-0 size-full object-cover ${imgClassName}`}
      style={{ objectPosition: pos }}
    />
  );
  return (
    <div
      className={`${position} overflow-hidden bg-tile ${className}`}
      style={{ ...boxStyle, backgroundImage: media.placeholder ? `url("${media.placeholder}")` : undefined, backgroundSize: "cover", backgroundPosition: pos }}
    >
      {mobile ? (
        <picture>
          <source media="(max-width: 767px)" srcSet={srcSet(mobile)} sizes={sizes} />
          {img}
        </picture>
      ) : (
        img
      )}
    </div>
  );
}
