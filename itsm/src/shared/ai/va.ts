// Contracts of the virtual agent («دستیار مجازی», docs/spec/AI.md §11.9, catalogue AI-058…064): the server-side brain a
// requester talks to — topics and intent routing, cited answers from knowledge, the status of their own tickets,
// ordering from the catalogue with slot filling, reporting an issue, and handing the conversation to a person. Every
// step runs with the REQUESTER's access. The portal module renders the cards; messaging channels (e-mail, messengers)
// call the same `VirtualAgentAdapter` and render them as text. Client-safe: no server imports.

export type VaState = "open" | "handoff" | "ended";
export type VaTopicKind = "knowledge" | "status" | "order" | "catalog_item" | "report_issue" | "handoff" | "answer";
/** How a message was routed: a topic's keywords, the model's intent classification, a pending question, or the fallback. */
export type VaRoute = "topic" | "intent" | "slot" | "number" | "fallback" | "action" | "start";

export const VA_CHANNELS = ["portal", "app", "email", "messenger", "sms", "test"] as const;
export type VaChannel = (typeof VA_CHANNELS)[number];

/** A link to a record or an article (in-app path without the organisation prefix). */
export interface VaLink {
  table: string;
  id: string;
  number: string | null;
  title: string;
  path: string;
}

export interface VaTicket extends VaLink {
  table_label: string;
  state: string;
  state_label: string;
  updated_at: string | null;
  /** the last public reply (never an internal note) */
  last_reply: string | null;
}

/** What a reply shows besides its text; channels without rich cards render them as text lines. */
export type VaCard =
  | { kind: "articles"; items: (VaLink & { n: number })[] }
  | { kind: "tickets"; items: VaTicket[]; total: number }
  | { kind: "choices"; options: { value: string; label: string }[] }
  | { kind: "items"; items: { id: string; name: string; description: string | null }[] }
  | { kind: "question"; name: string; label: string; type: string; required: boolean; options?: { value: string; label: string }[]; help?: string | null; step: number; steps: number }
  | { kind: "confirm"; what: "order" | "incident"; title: string; rows: { label: string; value: string }[] }
  | { kind: "created"; link: VaLink; label: string }
  | { kind: "handoff"; link: VaLink | null; message: string }
  | { kind: "form_link"; item_id: string; name: string; path: string; reason: string };

export interface VaReply {
  conversation_id: string;
  message_id: string;
  text: string;
  cards: VaCard[];
  topic: string | null;
  route: VaRoute;
  state: VaState;
  /** quick replies the requester may tap */
  suggestions: string[];
  /** written with a model (null: rule-based) */
  model: string | null;
}

/** What a requester sends: words, or an answer to a card (confirm / cancel / a choice). */
export type VaInput = { text: string } | { action: "confirm" | "cancel" } | { action: "choose"; value: string };

export interface VaMessageView {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  cards: VaCard[];
  topic: string | null;
  at: string;
}

export interface VaConversationView {
  id: string;
  title: string;
  channel: string;
  state: VaState;
  topic: string | null;
  last_at: string | null;
  handoff: VaLink | null;
}

/** Events of a streamed message (SSE): the answer's text as it is written, then the whole reply. */
export type VaStreamEvent = { type: "text"; delta: string } | { type: "reply"; reply: VaReply } | { type: "error"; message_fa: string };

/**
 * The adapter the portal and the messaging channels call — one conversation core, a renderer per channel (AI-064).
 * The server's implementation is bound to a requester (`virtualAgent(ctx)`); the browser's (`src/ui/ai/va/api.ts`)
 * calls the HTTP API with the signed-in member.
 */
export interface VirtualAgentAdapter {
  start(input: { channel: VaChannel; text?: string | null }): Promise<VaReply>;
  send(conversationId: string, input: VaInput, onText?: (delta: string) => void): Promise<VaReply>;
  handoff(conversationId: string, note?: string | null): Promise<VaReply>;
  end(conversationId: string): Promise<VaReply>;
  messages(conversationId: string): Promise<VaMessageView[]>;
  conversations(): Promise<VaConversationView[]>;
}

/** A card as plain text (e-mail, SMS, messengers without buttons). */
export function cardText(c: VaCard): string {
  switch (c.kind) {
    case "articles":
      return c.items.map((a) => `[${a.n}] ${a.title}`).join("\n");
    case "tickets":
      return c.items.map((t) => `${t.number ?? ""} ${t.title} — ${t.state_label}`.trim()).join("\n");
    case "choices":
      return c.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
    case "items":
      return c.items.map((o, i) => `${i + 1}. ${o.name}`).join("\n");
    case "question":
      return [c.label, ...(c.options ?? []).map((o, i) => `${i + 1}. ${o.label}`)].join("\n");
    case "confirm":
      return [c.title, ...c.rows.map((r) => `${r.label}: ${r.value}`)].join("\n");
    case "created":
      return `${c.label}: ${c.link.number ?? c.link.title}`;
    case "handoff":
      return c.link ? `${c.message} (${c.link.number ?? c.link.title})` : c.message;
    case "form_link":
      return `${c.name}: ${c.reason}`;
  }
}
