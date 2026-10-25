"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { href } from "@/lib/i18n";
import { parseMarkers, type ChatAction } from "@/lib/markers";
import { ui } from "@/content/ui";
import { PROFILE } from "@/content/profile";
import { Mark } from "@/components/brand/logo";
import { CrossIcon } from "@/components/brand/icons";
import { Prose } from "@/components/work/prose";
import { useChat, type Msg } from "@/components/chat/chat-context";

/** Opens the request form (on the home page) with the visitor's last question as a starting point. */
export function requestFromChat(lang: "fa" | "en", seed: string) {
  try {
    sessionStorage.setItem("request:seed", seed.slice(0, 1500));
  } catch {}
  const home = href(lang, "/");
  if (location.pathname === home) {
    window.dispatchEvent(new Event("request:seed"));
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
  } else {
    location.href = `${home}#contact`;
  }
}

function Actions({ actions, lastQuestion }: { actions: ChatAction[]; lastQuestion: string }) {
  const { lang, works, setOpen } = useChat();
  const [showContact, setShowContact] = useState(false);
  if (!actions.length) return null;
  const c = PROFILE.contact;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a, i) => {
          if (a.kind === "work") {
            const w = works.find((x) => x.slug === a.slug);
            if (!w) return null;
            return (
              <Link key={i} href={href(lang, `/work/${a.slug}`)} onClick={() => setOpen(false)} className="group flex items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[0.78rem] hover:bg-fg hover:text-bg">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] opacity-60">{ui.work.view[lang]}</span>
                {w.title}
              </Link>
            );
          }
          if (a.kind === "ticket") {
            return (
              <button key={i} type="button" onClick={() => (setOpen(false), requestFromChat(lang, lastQuestion))} className="rounded-full bg-fg px-3.5 py-1.5 text-[0.78rem] font-semibold text-bg">
                {ui.chat.actionTicket[lang]}
              </button>
            );
          }
          return (
            <button key={i} type="button" onClick={() => setShowContact((v) => !v)} aria-expanded={showContact} className="rounded-full border border-line-strong px-3.5 py-1.5 text-[0.78rem] hover:border-fg">
              {ui.chat.actionContact[lang]}
            </button>
          );
        })}
      </div>
      {showContact ? (
        <div className="grid gap-1 rounded-[6px] border border-line p-3 text-[0.82rem]">
          <a href={`mailto:${c.email}`} dir="ltr" className="link-draw w-fit">{c.email}</a>
          <a href={`tel:${c.phone}`} dir="ltr" className="link-draw w-fit">{c.phoneDisplay.en}</a>
          <a href={c.telegram} target="_blank" rel="noopener noreferrer" className="link-draw w-fit">Telegram ↗</a>
        </div>
      ) : null}
    </div>
  );
}

function Bubble({ m, lastQuestion, streaming }: { m: Msg; lastQuestion: string; streaming: boolean }) {
  const { lang } = useChat();
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-ee-[4px] bg-fg px-4 py-2.5 text-[0.92rem] leading-relaxed text-bg">{m.content}</p>
      </div>
    );
  }
  const parsed = parseMarkers(m.content);
  // a reply stopped before its first word (or saved while waiting) has nothing to show
  if (!parsed.text && !parsed.actions.length && !streaming) return null;
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-line-strong">
        <Mark className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {parsed.text ? (
          <div className="text-[0.92rem]">
            <Prose text={parsed.text} />
          </div>
        ) : streaming ? (
          <Thinking label={ui.chat.thinking[lang]} />
        ) : null}
        {!streaming ? <Actions actions={parsed.actions} lastQuestion={lastQuestion} /> : null}
      </div>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 py-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted" role="status">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse-dot rounded-full bg-fg" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
      {label}
    </p>
  );
}

/** The conversation itself: header, messages, suggestions and the composer. */
export function ChatPanel({ className = "", onClose, tall = false }: { className?: string; onClose?: () => void; tall?: boolean }) {
  const { lang, messages, busy, send, stop, reset } = useChat();
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // the home page renders two panels (inline and in the launcher), so each needs its own id
  const inputId = useId();
  const fa = lang === "fa";

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    send(text);
    setText("");
  };
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-bg text-fg ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative grid size-9 place-items-center rounded-full bg-fg text-bg">
            <Mark className="size-4" />
            <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-bg bg-fg" />
          </span>
          <div className="leading-tight">
            <p className="text-[0.92rem] font-semibold">{ui.chat.title[lang]}</p>
            <p className="text-[0.7rem] text-muted">{ui.chat.subtitle[lang]}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length ? (
            <button type="button" onClick={reset} className="rounded-full px-3 py-1.5 text-[0.72rem] text-muted hover:text-fg">
              {ui.chat.reset[lang]}
            </button>
          ) : null}
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={ui.nav.close[lang]} className="grid size-9 place-items-center rounded-full border border-line hover:border-fg">
              <CrossIcon className="size-3.5" strokeWidth={1.4} />
            </button>
          ) : null}
        </div>
      </div>

      <div ref={list} className={`flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 ${tall ? "min-h-[320px]" : ""}`} data-lenis-prevent aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-4">
            <p className="max-w-[40ch] text-[0.95rem] leading-relaxed text-fg-2">
              {fa ? "سلام! من دستیار هوشمند طاها هستم. درباره‌ی پروژه‌ها، تخصص‌ها و اینکه طاها برای سازمان شما چه می‌تواند بسازد بپرسید." : "Hi — I'm Taha's AI. Ask about his projects, his expertise, or what he could build for your organisation."}
            </p>
            <div className="flex flex-wrap gap-2">
              {ui.chat.suggestions[lang].map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-start text-[0.78rem] text-fg-2 transition-colors hover:border-fg hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={m.id} m={m} lastQuestion={lastQuestion} streaming={busy && i === messages.length - 1} />)
        )}
      </div>

      <form onSubmit={submit} className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-[8px] border border-line bg-bg-2 p-2 focus-within:border-fg">
          <label className="sr-only" htmlFor={inputId}>{ui.chat.placeholder[lang]}</label>
          <textarea
            id={inputId}
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
            }}
            rows={1}
            maxLength={2000}
            placeholder={ui.chat.placeholder[lang]}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-6 outline-none placeholder:text-faint md:text-[0.95rem]"
          />
          {busy ? (
            <button type="button" onClick={stop} className="grid size-10 shrink-0 place-items-center rounded-[6px] border border-line-strong" aria-label={fa ? "توقف" : "Stop"}>
              <span className="size-3 bg-current" />
            </button>
          ) : (
            <button type="submit" disabled={!text.trim()} className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-fg text-bg transition-opacity disabled:opacity-30" aria-label={ui.chat.send[lang]}>
              <span aria-hidden className={fa ? "-scale-x-100" : ""}>→</span>
            </button>
          )}
        </div>
        <p className="mt-2 px-1 text-[0.66rem] text-faint">{ui.chat.disclaimer[lang]}</p>
      </form>
    </div>
  );
}
