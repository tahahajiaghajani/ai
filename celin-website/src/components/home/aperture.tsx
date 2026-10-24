"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { mediaUrl, type Media } from "@/lib/media";
import type { Video } from "@/lib/video";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { gsap } from "@/components/fx/gsap";
import { Sparkles } from "@/components/fx/sparkles";
import { SlotVideo } from "@/components/fx/slot-video";
import { SplitWords } from "@/components/fx/split-words";
import { useGsap } from "@/components/fx/use-gsap";
import { Picture } from "@/components/ui/picture";

export interface ApertureData {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  media: Media;
  mobile: Media | null;
  video?: Video | null;
}

/**
 * The arch window: on the deep paraiba ground a small arch at the sill grows, as you scroll, into a tall
 * window onto the stone while the picture inside settles, the arcade lines spread and the words arrive (the
 * stage stays in view on large screens with a mouse — CSS sticky over --pin, globals.css .fx-pin — scrubbed as
 * it passes elsewhere). Only transforms move: the arch's own rounded clip never changes, so the picture cannot flash
 * outside it mid-scroll (a clip-path rewritten every frame did on phones). Without motion it is simply the
 * open window beside its text.
 */
export function Aperture({ lang, d }: { lang: Lang; d: ApertureData }) {
  const root = useRef<HTMLElement>(null);

  useGsap(
    () => {
      const mm = gsap.matchMedia();
      const build = (pin: boolean) => {
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          // pinned: the stage sticks (CSS) for --pin = 110vh; the timeline only scrubs over that distance
          scrollTrigger: pin ? { trigger: root.current, start: "top top", end: "+=110%", scrub: 0.8 } : { trigger: root.current, start: "top 85%", end: "center 45%", scrub: 0.8 },
        });
        // the arch grows from the sill and the picture settles inside it (2D transforms, nothing else changes)
        tl.fromTo("[data-ap='frame']", { scale: 0.58 }, { scale: 1, duration: 1, force3D: false }, 0)
          .fromTo("[data-ap='img']", { scale: 1.3 }, { scale: 1, duration: 1, force3D: false }, 0)
          .fromTo("[data-ap='lines']", { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9 }, 0.05)
          .fromTo("[data-ap='copy'] > *", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, stagger: 0.08 }, pin ? 0.55 : 0.5);
      };
      mm.add("(min-width: 1024px) and (hover: hover) and (pointer: fine)", () => build(true));
      mm.add("not all and (min-width: 1024px) and (hover: hover) and (pointer: fine)", () => build(false));
      return () => mm.revert();
    },
    root,
    [],
  );

  return (
    <section ref={root} data-tone="light" className="fx-pin relative isolate bg-night-teal text-on-night" style={{ "--pin": "110vh" } as CSSProperties}>
      <div className="fx-pin-stage isolate overflow-clip">
        <Aura palette="paraiba" light={0.8} />
        <Grain />
        {/* the night-2 foot of the band above melts into the teal; the light settles into plain teal night at the foot */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-night-2 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-night-teal" />
        <div className="container-lux relative grid min-h-[100svh] items-center gap-12 py-20 lg:grid-cols-12 lg:gap-8 lg:py-0">
          <div className="relative mx-auto w-[min(78vw,440px)] lg:order-2 lg:col-span-6 lg:w-[min(36vw,520px)]" data-cursor="view">
            <div data-ap="lines" className="absolute inset-x-[-38%] bottom-0 top-[-16%] origin-bottom">
              <ArchLines count={6} tone="champagne" className="size-full" />
            </div>
            <div data-ap="frame" className="arch relative aspect-[3/4] origin-bottom overflow-hidden">
              <div data-ap="img" className="absolute inset-0">
                <Picture media={d.media} mobile={d.mobile} lang={lang} sizes="(min-width: 1024px) 36vw, 78vw" className="absolute inset-0" />
                <Sparkles count={16} intensity={1.15} />
                {d.video && <SlotVideo video={d.video} poster={mediaUrl(d.media, 960)} position={`${d.media.fx}% ${d.media.fy}%`} />}
              </div>
            </div>
            <span aria-hidden className="absolute inset-x-[-14%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
          </div>
          <div data-ap="copy" className="relative text-center lg:order-1 lg:col-span-5 lg:col-start-1 lg:text-start">
            <p className="label text-gold-on-dark!">{d.eyebrow}</p>
            <SplitWords as="h2" text={d.title} className="display mt-4 text-4xl leading-[1.35]! font-bold sm:text-5xl lg:text-6xl" wordClassName="text-metal-light" />
            <p className="mx-auto mt-6 max-w-md text-lg leading-9 text-on-night-muted lg:mx-0">{d.body}</p>
            <div className="mt-9">
              <Link href={href(lang, d.href)} className="btn btn-line-light">
                {d.cta}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
