"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatDate, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Overlay, OverlayLink } from "@/components/ui/overlay";
import { ArchLines } from "@/components/fx/arch-lines";
import { finePointer } from "@/components/fx/motion";
import { Grain } from "@/components/fx/grain";
import { CodeInput, type CodeState } from "@/components/pro/code-input";
import { ProHallmark } from "@/components/pro/seal";
import { useMe } from "@/components/pro/session";
import { ProSteps } from "@/components/pro/steps";

/**
 * The Pro sheet, mounted once per page: «ورود کد Pro» | «درخواست اشتراک». Opened with openProSheet().
 * The private salon: an espresso panel, the PRO hallmark under an arcade of champagne hairlines, then the
 * 12-digit code in its cells — or the way to membership with its four steps. The hallmark turns and glows
 * when a code is accepted, then the sheet closes and the prices fade in.
 */
export function ProSheet({ lang }: { lang: Lang }) {
  const c = commonCopy(lang);
  const s = c.proSheet;
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"code" | "request">("code");
  const [announce, setAnnounce] = useState("");
  const [codeState, setCodeState] = useState<CodeState>("idle");
  const [unlocked, setUnlocked] = useState(false);
  // the code field takes the focus when the sheet opens or its tab is clicked, not while arrowing over the tabs — and
  // only with a mouse: on a phone the keyboard would jump up over the sheet before it is even seen
  const [via, setVia] = useState<"open" | "pointer" | "keyboard">("open");
  const base = useId();
  const openRef = useRef(false);
  openRef.current = open;

  // a code accepted elsewhere (the login page, the account): a short unlock moment that survives the navigation
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      if (openRef.current) return;
      setUnlocked(true);
      clearTimeout(t);
      t = setTimeout(() => setUnlocked(false), 3600);
    };
    window.addEventListener("celin:pro-unlocked", on);
    return () => {
      window.removeEventListener("celin:pro-unlocked", on);
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      setTab((e as CustomEvent<{ tab: "code" | "request" }>).detail?.tab ?? "code");
      setVia("open");
      setCodeState("idle");
      setOpen(true);
    };
    window.addEventListener("celin:pro-sheet", on);
    return () => window.removeEventListener("celin:pro-sheet", on);
  }, []);

  const here = typeof window === "undefined" ? href(lang, "/") : window.location.pathname + window.location.search;
  const active = me?.pro.active;
  const tabs = ["code", "request"] as const;

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      {unlocked && (
        <div role="status" data-pro-state="ok" data-tone="light" className="pro-unlocked pointer-events-none fixed inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-[80] flex justify-center px-4 sm:bottom-auto sm:top-[calc(var(--header-h)+1.25rem)]">
          <div className="lux-frame relative flex w-full max-w-md items-center gap-4 overflow-hidden bg-night-2/95 px-5 py-4 text-on-night shadow-[0_30px_60px_-30px_rgb(0_0_0/0.7)] backdrop-blur-md" data-frame="dark">
            <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-cocoa opacity-80" />
            <ProHallmark className="size-14 shrink-0" />
            <p className="font-ui text-sm leading-7">
              <span className="block title-card text-metal-light">{c.proBar.active}</span>
              {s.success}
            </p>
          </div>
        </div>
      )}
      <Overlay open={open} onClose={() => setOpen(false)} label={s.title} closeLabel={c.nav.close} tone="night" wide>
        {/* stacked on phones; from md up two columns — the hallmark beside the form — so a laptop never scrolls it */}
        <div data-pro-state={codeState} className="relative isolate min-h-full md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-center">
          <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-cocoa" />
          <Grain />

          <div className="relative px-5 pt-8 pb-6 text-center sm:px-9 sm:pt-10 md:flex md:h-full md:flex-col md:items-center md:justify-center md:border-e md:border-night-line md:px-8 md:py-10">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-2 h-56 md:inset-y-6 md:h-auto">
              <ArchLines count={4} tone="champagne" immediate className="size-full opacity-45" />
            </div>
            <ProHallmark className="relative mx-auto size-24 sm:size-28" />
            <p className="title-section relative mt-5 text-metal-light">{s.title}</p>
            <p className="relative mx-auto mt-1 max-w-sm font-ui text-sm leading-7 text-on-night-muted">{s.intro}</p>
          </div>

          <div className="relative px-5 pb-9 sm:px-9 md:py-9">
            {active ? (
              <div className="frame-metal relative bg-white/5 px-5 py-4 text-center font-ui text-sm leading-7 text-on-night">
                {s.activeNote}
                {me?.pro.expiresAt && <span className="block text-xs text-on-night-muted">{s.until(formatDate(me.pro.expiresAt, lang))}</span>}
              </div>
            ) : (
              <>
                <div role="tablist" aria-label={s.title} className="relative grid grid-cols-2 border-b border-night-line font-ui text-sm" style={{ "--t": tabs.indexOf(tab) } as CSSProperties}>
                  {tabs.map((t) => (
                    <button
                      key={t}
                      id={`${base}-tab-${t}`}
                      role="tab"
                      type="button"
                      aria-selected={tab === t}
                      aria-controls={`${base}-panel`}
                      tabIndex={tab === t ? 0 : -1}
                      onClick={() => {
                        setVia("pointer");
                        setTab(t);
                      }}
                      onKeyDown={(e) => {
                        const dir = document.documentElement.dir === "rtl" ? -1 : 1;
                        const step = e.key === "ArrowRight" ? dir : e.key === "ArrowLeft" ? -dir : e.key === "Home" || e.key === "End" ? 1 : 0;
                        if (!step) return;
                        e.preventDefault();
                        const next = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
                        setVia("keyboard");
                        setTab(next);
                        document.getElementById(`${base}-tab-${next}`)?.focus();
                      }}
                      className={`h-12 transition-colors duration-300 ${tab === t ? "text-on-night" : "text-on-night-muted hover:text-on-night"}`}
                    >
                      {t === "code" ? s.tabCode : s.tabRequest}
                    </button>
                  ))}
                  {/* a champagne rule that slides under the open tab, its keystone in the middle */}
                  <span aria-hidden className="absolute -bottom-px h-px w-1/2 bg-[image:var(--metal-champagne)] transition-[inset-inline-start] duration-500 ease-[var(--ease-out-expo)]" style={{ insetInlineStart: "calc(var(--t) * 50%)" }}>
                    <span className="absolute top-0 left-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-gold-glow" />
                  </span>
                </div>

                <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`} className="pt-6">
                  {tab === "code" ? (
                    <CodeInput
                      lang={lang}
                      next={here}
                      autoFocus={via !== "keyboard" && finePointer()}
                      tone="night"
                      hideLabel
                      onState={setCodeState}
                      onDone={() => {
                        setAnnounce(s.announce);
                        setOpen(false);
                        router.refresh();
                      }}
                    />
                  ) : me?.pro.request === "pending" ? (
                    <div className="space-y-6">
                      <ProSteps lang={lang} current={1} tone="night" />
                      <p className="font-ui text-sm leading-7 text-on-night-muted">{s.pendingNote}</p>
                      <OverlayLink href={href(lang, "/account/pro")} className="btn-link btn-link-light">
                        {c.proBar.statusCta}
                      </OverlayLink>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <ProSteps lang={lang} current={0} tone="night" />
                      <p className="font-ui text-sm leading-7 text-on-night-muted">{me ? c.proBar.signedIn : s.requestIntro}</p>
                      {me ? (
                        <OverlayLink href={`${href(lang, "/pro")}#request`} className="btn btn-metal btn-lg w-full">
                          {s.requestGo}
                        </OverlayLink>
                      ) : (
                        <OverlayLink href={`${href(lang, "/account/login")}?tab=signup&next=${encodeURIComponent(`${href(lang, "/pro")}#request`)}`} className="btn btn-metal btn-lg w-full">
                          {s.requestCta}
                        </OverlayLink>
                      )}
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
