"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { errorCopy } from "@/content/copy/errors";
import { Aura } from "@/components/fx/aura";
import { Magnetic } from "@/components/fx/magnetic";
import { NightDoor } from "@/components/house/night-door";

/** A page that failed to render (src/app/…/(site)/error.tsx): the night doorway, «try again» and home. */
export function ErrorView({ lang, error, retry }: { lang: Lang; error: Error & { digest?: string }; retry: () => void }) {
  const c = errorCopy[lang].error;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main>
      <NightDoor lang={lang} under eyebrow={c.eyebrow} title={c.title} body={c.body} background={<Aura palette="cocoa" light={0.85} />}>
        <Magnetic>
          <button type="button" onClick={() => retry()} className="btn btn-metal h-13 px-8">
            {c.retry}
          </button>
        </Magnetic>
        <Link href={href(lang, "/")} className="btn btn-line-light h-13">
          {c.home}
        </Link>
      </NightDoor>
      {error.digest && (
        <p className="bg-night pb-8 text-center text-xs text-on-night-muted">
          {c.ref}: <span className="ltr font-label">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
