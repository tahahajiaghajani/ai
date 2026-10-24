"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { ArchDoor } from "@/components/ui/arch-door";
import { CodeInput, type CodeState } from "@/components/pro/code-input";
import { ProHallmark } from "@/components/pro/seal";
import { ProSteps } from "@/components/pro/steps";
import { StoreContact, contactLinks, type StoreContactInfo } from "@/components/account/contact";

/**
 * Entering the Pro code as a small ceremony: the night doorway with the PRO hallmark in its crown, the
 * 12 digits in three groups of four, the four steps (the last one lit), and who to call when no code came.
 * The hallmark turns and glows when the code is accepted. `steps={false}` where no code has been issued yet
 * (the doorway beside a request form): there the steps would claim the request and the approval are done.
 */
export function ProCodeCeremony({
  lang,
  title,
  lead,
  next,
  onDone,
  contact,
  headingLevel = 2,
  footer,
  steps = true,
  className = "",
}: {
  lang: Lang;
  title: string;
  lead: string;
  next?: string;
  onDone?: (r: { signedIn: boolean; next: string }) => void;
  contact?: StoreContactInfo;
  headingLevel?: 1 | 2;
  footer?: ReactNode;
  /** show the four membership steps (only once a code has been issued) */
  steps?: boolean;
  className?: string;
}) {
  const c = commonCopy(lang);
  const [state, setState] = useState<CodeState>("idle");
  const H = headingLevel === 1 ? "h1" : "h2";
  const links = contact ? contactLinks(contact, lang) : null;
  return (
    <div data-pro-state={state} data-tone="light" className={className}>
      <ArchDoor tone="night" crown={<ProHallmark className="size-[6.5rem] sm:size-28" />} bodyClassName="px-6 pt-[clamp(3rem,12vw,4rem)] pb-9 sm:px-10 sm:pb-11">
        <div className="mt-5 text-center">
          <p className="label flex items-center justify-center gap-2.5 text-gold-on-dark!">
            <span aria-hidden className="size-1 rotate-45 bg-current" />
            {c.proBar.eyebrow}
            <span aria-hidden className="size-1 rotate-45 bg-current" />
          </p>
          <H className="title-section mt-2 text-metal-light">{title}</H>
          <p className="mx-auto mt-2 max-w-xs font-ui text-sm leading-7 text-on-night-muted">{lead}</p>
        </div>
        <div className="mt-8">
          <CodeInput lang={lang} next={next} tone="night" hideLabel onState={setState} onDone={onDone} />
        </div>
        {steps && <ProSteps lang={lang} current={state === "ok" ? 4 : 3} tone="night" className="mt-9" />}
        <div className="mt-7 flex flex-col items-center gap-1 border-t border-night-line pt-6 text-center font-ui text-sm text-on-night-muted">
          <p>{c.proSheet.noCode}</p>
          {contact && links && (links.tel || links.wa) ? (
            <StoreContact contact={contact} lang={lang} tone="night" className="justify-center" />
          ) : (
            <Link href={href(lang, "/contact")} className="btn-link btn-link-light">
              {c.proSheet.contact}
            </Link>
          )}
          {footer}
        </div>
      </ArchDoor>
    </div>
  );
}
