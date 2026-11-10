// The organisation's AI endpoints (/api/o/:org/ai/*) for the UI: typed calls, and the reader of the assistant's answers —
// server-sent events over a fetch POST (an EventSource cannot POST), with heartbeats, stop, an idle watchdog and the
// automatic «continue» (a long answer spans several requests; a dropped connection resumes from the stored steps).
import type {
  AiChartSpec,
  AiErrorKind,
  AiMessageView,
  AiProposal,
  AiRef,
  AiStreamEvent,
  AiThreadSummary,
} from "@shared/ai/types";
import type { AiAttachmentInput, AiChatRequest, AiDataView, AiStatus, AiThreadDetail } from "@shared/ai/api";
import { ApiError, type OrgApi } from "../lib/api";

// ---------------------------------------------------------------- shapes

/** Rows behind a chart or a table of an answer (GET /ai/data/:ref). */
export interface AiDataSet {
  rows: Record<string, unknown>[];
  title?: string | null;
  total_rows: number;
  truncated: boolean;
}

export type { AiAttachmentInput, AiChartSpec, AiChatRequest, AiRef, AiStatus, AiThreadDetail };

// ---------------------------------------------------------------- server-sent events

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental text/event-stream parser (WHATWG rules): lines end with \n, \r\n or \r (a \r at the end of a chunk
 * waits for the next one), ":" starts a comment (heartbeats), `data` lines are joined with \n, an empty line
 * dispatches. At the end of the stream a pending event is still dispatched (a server that closes right after its
 * last data line loses nothing; a truncated JSON is dropped by the reader).
 */
export class SseParser {
  private buf = "";
  private event = "";
  private data: string[] = [];
  private id: string | undefined;
  /** comment lines seen so far (heartbeats) */
  comments = 0;

  push(chunk: string): SseFrame[] {
    this.buf += chunk;
    return this.drain(false);
  }

  end(): SseFrame[] {
    const out = this.drain(true);
    if (this.buf) {
      this.line(this.buf, out);
      this.buf = "";
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private drain(eof: boolean): SseFrame[] {
    const out: SseFrame[] = [];
    const b = this.buf;
    let start = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      if (c === 13 && i === b.length - 1 && !eof) break; // a \r at the end: maybe the first half of \r\n
      this.line(b.slice(start, i), out);
      if (c === 13 && b.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
    this.buf = b.slice(start);
    return out;
  }

  private line(line: string, out: SseFrame[]) {
    if (line === "") {
      const f = this.dispatch();
      if (f) out.push(f);
      return;
    }
    if (line.startsWith(":")) {
      this.comments++;
      return;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
    else if (field === "id" && !value.includes("\0")) this.id = value;
  }

  private dispatch(): SseFrame | null {
    const frame = this.data.length ? { event: this.event || "message", data: this.data.join("\n"), id: this.id } : null;
    this.event = "";
    this.data = [];
    return frame;
  }
}

const EVENT_TYPES = new Set<AiStreamEvent["type"]>(["meta", "text", "thinking", "tool_start", "tool_end", "proposal", "chart", "table", "usage", "continue", "error", "done"]);

/**
 * A frame → an assistant event. The JSON carries its own `type`; servers that name the event in the `event:`
 * field instead are read too. Heartbeats («ping») and anything unknown are dropped.
 */
export function toStreamEvent(f: SseFrame): AiStreamEvent | null {
  if (!f.data) return null;
  let v: unknown;
  try {
    v = JSON.parse(f.data);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const type = (typeof o.type === "string" ? o.type : f.event) as AiStreamEvent["type"];
  if (!EVENT_TYPES.has(type)) return null;
  if ((type === "text" || type === "thinking") && typeof o.delta !== "string") return null;
  return { ...o, type } as AiStreamEvent;
}

/**
 * Reads the frames of a response body; `onActivity` fires on every chunk (heartbeats included). An abort through
 * `signal` ends the reading at once (the body may not be tied to the request's signal).
 */
export async function* readFrames(body: ReadableStream<Uint8Array>, onActivity?: () => void, signal?: AbortSignal): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const cancel = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) return;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity?.();
      for (const f of parser.push(decoder.decode(value, { stream: true }))) yield f;
    }
    for (const f of parser.push(decoder.decode())) yield f;
    for (const f of parser.end()) yield f;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.cancel().catch(() => {});
  }
}

// ---------------------------------------------------------------- errors

const ERROR_KINDS = new Set<AiErrorKind>(["auth", "region", "quota", "rate", "overloaded", "model", "invalid", "refusal", "timeout", "network", "budget", "disabled", "not_configured", "empty", "policy", "other"]);

/** An error event for a request the server refused before streaming (or a network failure). */
export function errorEvent(e: unknown): Extract<AiStreamEvent, { type: "error" }> {
  if (e instanceof ApiError) {
    const code = e.code as AiErrorKind;
    const kind: AiErrorKind = ERROR_KINDS.has(code) ? code : e.status === 0 ? "network" : e.status === 429 ? "rate" : e.status === 504 ? "timeout" : "other";
    return { type: "error", kind, message_fa: e.message };
  }
  return { type: "error", kind: "network", message_fa: "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید" };
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

// ---------------------------------------------------------------- one answer, across requests

export type RunPhase = "connecting" | "streaming" | "continuing" | "reconnecting";

export interface RunHandlers {
  onEvent(e: AiStreamEvent): void;
  onPhase?(p: RunPhase): void;
}

export interface RunOptions {
  /** «continue» rounds one question may take (each ≈ one serverless request) */
  maxContinues?: number;
  /** silence (no byte, no heartbeat) after which the connection counts as dropped */
  idleMs?: number;
  /** reconnect attempts after a dropped connection */
  retries?: number;
}

export interface RunOutcome {
  threadId: string | null;
  /** the closing `done` event, if one arrived */
  done: Extract<AiStreamEvent, { type: "done" }> | null;
  aborted: boolean;
  /** the client gave up on the stream: reload the conversation to show what the server stored */
  resync: boolean;
}

type Start = { kind: "chat"; body: AiChatRequest } | { kind: "continue"; threadId: string };

// ---------------------------------------------------------------- the client

export function aiClient(api: OrgApi) {
  const list = <T>(v: T[] | Record<string, unknown> | null | undefined, key: string): T[] =>
    Array.isArray(v) ? v : Array.isArray((v as Record<string, unknown> | null)?.[key]) ? ((v as Record<string, unknown>)[key] as T[]) : [];

  /** Reads one request's stream; returns what ended it. */
  async function readOnce(start: Start, h: RunHandlers, signal: AbortSignal, idleMs: number) {
    const ctl = new AbortController();
    const relay = () => ctl.abort();
    signal.addEventListener("abort", relay, { once: true });
    let idle = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        ctl.abort();
      }, idleMs);
    };
    const r = { threadId: start.kind === "continue" ? start.threadId : (start.body.thread_id ?? null), done: null as RunOutcome["done"], sawContinue: false, dropped: false, failed: false };
    try {
      arm();
      const res = start.kind === "chat" ? await api.stream("/ai/chat", start.body, ctl.signal) : await api.stream(`/ai/threads/${start.threadId}/continue`, {}, ctl.signal);
      h.onPhase?.("streaming");
      for await (const frame of readFrames(res.body!, arm, ctl.signal)) {
        const e = toStreamEvent(frame);
        if (!e) continue;
        if (e.type === "meta" && e.thread_id) r.threadId = e.thread_id;
        if (e.type === "continue") {
          r.sawContinue = true;
          if (e.thread_id) r.threadId = e.thread_id;
        }
        if (e.type === "done") r.done = e;
        h.onEvent(e);
      }
      if (signal.aborted) return r;
      // the body ended (or the idle watchdog cut it): without `done` and without a continue hint the connection dropped
      if (!r.done && !r.sawContinue) r.dropped = true;
    } catch (e) {
      if (signal.aborted) return r;
      if (idle || isAbort(e)) r.dropped = true;
      else if (e instanceof ApiError && e.status !== 0) {
        r.failed = true;
        h.onEvent(errorEvent(e));
      } else r.dropped = true;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", relay);
    }
    return r;
  }

  /**
   * Streams one answer: POST /ai/chat (or /threads/:id/continue), then follows every «continue» the server asks
   * for and resumes a dropped connection from the stored steps. Events arrive through `h.onEvent` in order.
   */
  async function run(start: Start, h: RunHandlers, signal: AbortSignal, o: RunOptions = {}): Promise<RunOutcome> {
    const maxContinues = o.maxContinues ?? 8;
    const retries = o.retries ?? 2;
    const idleMs = o.idleMs ?? 45_000;
    let next: Start = start;
    let threadId: string | null = start.kind === "continue" ? start.threadId : (start.body.thread_id ?? null);
    let continues = 0;
    let dropped = 0;
    h.onPhase?.("connecting");
    for (;;) {
      const r = await readOnce(next, h, signal, idleMs);
      threadId = r.threadId ?? threadId;
      if (signal.aborted) return { threadId, done: r.done, aborted: true, resync: false };
      if (r.failed) return { threadId, done: r.done, aborted: false, resync: next.kind === "continue" };
      if (r.sawContinue && threadId) {
        if (++continues > maxContinues) {
          h.onEvent({ type: "error", kind: "timeout", message_fa: "پاسخ از اندازهٔ معمول طولانی‌تر شد و نیمه‌کاره ماند؛ برای ادامه «ادامه بده» را بزنید" });
          return { threadId, done: null, aborted: false, resync: false };
        }
        h.onPhase?.("continuing");
        next = { kind: "continue", threadId };
        continue;
      }
      if (r.dropped) {
        if (!threadId || ++dropped > retries) {
          h.onEvent({ type: "error", kind: "network", message_fa: "ارتباط با سرور قطع شد؛ اتصال را بررسی کنید و دوباره بپرسید" });
          return { threadId, done: null, aborted: false, resync: !!threadId };
        }
        h.onPhase?.("reconnecting");
        await sleep(dropped === 1 ? 800 : 2500, signal);
        if (signal.aborted) return { threadId, done: null, aborted: true, resync: false };
        next = { kind: "continue", threadId };
        continue;
      }
      return { threadId, done: r.done, aborted: false, resync: false };
    }
  }

  return {
    status: () => api.get<AiStatus>("/ai/status"),
    threads: (q?: string) =>
      api.get<AiThreadSummary[] | { threads: AiThreadSummary[] }>("/ai/threads", q ? { q } : undefined).then((v) => list<AiThreadSummary>(v, "threads")),
    /** a stored conversation; `running`: an answer is still being prepared on the server */
    messages: (threadId: string) =>
      api
        .get<AiMessageView[] | { messages: AiMessageView[]; running?: boolean }>(`/ai/threads/${threadId}/messages`)
        .then((v) => ({ messages: list<AiMessageView>(v, "messages"), running: !Array.isArray(v) && !!v?.running })),
    rename: (threadId: string, title: string) => api.patch<{ thread: AiThreadDetail }>(`/ai/threads/${threadId}`, { title }),
    pin: (threadId: string, pinned: boolean) => api.patch<{ thread: AiThreadDetail }>(`/ai/threads/${threadId}`, { pinned }),
    remove: (threadId: string) => api.del(`/ai/threads/${threadId}`),
    stop: (threadId: string) => api.post(`/ai/threads/${threadId}/stop`),
    rate: (messageId: string, rating: 1 | -1 | null) => api.post(`/ai/messages/${messageId}/rating`, { rating }),
    data: (ref: string) =>
      api.get<AiDataView | Record<string, unknown>[]>(`/ai/data/${encodeURIComponent(ref)}`).then((v): AiDataSet => {
        if (Array.isArray(v)) return { rows: v, total_rows: v.length, truncated: false };
        const rows = Array.isArray(v?.rows) ? v.rows : [];
        const title = typeof v?.meta?.title === "string" ? v.meta.title : null;
        return { rows, title, total_rows: typeof v?.total_rows === "number" ? v.total_rows : rows.length, truncated: !!v?.truncated };
      }),
    confirm: (actionId: string) => api.post<{ proposal?: AiProposal } & Partial<AiProposal>>(`/ai/actions/${actionId}/confirm`).then(proposalOf),
    reject: (actionId: string, reason?: string) =>
      api.post<{ proposal?: AiProposal } & Partial<AiProposal>>(`/ai/actions/${actionId}/reject`, reason ? { reason } : {}).then(proposalOf),
    /** a question: streams the answer (with automatic continue) */
    chat: (body: AiChatRequest, h: RunHandlers, signal: AbortSignal, o?: RunOptions) => run({ kind: "chat", body }, h, signal, o),
    /** «ادامه بده» on an answer that stopped half-way */
    resume: (threadId: string, h: RunHandlers, signal: AbortSignal, o?: RunOptions) => run({ kind: "continue", threadId }, h, signal, o),
  };
}

/** The confirm/reject answers carry the updated proposal (bare or as `{ proposal }`). */
function proposalOf(v: { proposal?: AiProposal } & Partial<AiProposal>): AiProposal | null {
  if (v?.proposal) return v.proposal;
  return v && typeof v.id === "string" && typeof v.status === "string" ? (v as AiProposal) : null;
}

export type AiClient = ReturnType<typeof aiClient>;
