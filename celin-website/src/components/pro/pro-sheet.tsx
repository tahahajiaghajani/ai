"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatDate, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Overlay } from "@/components/ui/overlay";
import { CodeInput } from "@/components/pro/code-input";
import { useMe } from "@/components/pro/session";

/** The Pro sheet, mounted once per page: «ورود کد Pro» | «درخواست اشتراک». Opened with openProSheet(). */
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
        <div className="px-5 pt-6 pb-8 sm:px-8">
          <p className="display text-2xl">{c.proSheet.title}</p>
          <p className="mt-2 text-sm leading-7 text-muted">{c.proSheet.intro}</p>
          {active ? (
            <p className="mt-6 border border-gold/40 bg-gold-mist px-4 py-3 text-sm text-gold-text">
              {c.proSheet.activeNote}
              {me?.pro.expiresAt ? ` ${c.proSheet.until(formatDate(me.pro.expiresAt, lang))}` : ""}
            </p>
          ) : (
            <>
              <div role="tablist" className="mt-6 grid grid-cols-2 border-b border-line text-sm">
                {(["code", "request"] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    type="button"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`-mb-px h-11 border-b ${tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
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
                    <Link href={`${href(lang, "/pro")}#request`} onClick={() => setOpen(false)} className="inline-flex h-12 w-full items-center justify-center bg-ink text-sm text-bone hover:bg-ink-2">
                      {c.proSheet.requestGo}
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm leading-7 text-ink-2">{c.proSheet.requestIntro}</p>
                    <Link
                      href={`${href(lang, "/account/login")}?next=${encodeURIComponent(`${href(lang, "/pro")}#request`)}`}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-12 w-full items-center justify-center bg-ink text-sm text-bone hover:bg-ink-2"
                    >
                      {c.proSheet.requestCta}
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Overlay>
    </>
  );
}
