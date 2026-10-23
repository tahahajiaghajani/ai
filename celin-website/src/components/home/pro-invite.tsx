"use client";

import Link from "next/link";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { Arch } from "@/components/fx/arch";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { openProSheet } from "@/components/pro/events";
import { useMe } from "@/components/pro/session";

export interface ProInviteData {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  code: string;
  member: string;
  perks: string[];
  media: Media;
}

/** The invitation to Pro on living cocoa light: an arch picture, three promises, two ways in. */
export function ProInvite({ lang, d }: { lang: Lang; d: ProInviteData }) {
  const me = useMe();
  const active = Boolean(me?.pro.active);
  return (
    <section data-tone="light" className="relative isolate overflow-clip bg-night-2 py-20 text-on-night sm:py-28">
      <Aura palette="cocoa" light={0.9} />
      <Grain />
      <div className="container-lux relative">
        <div className="frame-metal relative grid items-center gap-10 overflow-hidden px-5 py-10 sm:px-10 sm:py-14 lg:grid-cols-12 lg:gap-12 lg:px-16 lg:py-16">
          <span aria-hidden className="absolute inset-0 bg-[radial-gradient(55%_70%_at_0%_0%,rgb(233_185_138/0.14),transparent_70%)]" />
          <div className="relative mx-auto w-[min(62vw,300px)] lg:order-2 lg:col-span-4 lg:col-start-9 lg:w-full">
            <Arch media={d.media} lang={lang} sizes="(min-width: 1024px) 26vw, 62vw" ring="champagne" keystone unveil sparkle={10} />
          </div>
          <div className="relative text-center lg:col-span-7 lg:text-start">
            <p className="font-label text-xs tracking-[0.36em] text-gold-on-dark ltr">PRO</p>
            <p className="label mt-3 text-on-night-muted!">{d.eyebrow}</p>
            <SplitWords text={d.title} className="display mt-4 text-4xl leading-[1.4]! font-bold sm:text-5xl" wordClassName="text-metal-light" />
            <p className="mx-auto mt-6 max-w-xl text-lg leading-9 text-on-night-muted lg:mx-0">{d.body}</p>
            <ul className="mx-auto mt-8 grid max-w-xl gap-3 text-start sm:grid-cols-3 lg:mx-0">
              {d.perks.map((p) => (
                <li key={p} className="flex items-start gap-2.5 border-t border-night-line pt-3 text-sm leading-7 text-on-night">
                  <svg viewBox="0 0 10 10" className="mt-2.5 size-1.5 shrink-0 text-gold-glow" aria-hidden>
                    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
              {active ? (
                <Link href={href(lang, "/shop")} className="btn btn-metal h-13 px-8">
                  {d.member}
                </Link>
              ) : (
                <>
                  <Magnetic>
                    <Link href={href(lang, d.href)} className="btn btn-metal h-13 px-8">
                      {d.cta}
                    </Link>
                  </Magnetic>
                  <button type="button" onClick={() => openProSheet("code")} className="btn btn-line-light h-13">
                    {d.code}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
