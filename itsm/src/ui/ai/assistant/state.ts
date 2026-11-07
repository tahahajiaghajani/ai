// The conversation as the panel shows it, and how each server event changes it. Pure functions (no React, no
// fetch), so the event handling is unit-tested on its own (tests/ai-assistant-ui.test.ts).
import type { AiChartSpec, AiErrorKind, AiMessageView, AiPageContext, AiProposal, AiRef, AiStreamEvent } from "@shared/ai/types";

export type UiStatus = "pending" | "streaming" | "done" | "stopped" | "error" | "max_steps" | "refusal";

export interface UiTool {
  call_id: string;
  tool: string;
  title_fa: string;
  input_fa?: string;
  status: "running" | "ok" | "failed";
  summary_fa?: string;
}

export interface UiTable {
  data_ref: string;
  title?: string;
  columns: { key: string; title: string; numeric?: boolean }[];
  total_rows: number;
}

export interface UiMessage {
  /** stable React key (a local id; the server id may arrive later) */
  key: string;
  /** server id: rating, copy links */
  id: string | null;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  tools: UiTool[];
  refs: AiRef[];
  proposals: AiProposal[];
  charts: { data_ref: string; spec: AiChartSpec }[];
  tables: UiTable[];
  attachments: { name: string; mime: string }[];
  rating: 1 | -1 | null;
  model: string | null;
  status: UiStatus;
  error: { kind: AiErrorKind; message_fa: string } | null;
  created_at: string;
  /** the page the question was asked on (user messages) */
  context?: AiPageContext | null;
  /** the answer continues in a new request (long work) */
  continuing?: boolean;
}

let localSeq = 0;
export const localKey = (prefix = "l") => `${prefix}${Date.now().toString(36)}${(localSeq++).toString(36)}`;

export function blankMessage(role: UiMessage["role"], patch: Partial<UiMessage> = {}): UiMessage {
  return {
    key: localKey(role === "user" ? "u" : "a"),
    id: null,
    role,
    text: "",
    thinking: "",
    tools: [],
    refs: [],
    proposals: [],
    charts: [],
    tables: [],
    attachments: [],
    rating: null,
    model: null,
    status: role === "user" ? "done" : "pending",
    error: null,
    created_at: new Date().toISOString(),
    ...patch,
  };
}

/** A stored message (GET /threads/:id/messages) → the panel's shape. */
export function fromView(v: AiMessageView): UiMessage {
  return blankMessage(v.role, {
    key: `m${v.id}`,
    id: v.id,
    text: v.text ?? "",
    tools: (v.tools ?? []).map((t) => ({ call_id: t.call_id, tool: t.tool, title_fa: t.title_fa, status: t.ok ? "ok" : "failed", summary_fa: t.summary_fa })),
    refs: dedupeRefs(v.refs ?? []),
    proposals: v.proposals ?? [],
    charts: v.charts ?? [],
    tables: v.tables ?? [],
    attachments: v.attachments ?? [],
    rating: v.rating ?? null,
    model: v.model ?? null,
    status: "done",
    created_at: v.created_at,
  });
}

export function dedupeRefs(refs: AiRef[], more: AiRef[] = []): AiRef[] {
  const seen = new Set<string>();
  const out: AiRef[] = [];
  for (const r of [...refs, ...more]) {
    if (!r || typeof r.id !== "string" || typeof r.type !== "string") continue;
    const k = `${r.type}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

const STOP_STATUS: Record<Extract<AiStreamEvent, { type: "done" }>["stop"], UiStatus> = {
  end: "done",
  max_steps: "max_steps",
  stopped: "stopped",
  error: "error",
  refusal: "refusal",
};

const live = (m: UiMessage | undefined) => !!m && m.role === "assistant" && (m.status === "pending" || m.status === "streaming");

/** Applies one server event to the conversation (returns a new array; the input is never changed). */
export function applyEvent(messages: UiMessage[], e: AiStreamEvent): UiMessage[] {
  const out = messages.slice();
  let i = out.length - 1;
  // the answer being written: the last message if it is a live assistant message, otherwise a new one
  const current = (): UiMessage => {
    if (!live(out[i])) {
      out.push(blankMessage("assistant", { status: "streaming" }));
      i = out.length - 1;
    }
    return out[i];
  };
  const put = (patch: Partial<UiMessage>) => {
    const m = current();
    out[i] = { ...m, ...patch, status: patch.status ?? (m.status === "pending" ? "streaming" : m.status) };
  };

  switch (e.type) {
    case "meta": {
      const last = out[i];
      if (live(last) && last.id && last.id !== e.message_id) {
        // a continued answer is stored as a new message: close the previous part, start the next one
        out[i] = { ...last, status: "done", continuing: false };
        out.push(blankMessage("assistant", { id: e.message_id, model: e.model, status: "streaming" }));
        i = out.length - 1;
      } else put({ id: e.message_id, model: e.model ?? current().model, continuing: false });
      return out;
    }
    case "text":
      put({ text: current().text + e.delta });
      return out;
    case "thinking":
      put({ thinking: current().thinking + e.delta });
      return out;
    case "tool_start": {
      const m = current();
      const tool: UiTool = { call_id: e.call_id, tool: e.tool, title_fa: e.title_fa, input_fa: e.input_fa, status: "running" };
      const at = m.tools.findIndex((t) => t.call_id === e.call_id);
      put({ tools: at < 0 ? [...m.tools, tool] : m.tools.map((t, k) => (k === at ? { ...t, ...tool } : t)) });
      return out;
    }
    case "tool_end": {
      const m = current();
      const known = m.tools.some((t) => t.call_id === e.call_id);
      const ended = (t: UiTool): UiTool => ({ ...t, status: e.ok ? "ok" : "failed", summary_fa: e.summary_fa ?? t.summary_fa });
      put({
        tools: known ? m.tools.map((t) => (t.call_id === e.call_id ? ended(t) : t)) : [...m.tools, ended({ call_id: e.call_id, tool: "", title_fa: "", status: "running" })],
        refs: e.refs?.length ? dedupeRefs(m.refs, e.refs) : m.refs,
      });
      return out;
    }
    case "proposal": {
      const m = current();
      const at = m.proposals.findIndex((p) => p.id === e.proposal.id);
      put({ proposals: at < 0 ? [...m.proposals, e.proposal] : m.proposals.map((p, k) => (k === at ? e.proposal : p)) });
      return out;
    }
    case "chart": {
      const m = current();
      if (m.charts.some((c) => c.data_ref === e.data_ref && c.spec.kind === e.spec.kind)) return out;
      put({ charts: [...m.charts, { data_ref: e.data_ref, spec: e.spec }] });
      return out;
    }
    case "table": {
      const m = current();
      if (m.tables.some((t) => t.data_ref === e.data_ref)) return out;
      put({ tables: [...m.tables, { data_ref: e.data_ref, title: e.title, columns: e.columns, total_rows: e.total_rows }] });
      return out;
    }
    case "usage":
      return out;
    case "continue":
      if (live(out[i])) out[i] = { ...out[i], continuing: true };
      return out;
    case "error":
      put({ status: "error", error: { kind: e.kind, message_fa: e.message_fa }, tools: current().tools.map(endRunning) });
      return out;
    case "done": {
      if (!live(out[i])) {
        // `done` after an error (or twice) only fills in the id
        if (out[i]?.role === "assistant" && !out[i].id && e.message_id) out[i] = { ...out[i], id: e.message_id };
        return out;
      }
      const m = out[i];
      const status = STOP_STATUS[e.stop] ?? "done";
      out[i] = { ...m, id: m.id ?? e.message_id ?? null, status, continuing: false, tools: m.tools.map(endRunning) };
      return out;
    }
  }
  return out;
}

/** A step still marked as running when the answer ends did not finish. */
const endRunning = (t: UiTool): UiTool => (t.status === "running" ? { ...t, status: "failed" } : t);

/** Ends a live answer locally (the person pressed stop, or the connection was given up). */
export function settle(messages: UiMessage[], status: UiStatus, error?: UiMessage["error"]): UiMessage[] {
  const i = messages.length - 1;
  if (!live(messages[i])) return messages;
  const out = messages.slice();
  out[i] = { ...out[i], status, error: error ?? out[i].error, continuing: false, tools: out[i].tools.map(endRunning) };
  return out;
}

/** Replaces a proposal everywhere it appears (after confirm / reject). */
export function withProposal(messages: UiMessage[], p: AiProposal): UiMessage[] {
  return messages.map((m) => (m.proposals.some((x) => x.id === p.id) ? { ...m, proposals: m.proposals.map((x) => (x.id === p.id ? p : x)) } : m));
}

/** Every record the conversation's tools returned: links in answers resolve only against these. */
export function knownRefs(messages: UiMessage[]): AiRef[] {
  return dedupeRefs(messages.flatMap((m) => [...m.refs, ...m.proposals.flatMap((p) => (p.result ? [p.result] : []))]));
}
