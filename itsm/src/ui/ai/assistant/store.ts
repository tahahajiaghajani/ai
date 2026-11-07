// One conversation per business, kept outside React: an answer keeps streaming while the panel is closed or the
// page changes, and reopening the panel shows it where it is. Events are applied in batches once per frame.
import { useSyncExternalStore } from "react";
import type { AiPageContext, AiProposal, AiStreamEvent } from "@shared/ai/types";
import { errorText } from "../../lib/api";
import type { AiAttachmentInput, AiClient, RunHandlers, RunOutcome, RunPhase } from "../client";
import { applyEvent, blankMessage, fromView, settle, withProposal, type UiMessage } from "./state";

/** «elsewhere»: the open conversation's answer is being written by another tab or request (the panel waits for it) */
export type Phase = "idle" | "loading" | "elsewhere" | RunPhase;

export interface AssistantSnapshot {
  threadId: string | null;
  messages: UiMessage[];
  phase: Phase;
  loadError: string | null;
}

interface Ask {
  text: string;
  attachments: AiAttachmentInput[];
  context: AiPageContext | null;
}

const EMPTY: AssistantSnapshot = { threadId: null, messages: [], phase: "idle", loadError: null };

const raf: (f: () => void) => unknown = typeof requestAnimationFrame === "function" ? (f) => requestAnimationFrame(f) : (f) => setTimeout(f, 16);

export class AssistantStore {
  private snap: AssistantSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private ctl: AbortController | null = null;
  /** bumps when the conversation changes: late events of an older one are dropped */
  private seq = 0;
  private queue: AiStreamEvent[] = [];
  private scheduled = false;
  private last: Ask | null = null;
  /** an answer ended (the conversation list refreshes; a closed panel may say so) */
  onSettled: ((threadId: string | null, ok: boolean) => void) | null = null;

  constructor(private client: AiClient) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.snap;

  get busy(): boolean {
    const p = this.snap.phase;
    return p !== "idle" && p !== "loading" && p !== "elsewhere";
  }

  private emit(patch: Partial<AssistantSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- events, batched per frame
  private flush = () => {
    this.scheduled = false;
    if (!this.queue.length) return;
    let messages = this.snap.messages;
    let threadId = this.snap.threadId;
    for (const e of this.queue) {
      if (e.type === "meta" && e.thread_id) threadId = e.thread_id;
      messages = applyEvent(messages, e);
    }
    this.queue = [];
    this.emit({ messages, threadId });
  };

  private push(e: AiStreamEvent) {
    this.queue.push(e);
    if (!this.scheduled) {
      this.scheduled = true;
      raf(this.flush);
    }
  }

  // ---------------------------------------------------------------- conversations
  /** Ends the running answer (the server stops too) and starts an empty conversation. */
  reset() {
    this.cancel();
    this.last = null;
    this.emit({ ...EMPTY });
  }

  async open(threadId: string) {
    if (threadId === this.snap.threadId && this.snap.messages.length && !this.snap.loadError) return;
    this.cancel();
    this.last = null;
    this.emit({ threadId, messages: [], phase: "loading", loadError: null });
    await this.reload(threadId);
  }

  private async reload(threadId: string, round = 0) {
    const seq = this.seq;
    try {
      const { messages, running } = await this.client.messages(threadId);
      if (seq !== this.seq) return;
      // an answer still being written elsewhere (another tab, or a reload mid-answer): show it and look again shortly
      const follow = running && round < 40;
      this.emit({ messages: messages.map(fromView), phase: follow ? "elsewhere" : "idle", loadError: null });
      if (follow) setTimeout(() => seq === this.seq && void this.reload(threadId, round + 1), 3000);
    } catch (e) {
      if (seq !== this.seq) return;
      this.emit({ phase: "idle", loadError: errorText(e) });
    }
  }

  /** The conversation was deleted elsewhere (the list): forget it if it is the open one. */
  forget(threadId: string) {
    if (this.snap.threadId === threadId) this.reset();
  }

  // ---------------------------------------------------------------- asking
  async send(text: string, attachments: AiAttachmentInput[] = [], context: AiPageContext | null = null) {
    const q = text.trim();
    if ((!q && !attachments.length) || this.busy || this.snap.phase === "loading" || this.snap.phase === "elsewhere") return;
    this.last = { text: q, attachments, context };
    const user = blankMessage("user", { text: q, attachments: attachments.map((a) => ({ name: a.name, mime: a.mime })), context });
    this.emit({ messages: [...this.snap.messages, user, blankMessage("assistant")], loadError: null });
    const body = { thread_id: this.snap.threadId, text: q, attachments: attachments.length ? attachments : undefined, context: context ?? undefined };
    await this.run((h, signal) => this.client.chat(body, h, signal));
  }

  /** «ادامه بده»: an answer that stopped (by the person, the step limit or a dropped connection) goes on. */
  async resume() {
    const id = this.snap.threadId;
    if (!id || this.busy) return;
    this.emit({ messages: [...this.snap.messages, blankMessage("assistant")] });
    await this.run((h, signal) => this.client.resume(id, h, signal));
  }

  /** «تلاش دوباره» after a failed answer: the stored question is answered again (or sent again if nothing was stored). */
  async retry() {
    if (this.busy) return;
    if (this.snap.threadId) {
      this.emit({ messages: dropFailed(this.snap.messages) });
      return this.resume();
    }
    const ask = this.last;
    if (!ask) return;
    this.emit({ messages: dropFailed(this.snap.messages).filter((m, i, all) => !(i === all.length - 1 && m.role === "user")) });
    return this.send(ask.text, ask.attachments, ask.context);
  }

  stop() {
    if (!this.ctl) return;
    this.ctl.abort();
    const id = this.snap.threadId;
    if (id) this.client.stop(id).catch(() => {});
  }

  private cancel() {
    this.seq++;
    this.queue = [];
    if (this.ctl) {
      this.ctl.abort();
      this.ctl = null;
    }
  }

  private async run(start: (h: RunHandlers, signal: AbortSignal) => Promise<RunOutcome>) {
    const ctl = new AbortController();
    this.ctl = ctl;
    const seq = this.seq;
    this.emit({ phase: "connecting" });
    let outcome: RunOutcome;
    try {
      outcome = await start(
        {
          onEvent: (e) => {
            if (seq === this.seq) this.push(e);
          },
          onPhase: (p) => {
            if (seq === this.seq && !ctl.signal.aborted) this.emit({ phase: p });
          },
        },
        ctl.signal,
      );
    } catch (e) {
      outcome = { threadId: this.snap.threadId, done: null, aborted: ctl.signal.aborted, resync: false };
      if (!ctl.signal.aborted && seq === this.seq) this.push({ type: "error", kind: "other", message_fa: errorText(e) });
    } finally {
      if (this.ctl === ctl) this.ctl = null;
    }
    if (seq !== this.seq) return;
    this.flush();
    const messages = settle(this.snap.messages, outcome.aborted ? "stopped" : "error", outcome.aborted ? null : { kind: "network", message_fa: "پاسخ کامل نرسید؛ دوباره تلاش کنید" });
    const last = messages[messages.length - 1];
    this.emit({ messages, phase: "idle", threadId: outcome.threadId ?? this.snap.threadId });
    if (outcome.resync && this.snap.threadId) await this.reload(this.snap.threadId);
    this.onSettled?.(this.snap.threadId, !!last && last.status === "done");
  }

  // ---------------------------------------------------------------- per message
  async rate(key: string, rating: 1 | -1 | null) {
    const m = this.snap.messages.find((x) => x.key === key);
    if (!m?.id) return;
    const before = m.rating;
    const set = (r: 1 | -1 | null) => this.emit({ messages: this.snap.messages.map((x) => (x.key === key ? { ...x, rating: r } : x)) });
    set(rating);
    try {
      await this.client.rate(m.id, rating);
    } catch (e) {
      set(before);
      throw e;
    }
  }

  setProposal(p: AiProposal) {
    this.emit({ messages: withProposal(this.snap.messages, p) });
  }
}

/** The failed answer at the end goes before a retry. */
function dropFailed(messages: UiMessage[]): UiMessage[] {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && last.status === "error" ? messages.slice(0, -1) : messages;
}

const stores = new Map<string, AssistantStore>();

/** The conversation store of a business (kept for the whole session). */
export function storeFor(orgId: string, client: AiClient): AssistantStore {
  let s = stores.get(orgId);
  if (!s) {
    s = new AssistantStore(client);
    stores.set(orgId, s);
  }
  return s;
}

export function useAssistantState(store: AssistantStore): AssistantSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
