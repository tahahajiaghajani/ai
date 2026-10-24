"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatDate, num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { LuxFrame } from "@/components/ui/lux-frame";
import { Arch } from "@/components/fx/arch";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { ProCodeLink } from "@/components/pro/pro-code-link";
import { ProHallmark } from "@/components/pro/seal";
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

/**
 * The invitation to Pro on living cocoa light: a jewel-box frame of champagne rules with its keystone, the
 * arch picture with the PRO hallmark stamped on it, three promises in a ledger of small arches, two ways in.
 * A member sees that prices are shown to them instead.
 */
export function ProInvite({ lang, d }: { lang: Lang; d: ProInviteData }) {
  const me = useMe();
  const active = Boolean(me?.pro.active);
  const c = commonCopy(lang);
  return (
    <section data-tone="light" className="relative isolate overflow-clip bg-night-2 py-20 text-on-night sm:py-28">
      <Aura palette="cocoa" light={0.9} />
      <Grain />
      <div className="container-lux relative">
        <LuxFrame tone="dark" keystone className="bg-night/30 px-5 pt-14 pb-12 backdrop-blur-[2px] sm:px-10 sm:py-14 lg:px-16 lg:py-20">
          <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(45%_70%_at_85%_40%,rgb(233_185_138/0.16),transparent_70%),radial-gradient(50%_60%_at_0%_100%,rgb(15_86_82/0.22),transparent_70%)] rtl:bg-[radial-gradient(45%_70%_at_15%_40%,rgb(233_185_138/0.16),transparent_70%),radial-gradient(50%_60%_at_100%_100%,rgb(15_86_82/0.22),transparent_70%)]" />
          <div className="relative grid items-center gap-14 lg:grid-cols-12 lg:gap-12">
            <div className="relative mx-auto w-[min(62vw,300px)] lg:order-2 lg:col-span-4 lg:col-start-9 lg:w-full lg:max-w-[340px]">
              <Arch media={d.media} lang={lang} sizes="(min-width: 1024px) 26vw, 62vw" ring="champagne" keystone unveil sparkle={10} />
              <span aria-hidden className="absolute inset-x-[-14%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
              <span className="absolute -bottom-9 -start-7 block drop-shadow-[0_18px_30px_rgb(0_0_0/0.5)] sm:-start-10" data-reveal style={{ "--d": 2 } as CSSProperties}>
                <ProHallmark className="size-24 sm:size-28" />
              </span>
            </div>

            <div className="relative text-center lg:col-span-7 lg:text-start">
              <p className="flex items-center justify-center gap-3 font-label text-xs tracking-[0.36em] text-gold-on-dark lg:justify-start">
                <span aria-hidden className="h-px w-8 bg-[image:var(--metal-champagne)]" />
                <span className="ltr">CELIN PRO</span>
              </p>
              <p className="label mt-4 text-on-night-muted!">{d.eyebrow}</p>
              <SplitWords text={d.title} className="display mt-3 text-4xl leading-[1.4]! font-bold sm:text-5xl" wordClassName="text-metal-light" />
              <p className="mx-auto mt-6 max-w-xl text-lg leading-9 text-on-night-muted lg:mx-0">{d.body}</p>

              <ul className="mx-auto mt-10 grid max-w-xl border-y border-night-line sm:grid-cols-3 lg:mx-0">
                {d.perks.map((p, i) => (
                  <li key={p} className="flex items-center gap-4 border-night-line py-4 text-start not-last:border-b sm:flex-col sm:gap-3 sm:px-4 sm:py-6 sm:text-center sm:not-last:border-e sm:not-last:border-b-0">
                    <span aria-hidden className="relative grid h-11 w-9 shrink-0 place-items-center">
                      <span className="arch absolute inset-0 border border-b-0 border-gold-on-dark/45" />
                      {/* Bodoni's figures in English; Persian digits in Nazli (font-display leads with it on Persian pages —
                          a Latin stack would hand them to its local Times New Roman fallback first) */}
                      <span className={`mt-2 ${lang === "en" ? "font-didone" : "font-display"} text-sm text-gold-on-dark tabular-nums`}>{num(i + 1, lang)}</span>
                    </span>
                    <span className="font-ui text-sm leading-7 text-on-night">{p}</span>
                  </li>
                ))}
              </ul>

              <div className="mx-auto mt-10 flex max-w-xs flex-col items-stretch gap-x-4 gap-y-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center lg:mx-0 lg:justify-start">
                {active ? (
                  <>
                    <Link href={href(lang, "/shop")} className="btn btn-metal btn-lg">
                      {d.member}
                    </Link>
                    <p className="flex items-center gap-2.5 font-ui text-sm text-on-night-muted">
                      <span aria-hidden className="size-1.5 rotate-45 bg-gold-glow" />
                      {c.proBar.activeText}
                      {me?.pro.expiresAt && <span className="text-xs">· {c.proSheet.until(formatDate(me.pro.expiresAt, lang))}</span>}
                    </p>
                  </>
                ) : (
                  <>
                    <Magnetic className="w-full sm:w-auto">
                      <Link href={href(lang, d.href)} className="btn btn-metal btn-lg w-full sm:w-auto">
                        {d.cta}
                      </Link>
                    </Magnetic>
                    <ProCodeLink lang={lang} className="btn btn-line-light btn-lg">
                      {d.code}
                    </ProCodeLink>
                  </>
                )}
              </div>
            </div>
          </div>
        </LuxFrame>
      </div>
    </section>
  );
}
