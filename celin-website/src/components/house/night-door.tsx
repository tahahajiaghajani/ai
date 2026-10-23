import type { CSSProperties, ReactNode } from "react";
import type { Lang } from "@/lib/format";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { SplitWords } from "@/components/fx/split-words";
import { Eyebrow, RhombusDigits } from "@/components/house/bits";

/**
 * The night doorway shared by the 404 and error pages: a deep arcade of champagne hairlines that draws
 * itself in, a large numeral or mark at its heart, and the words beneath. Everything plays at first paint
 * (pure CSS), so it also works on the global 404, which has no reveal observer. `children` = the actions.
 */
export function NightDoor({
  lang,
  code,
  eyebrow,
  title,
  body,
  background,
  under = false,
  top,
  children,
}: {
  lang: Lang;
  /** a numeral in the doorway (404); omit for a copper rhombus */
  code?: string;
  eyebrow: string;
  title: string;
  body: string;
  /** e.g. <Aura/>; defaults to the espresso mesh */
  background?: ReactNode;
  /** sits under the transparent header (site pages) */
  under?: boolean;
  /** above the doorway (the logo on the global 404, which has no header) */
  top?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      data-header={under ? "dark" : undefined}
      data-tone="light"
      className={`relative isolate flex min-h-[100svh] items-center overflow-clip bg-mesh-espresso text-on-night ${under ? "-mt-[var(--header-h)] pt-[var(--header-h)]" : ""}`}
    >
      {background}
      <Grain />
      <div className="container-lux relative flex flex-col items-center py-16 text-center">
        {top}
        <div className="relative grid aspect-[4/3] w-[min(86vw,520px)] place-items-end justify-center">
          <ArchLines count={6} tone="champagne" immediate delay={80} className="pointer-events-none absolute inset-0 size-full" />
          <span aria-hidden className="absolute inset-x-[-8%] bottom-0 block h-px bg-[image:var(--metal-champagne)] opacity-60" />
          <div className="relative pb-[9%]">
            {code ? (
              <RhombusDigits
                text={code}
                lang={lang}
                className="display text-[clamp(6.5rem,26vw,11rem)] leading-[1.1] font-bold text-metal-light metal-live"
                zeroClassName="drop-shadow-[0_0_18px_rgb(233_185_138/0.35)]"
              />
            ) : (
              <svg aria-hidden viewBox="0 0 10 14" className="h-24 w-auto drop-shadow-[0_0_24px_rgb(233_185_138/0.35)] sm:h-28">
                <defs>
                  <linearGradient id="door-rh" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" style={{ stopColor: "var(--color-gold-deep)" }} />
                    <stop offset="0.45" style={{ stopColor: "var(--color-gold-bright)" }} />
                    <stop offset="0.6" style={{ stopColor: "var(--color-gold-glow)" }} />
                    <stop offset="1" style={{ stopColor: "var(--color-gold)" }} />
                  </linearGradient>
                </defs>
                <path d="M5 0 10 7 5 14 0 7Z" fill="url(#door-rh)" />
              </svg>
            )}
          </div>
        </div>
        <Eyebrow tone="light" center className="mt-10" style={{ animation: "fade-in 0.9s var(--ease-lux) 0.5s both" } as CSSProperties}>
          {eyebrow}
        </Eyebrow>
        <SplitWords as="h1" text={title} immediate delay={350} className="display mt-4 text-[clamp(2.2rem,8vw,3rem)] leading-[1.35]! font-bold sm:text-6xl" wordClassName="text-metal-light" />
        <p className="mx-auto mt-5 max-w-lg text-lg leading-9 text-on-night-muted" style={{ animation: "fade-in 0.9s var(--ease-lux) 0.8s both" }}>
          {body}
        </p>
        {children && (
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-4" style={{ animation: "fade-in 0.9s var(--ease-lux) 1s both" }}>
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
