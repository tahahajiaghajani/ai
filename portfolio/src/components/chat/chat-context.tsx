"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** a fixed reply (assistant offline, error): shown, never sent back as history */
  local?: boolean;
}

interface ChatState {
  lang: Lang;
  messages: Msg[];
  busy: boolean;
  open: boolean;
  works: { slug: string; title: string }[];
  setOpen: (v: boolean) => void;
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
}

const Ctx = createContext<ChatState | null>(null);

export function useChat(): ChatState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useChat outside ChatProvider");
  return c;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * One conversation per visit and language, shared by the inline assistant and the floating launcher, kept in
 * sessionStorage so it survives navigation. Answers stream in as plain text.
 */
export function ChatProvider({ lang, works, children }: { lang: Lang; works: { slug: string; title: string }[]; children: React.ReactNode }) {
  const key = `chat:${lang}`;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const session = useRef("");

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) setMessages(JSON.parse(saved));
      session.current = sessionStorage.getItem("chat:session") || uid();
      sessionStorage.setItem("chat:session", session.current);
    } catch {
      session.current = uid();
    }
  }, [key]);

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [key, messages]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const user: Msg = { id: uid(), role: "user", content: q.slice(0, 4000) };
      const reply: Msg = { id: uid(), role: "assistant", content: "" };
      const history = [...messages.filter((m) => !m.local && m.content), user].map(({ role, content }) => ({ role, content }));
      setMessages((m) => [...m, user, reply]);
      setBusy(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      const write = (content: string, local = false) => setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, content, local } : x)));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history, lang, sessionId: session.current, logId: reply.id }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = res.status === 429 ? ui.chat.rate[lang] : res.status === 503 ? ui.chat.busy[lang] : ui.chat.error[lang];
          write(err, true);
          return;
        }
        const offline = res.headers.get("x-offline") === "1";
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          write(acc, offline);
        }
        acc += dec.decode();
        write(acc || ui.chat.error[lang], offline || !acc);
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") write(ui.chat.error[lang], true);
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, lang, messages],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
  }, []);

  return <Ctx.Provider value={{ lang, messages, busy, open, works, setOpen, send, stop, reset }}>{children}</Ctx.Provider>;
}
