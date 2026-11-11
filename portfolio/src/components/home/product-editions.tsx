"use client";

import { useId, useState } from "react";
import type { Edition, EditionKind } from "@/content/types";
import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { PROFILE } from "@/content/profile";
import { ArrowUpRightIcon, DesktopIcon, GlobeIcon, LockIcon, ServerIcon } from "@/components/brand/icons";
import { useLenis } from "@/components/fx/motion";
import { openRequest } from "@/lib/open-request";

const ICON: Record<EditionKind, (p: { className?: string; strokeWidth?: number }) => React.ReactNode> = {
  web: GlobeIcon,
  windows: DesktopIcon,
  server: ServerIcon,
};

/**
 * A product's editions: the web version opens live in a new tab; the others are locked on purpose. A locked edition
 * is a real button (never disabled, so it can be focused and tapped) that opens a note with a ready request and
 * direct contacts.
 */
export function ProductEditions({ product, editions, lang }: { product: string; editions: Edition[]; lang: Lang }) {
  const lenis = useLenis();
  const id = useId();
  const [asked, setAsked] = useState<EditionKind | null>(null);
  const fa = lang === "fa";
  const c = PROFILE.contact;
  const locked = editions.filter((e) => !e.href);
  const name = (k: EditionKind) => ui.product[k][lang];
  const request = (k: EditionKind) =>
    openRequest(lang, { kind: "demo", seed: ui.product.seed[lang].replace("{edition}", name(k)).replace("{product}", product) }, lenis);

  return (
    <div>
      <p className="eyebrow eyebrow-fa mb-4">{ui.product.editions[lang]}</p>
      <ul className="grid gap-2.5">
        {editions.map((e) => {
          const Icon = ICON[e.kind];
          const body = (
            <>
              <span className={`grid size-11 shrink-0 place-items-center rounded-full border ${e.href ? "border-current/25" : "border-line-strong"}`}>
                <Icon className="size-[1.15rem]" strokeWidth={1.3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-snug">{name(e.kind)}</span>
                <span className={`mt-1 block text-[0.8rem] leading-relaxed ${e.href ? "opacity-70" : "text-muted"}`}>{e.note[lang]}</span>
              </span>
            </>
          );
          return (
            <li key={e.kind}>
              {e.href ? (
                <a
                  href={e.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-cursor-label={ui.product.open[lang]}
                  className="group flex items-center gap-4 rounded-[12px] bg-fg px-4 py-4 text-bg transition-transform duration-500 ease-[var(--ease-out-expo)] hover:scale-[1.015] md:px-5"
                >
                  {body}
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`hidden items-center gap-1.5 sm:flex ${fa ? "text-[0.75rem]" : "font-mono text-[0.62rem] uppercase tracking-[0.16em]"}`}>
                      <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
                      {ui.product.live[lang]}
                    </span>
                    <span className="grid size-9 place-items-center rounded-full bg-bg text-fg transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                      <ArrowUpRightIcon className="size-3.5" />
                    </span>
                  </span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setAsked((k) => (k === e.kind ? null : e.kind))}
                  aria-expanded={asked === e.kind}
                  aria-controls={`${id}-locked`}
                  className={`flex w-full items-center gap-4 rounded-[12px] border border-dashed px-4 py-4 text-start transition-colors md:px-5 ${asked === e.kind ? "border-fg" : "border-line-strong hover:border-fg"}`}
                >
                  {body}
                  <span className={`flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-muted ${fa ? "text-[0.75rem]" : "font-mono text-[0.62rem] uppercase tracking-[0.16em]"}`}>
                    <LockIcon className="size-3" strokeWidth={1.5} />
                    {ui.product.locked[lang]}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {locked.length ? (
        <p className="mt-4 flex items-start gap-2 text-[0.8rem] leading-relaxed text-muted">
          <LockIcon className="mt-[0.3em] size-3 shrink-0" strokeWidth={1.5} />
          {ui.product.lockedNote[lang]}
        </p>
      ) : null}

      {/* the note opens with the grid-rows trick, so its height animates without measuring */}
      <div id={`${id}-locked`} className={`grid transition-[grid-template-rows] duration-500 ease-[var(--ease-out-expo)] ${asked ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden" inert={!asked}>
          <div className="mt-4 rounded-[12px] border border-line-strong p-5" role="region" aria-label={ui.product.lockedTitle[lang]}>
            <p className="font-semibold">
              {ui.product.lockedTitle[lang]}
              {asked ? <span className="text-muted"> · {name(asked)}</span> : null}
            </p>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-fg-2">{ui.product.lockedBody[lang]}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => asked && request(asked)} className="rounded-full bg-fg px-5 py-2.5 text-[0.85rem] font-semibold text-bg transition-transform hover:scale-[1.03]">
                {ui.product.request[lang]}
              </button>
              <a href={c.telegram} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line-strong px-4 py-2.5 text-[0.82rem] transition-colors hover:bg-fg hover:text-bg">
                {fa ? "تلگرام" : "Telegram"}
              </a>
              <a href={`mailto:${c.email}`} className="rounded-full border border-line-strong px-4 py-2.5 text-[0.82rem] transition-colors hover:bg-fg hover:text-bg">
                {fa ? "ایمیل" : "Email"}
              </a>
              <a href={`tel:${c.phone}`} dir="ltr" className="rounded-full border border-line-strong px-4 py-2.5 text-[0.82rem] transition-colors hover:bg-fg hover:text-bg">
                {c.phoneDisplay.en}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
