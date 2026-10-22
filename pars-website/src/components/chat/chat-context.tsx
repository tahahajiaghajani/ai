"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Copy } from "@/content/fa";
import type { Lang } from "@/lib/i18n";
import { lockScroll } from "@/lib/scroll-lock";

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "done" | "error";
  logId?: string;
  rating?: 1 | -1;
  /** the site's own "assistant not available" text: shown, but never sent back to the model or rated */
  offline?: boolean;
}

interface ChatApi {
  lang: Lang;
  t: Copy["chat"];
  greeting: string;
  suggestions: string[];
  supportHref: string;
  contactHref: string;
  open: boolean;
  messages: ChatMsg[];
  busy: boolean;
  /** Opens the chat and sends `q`; false when nothing was sent (empty, or an answer is still streaming). */
  ask: (q: string) => boolean;
  show: () => void;
  hide: () => void;
  stop: () => void;
  reset: () => void;
  rate: (id: string, rating: 1 | -1) => void;
  prefetch: () => void;
}

const Ctx = createContext<ChatApi | null>(null);

export function useChat(): ChatApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useChat outside ChatProvider");
  return c;
}

const loadPanel = () => import("@/components/chat/chat-panel");
const ChatPanel = dynamic(loadPanel, { ssr: false });

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** same note the chat route appends when the provider breaks off */
const CUT_OFF: Record<Lang, string> = { fa: "\n\n…پاسخ ناتمام ماند. لطفاً دوباره بپرسید.", en: "\n\n…The answer was cut off. Please ask again." };

/**
 * What an answer shows when its stream ends early: what arrived (stopped by the visitor, or cut off
 * with a note, so it stays on screen and in the history), else the localized error — never the
 * browser's own message ("Failed to fetch", "Load failed").
 */
export function endedEarly(acc: string, o: { stopped: boolean; error: string; lang: Lang }): Pick<ChatMsg, "content" | "status"> {
  if (o.stopped) return { content: acc, status: "done" };
  const kept = acc.replace(/\[\[[^\]]*$/, "").trimEnd();
  return kept ? { content: kept + CUT_OFF[o.lang], status: "done" } : { content: o.error, status: "error" };
}

export function ChatProvider(props: { lang: Lang; t: Copy["chat"]; greeting: string; suggestions: string[]; supportHref: string; contactHref: string; children: ReactNode }) {
  const { lang, t } = props;
  const storeKey = `pars-chat-${lang}`;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string>("");
  const messagesRef = useRef<ChatMsg[]>([]);
  messagesRef.current = messages;

  // restore the conversation of this tab
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw) as { session: string; messages: ChatMsg[] };
        sessionRef.current = saved.session;
        setMessages(saved.messages.map((m) => (m.status === "streaming" ? { ...m, status: "done" } : m)));
      }
    } catch {}
    if (!sessionRef.current) sessionRef.current = uid();
  }, [storeKey]);

  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(storeKey, JSON.stringify({ session: sessionRef.current, messages: messages.slice(-30) }));
    } catch {}
  }, [messages, busy, storeKey]);

  // pause the hero shader and lock page scroll while the chat is open — already before the lazy
  // panel has loaded; it is the shared counted lock, so the «demos» action never unlocks the sheet
  useEffect(() => {
    if (!open) return;
    const d = document.documentElement;
    d.dataset.chat = "open";
    const unlock = lockScroll();
    return () => {
      delete d.dataset.chat;
      unlock();
    };
  }, [open]);

  const patch = useCallback((id: string, p: Partial<ChatMsg>) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
  }, []);

  // runs synchronously up to the fetch, so abortRef is set before ask() returns
  const send = useCallback(
    async (text: string) => {
      const history = messagesRef.current.filter((m) => m.status !== "error" && !m.offline && m.content);
      const user: ChatMsg = { id: uid(), role: "user", content: text.slice(0, 4000), status: "done" };
      const answer: ChatMsg = { id: uid(), role: "assistant", content: "", status: "streaming", logId: uid() };
      setMessages((ms) => [...ms, user, answer]);
      setBusy(true);
      const ac = new AbortController();
      abortRef.current = ac;
      let acc = "";
      let failure = t.errorNet;
      let frame = 0;
      const flush = () => {
        frame = 0;
        patch(answer.id, { content: acc });
      };
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [...history, user].map(({ role, content }) => ({ role, content })), lang, sessionId: sessionRef.current, logId: answer.logId }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          // a platform 5xx page (timeout, crash) is the service failing, not the visitor's connection
          failure = j.error === "rate" ? t.errorRate : j.error === "busy" || res.status >= 500 ? t.errorBusy : t.errorNet;
          throw new Error(failure);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          if (!frame) frame = requestAnimationFrame(flush);
        }
        cancelAnimationFrame(frame);
        patch(answer.id, { content: acc, status: "done", ...(res.headers.get("x-pars-offline") ? { offline: true, logId: undefined } : {}) });
      } catch {
        cancelAnimationFrame(frame);
        patch(answer.id, endedEarly(acc, { stopped: ac.signal.aborted, error: failure, lang }));
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [lang, patch, t],
  );

  // stable callbacks: the panel's open effect depends on hide, so it must not change per streamed chunk
  const ask = useCallback(
    (q: string) => {
      const text = q.trim();
      if (!text) return false;
      setMounted(true);
      setOpen(true);
      if (abortRef.current) return false;
      void send(text);
      return true;
    },
    [send],
  );

  const show = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = uid();
    setMessages([]);
  }, []);

  const rate = useCallback(
    (id: string, rating: 1 | -1) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (!m?.logId || m.rating) return;
      const logId = m.logId;
      patch(id, { rating });
      // roll back when the save can't go out, so the buttons come back for another try
      void import("@/app/actions/support")
        .then(({ rateAnswer }) => rateAnswer({ logId, rating }))
        .catch(() => patch(id, { rating: undefined }));
    },
    [patch],
  );

  const prefetch = useCallback(() => void loadPanel(), []);

  const api = useMemo<ChatApi>(
    () => ({
      lang,
      t,
      greeting: props.greeting,
      suggestions: props.suggestions,
      supportHref: props.supportHref,
      contactHref: props.contactHref,
      open,
      messages,
      busy,
      ask,
      show,
      hide,
      stop,
      reset,
      rate,
      prefetch,
    }),
    [lang, t, props.greeting, props.suggestions, props.supportHref, props.contactHref, open, messages, busy, ask, show, hide, stop, reset, rate, prefetch],
  );

  return (
    <Ctx.Provider value={api}>
      {props.children}
      {mounted && <ChatPanel />}
      <ChatLauncher />
    </Ctx.Provider>
  );
}

/**
 * Floating button that reopens the assistant from anywhere on the page. It stays mounted (only
 * faded out under the chat) and keeps its focus while the chat opens, so closing hands focus back
 * to it — unmounting it, or hiding it with display:none, would drop focus to <body>.
 */
function ChatLauncher() {
  const { open, show, prefetch, t, messages } = useChat();
  return (
    <button
      type="button"
      onClick={show}
      onPointerEnter={prefetch}
      aria-label={t.open}
      data-open={open || undefined}
      tabIndex={open ? -1 : undefined}
      className="group fixed bottom-5 end-5 z-40 flex items-center gap-2.5 rounded-full border border-line-strong bg-ink-3/80 py-2 ps-2 pe-4 text-sm font-semibold text-fg shadow-[0_18px_50px_-12px_rgb(223_17_115/0.55)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-pink/50 data-[open]:pointer-events-none data-[open]:opacity-0"
    >
      <span className="relative grid size-9 place-items-center rounded-full bg-reverse">
        <svg viewBox="0 0 24 24" className="size-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
          <path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z" />
        </svg>
        {messages.length > 0 && <span className="absolute -top-0.5 -end-0.5 size-2.5 rounded-full bg-success ring-2 ring-ink" />}
      </span>
      <span className="hidden sm:inline">{t.title}</span>
    </button>
  );
}
