"use client";

import { useEffect, useRef, useState } from "react";
import { useChat, type ChatMsg } from "@/components/chat/chat-context";
import { Markdown } from "@/components/chat/markdown";
import { parseMarkers, type ChatAction } from "@/lib/markers";

/** Full-screen conversation, like opening ChatGPT or Claude. Loaded on first use. */
export default function ChatPanel() {
  const { open, hide, messages, busy, ask, stop, reset, t, greeting, suggestions } = useChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hide]);

  // follow the stream unless the reader scrolled up
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    if (!draft.trim() || busy) return;
    stick.current = true;
    ask(draft);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "";
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      data-open={open || undefined}
      inert={!open}
      className="pointer-events-none fixed inset-0 z-[60] opacity-0 transition-opacity duration-500 data-[open]:pointer-events-auto data-[open]:opacity-100"
    >
      <div className="absolute inset-0 bg-ink/92 backdrop-blur-xl" onClick={hide} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(143_134_255/0.16),transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[45vh] bg-[radial-gradient(50%_60%_at_50%_100%,rgb(223_17_115/0.13),transparent_70%)]" />

      <div className="relative mx-auto flex h-full max-w-4xl translate-y-4 scale-[0.985] flex-col px-4 transition-transform duration-700 ease-[var(--ease-out-expo)] [[data-open]_&]:translate-y-0 [[data-open]_&]:scale-100 sm:px-6">
        {/* top bar */}
        <header className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <span className="relative grid size-10 place-items-center rounded-2xl border border-line-strong bg-ink-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/pars-mark-reverse.svg" alt="" className="h-6 w-auto" />
              <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full bg-success ring-2 ring-ink" />
            </span>
            <div className="leading-tight">
              <div className="font-bold">{t.title}</div>
              <div className="text-xs text-muted">{t.subtitle}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {messages.length > 0 && (
              <button type="button" onClick={reset} className="rounded-full px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-fg">
                {t.newChat}
              </button>
            )}
            <button type="button" onClick={hide} aria-label={t.close} className="grid size-10 place-items-center rounded-full border border-line text-muted transition hover:border-line-strong hover:text-fg">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        {/* conversation */}
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="scroll-thin -mx-2 flex-1 overflow-y-auto px-2 pb-6"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <Welcome greeting={greeting} suggestions={suggestions} onPick={(s) => ask(s)} />
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-7 pt-4">
              {messages.map((m) => (
                <li key={m.id}>{m.role === "user" ? <UserBubble text={m.content} /> : <Answer m={m} />}</li>
              ))}
            </ol>
          )}
        </div>

        {/* composer */}
        <div className="mx-auto w-full max-w-3xl pb-4 sm:pb-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="ring-border flex items-end gap-2 rounded-[1.75rem] p-2 shadow-[0_24px_80px_-24px_rgb(223_17_115/0.45)]"
          >
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              maxLength={4000}
              dir="auto"
              placeholder={t.placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="max-h-[200px] min-h-12 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-7 text-fg outline-none placeholder:text-faint focus-visible:outline-none"
            />
            {busy ? (
              <button type="button" onClick={stop} aria-label={t.stop} className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10 text-fg transition hover:bg-white/15">
                <span className="size-3.5 rounded-[3px] bg-current" />
              </button>
            ) : (
              <button type="submit" aria-label={t.send} disabled={!draft.trim()} className="grid size-12 shrink-0 place-items-center rounded-full bg-magenta text-white transition enabled:hover:bg-magenta-deep disabled:opacity-40">
                <SendIcon />
              </button>
            )}
          </form>
          <p className="mt-2.5 text-center text-[11px] leading-5 text-faint">{t.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Welcome({ greeting, suggestions, onPick }: { greeting: string; suggestions: string[]; onPick: (s: string) => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center py-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/pars-mark-reverse.svg" alt="" className="h-16 w-auto animate-float" />
      <p className="mt-6 text-lg leading-9 text-fg/90 sm:text-xl">{greeting}</p>
      <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
        {suggestions.slice(0, 4).map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="card rounded-2xl px-4 py-3.5 text-start text-sm leading-6 text-muted transition hover:border-line-strong hover:text-fg">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-[1.4rem] rounded-ee-md bg-ink-4 px-4.5 py-3 text-[15px] leading-7 text-fg">
        {text}
      </div>
    </div>
  );
}

function Answer({ m }: { m: ChatMsg }) {
  const { t, rate, hide, supportHref, contactHref } = useChat();
  const [copied, setCopied] = useState(false);
  const parsed = parseMarkers(m.content);
  const streaming = m.status === "streaming";

  const runAction = (a: ChatAction) => {
    if (a === "demos") {
      hide();
      window.dispatchEvent(new CustomEvent("pars:demos"));
    } else if (a === "contact") {
      hide();
      window.location.assign(contactHref);
    }
  };

  return (
    <div className="flex gap-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-line bg-ink-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pars-mark-reverse.svg" alt="" className="h-4.5 w-auto" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-[15px] text-fg/95">
        {m.status === "error" ? (
          <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-fg">{m.content}</p>
        ) : !parsed.text && streaming ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-pink" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            {t.thinking}
          </span>
        ) : (
          <div className={streaming ? "streaming" : undefined}>
            <Markdown text={parsed.text} />
          </div>
        )}

        {!streaming && m.status !== "error" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {parsed.actions.map((a) =>
              a === "ticket" ? (
                <a key={a} href={supportHref} className="rounded-full bg-magenta px-4 py-2 text-sm font-semibold text-white transition hover:bg-magenta-deep">
                  {t.actions.ticket}
                </a>
              ) : (
                <button key={a} type="button" onClick={() => runAction(a)} className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold text-fg transition hover:border-pink/60">
                  {t.actions[a]}
                </button>
              ),
            )}
            <span className="ms-auto flex items-center gap-1 text-faint">
              <IconBtn
                label={copied ? t.copied : t.copy}
                onClick={() => {
                  void navigator.clipboard?.writeText(parsed.text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <path d="M5 12l5 5L20 7" /> : <path d="M9 9h10v10H9zM5 15V5h10" />}
              </IconBtn>
              {m.rating ? (
                <span className="px-2 text-xs">{t.thanks}</span>
              ) : (
                <>
                  <IconBtn label={t.good} onClick={() => rate(m.id, 1)}>
                    <path d="M7 11v9H4v-9zM7 11l4-8c1.7 0 2.5 1 2.2 2.6L12.6 10H19a2 2 0 012 2.3l-1.2 6A2 2 0 0117.8 20H7" />
                  </IconBtn>
                  <IconBtn label={t.bad} onClick={() => rate(m.id, -1)}>
                    <path d="M17 13V4h3v9zM17 13l-4 8c-1.7 0-2.5-1-2.2-2.6l.6-4.4H5a2 2 0 01-2-2.3l1.2-6A2 2 0 016.2 4H17" />
                  </IconBtn>
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid size-8 place-items-center rounded-lg transition hover:bg-white/5 hover:text-fg">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
