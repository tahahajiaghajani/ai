"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatDate, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Overlay } from "@/components/ui/overlay";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { CodeInput } from "@/components/pro/code-input";
import { ProSeal } from "@/components/pro/pro-bar";
import { useMe } from "@/components/pro/session";

/**
 * The Pro sheet, mounted once per page: «ورود کد Pro» | «درخواست اشتراک». Opened with openProSheet().
 * It opens on a cocoa band with the copper seal under an arcade, then the code field or the request path.
 */
export function ProSheet({ lang }: { lang: Lang }) {
  const c = commonCopy(lang);
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"code" | "request">("code");
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const on = (e: Event) => {
      setTab((e as CustomEvent<{ tab: "code" | "request" }>).detail?.tab ?? "code");
      setOpen(true);
    };
    window.addEventListener("celin:pro-sheet", on);
    return () => window.removeEventListener("celin:pro-sheet", on);
  }, []);

  const here = typeof window === "undefined" ? href(lang, "/") : window.location.pathname + window.location.search;
  const active = me?.pro.active;

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      <Overlay open={open} onClose={() => setOpen(false)} label={c.proSheet.title} closeLabel={c.nav.close}>
        <div className="pb-8">
          <div data-tone="light" className="relative isolate overflow-hidden bg-night-2 px-5 pt-9 pb-8 text-center text-on-night sm:px-8">
            <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-cocoa" />
            <Grain />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-2 bottom-0">
              <ArchLines count={4} tone="champagne" immediate className="size-full opacity-60" />
            </div>
            <ProSeal large className="relative" />
            <p className="display relative mt-5 text-3xl leading-[1.45]! font-bold text-metal-light">{c.proSheet.title}</p>
            <p className="relative mx-auto mt-2 max-w-sm text-sm leading-7 text-on-night-muted">{c.proSheet.intro}</p>
          </div>

          <div className="px-5 sm:px-8">
            {active ? (
              <p className="mt-7 border border-gold/40 bg-gold-mist px-4 py-3 font-ui text-sm text-gold-text">
                {c.proSheet.activeNote}
                {me?.pro.expiresAt ? ` ${c.proSheet.until(formatDate(me.pro.expiresAt, lang))}` : ""}
              </p>
            ) : (
              <>
                <div role="tablist" className="mt-6 grid grid-cols-2 border-b border-gold/20 font-ui text-sm">
                  {(["code", "request"] as const).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      type="button"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={`-mb-px h-12 border-b-2 transition-colors duration-300 ${tab === t ? "border-gold text-ink" : "border-transparent text-muted hover:text-ink"}`}
                    >
                      {t === "code" ? c.proSheet.tabCode : c.proSheet.tabRequest}
                    </button>
                  ))}
                </div>
                <div className="pt-6">
                  {tab === "code" ? (
                    <CodeInput
                      lang={lang}
                      next={here}
                      autoFocus
                      onDone={() => {
                        setAnnounce(c.proSheet.announce);
                        setOpen(false);
                        router.refresh();
                      }}
                    />
                  ) : me?.pro.request === "pending" ? (
                    <p className="text-sm leading-7 text-ink-2">{c.proSheet.pendingNote}</p>
                  ) : me ? (
                    <div className="space-y-4">
                      <p className="text-sm leading-7 text-ink-2">{c.proBar.signedIn}</p>
                      <Link href={`${href(lang, "/pro")}#request`} onClick={() => setOpen(false)} className="btn btn-metal w-full">
                        {c.proSheet.requestGo}
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm leading-7 text-ink-2">{c.proSheet.requestIntro}</p>
                      <Link
                        href={`${href(lang, "/account/login")}?next=${encodeURIComponent(`${href(lang, "/pro")}#request`)}`}
                        onClick={() => setOpen(false)}
                        className="btn btn-metal w-full"
                      >
                        {c.proSheet.requestCta}
                      </Link>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Overlay>
    </>
  );
}
