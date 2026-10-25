"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { gsap } from "gsap";
import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { useChat } from "@/components/chat/chat-context";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useLenis } from "@/components/fx/motion";

/**
 * The assistant on every page: a pill at the reading end of the screen that opens the conversation as a panel
 * (a full-height sheet on phones). Hidden while the inline assistant on the home page is on screen.
 */
export function ChatLauncher({ lang }: { lang: Lang }) {
  const { open, setOpen, messages } = useChat();
  const panel = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const lenis = useLenis();
  const pathname = usePathname();

  // step aside while the inline assistant is visible
  useEffect(() => {
    const target = document.getElementById("ask");
    const p = pill.current;
    if (!target || !p) {
      if (p) gsap.to(p, { autoAlpha: 1, y: 0, duration: 0.4 });
      return;
    }
    const io = new IntersectionObserver(([e]) => gsap.to(p, { autoAlpha: e.isIntersecting ? 0 : 1, y: e.isIntersecting ? 20 : 0, duration: 0.4 }), { threshold: 0.2 });
    io.observe(target);
    return () => io.disconnect();
  }, [pathname]);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    if (open) {
      lenis?.stop();
      gsap.fromTo(el, { autoAlpha: 0, y: 24, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "expo.out" });
      setTimeout(() => el.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 200);
    } else {
      lenis?.start();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lenis, setOpen]);

  return (
    <>
      <button
        ref={pill}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`fixed bottom-5 end-5 z-40 flex items-center gap-3 rounded-full border border-line-strong bg-bg/95 py-2 pe-5 ps-2 text-fg shadow-[0_20px_60px_-20px_rgb(0_0_0/0.6)] transition-transform md:bg-glass md:backdrop-blur-xl hover:scale-[1.03] md:bottom-8 md:end-8 ${open ? "pointer-events-none opacity-0" : ""}`}
      >
        <span className="relative grid size-9 place-items-center rounded-full bg-fg text-bg">
          <span className="font-mono text-[0.62rem] font-bold">AI</span>
          <span className="absolute inset-0 animate-ping rounded-full border border-fg opacity-30" />
        </span>
        <span className="text-[0.85rem] font-medium">{ui.chat.open[lang]}</span>
        {messages.length ? <span className="size-1.5 rounded-full bg-fg" aria-hidden /> : null}
      </button>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ui.chat.title[lang]}
        hidden={!open}
        className="fixed inset-0 z-[85] md:inset-auto md:bottom-8 md:end-8 md:h-[min(680px,calc(100svh-4rem))] md:w-[420px]"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} aria-hidden />
        <div ref={panel} className="absolute inset-x-0 bottom-0 top-[8svh] md:inset-0">
          <ChatPanel className="size-full rounded-b-none shadow-[0_40px_120px_-30px_rgb(0_0_0/0.8)] md:rounded-[12px]" onClose={() => setOpen(false)} />
        </div>
      </div>
    </>
  );
}
