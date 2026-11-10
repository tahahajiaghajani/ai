// The browser's virtual agent adapter (contracts: src/shared/ai/va.ts): the same `VirtualAgentAdapter` the server
// binds to a requester, over the HTTP API with the signed-in member — what the portal's requester UI will call.
import type { VaConversationView, VaInput, VaMessageView, VaReply, VaStreamEvent, VirtualAgentAdapter } from "@shared/ai/va";
import type { OrgApi } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { readFrames } from "../client";

const enc = encodeURIComponent;

export function virtualAgentClient(api: OrgApi): VirtualAgentAdapter {
  return {
    start: async (input) => (await api.post<{ reply: VaReply }>("/ai/va/conversations", input)).reply,
    async send(id: string, input: VaInput, onText?: (delta: string) => void): Promise<VaReply> {
      if (!onText) return (await api.post<{ reply: VaReply }>(`/ai/va/conversations/${enc(id)}/messages`, input)).reply;
      const res = await api.stream(`/ai/va/conversations/${enc(id)}/messages/stream`, input);
      let reply: VaReply | null = null;
      for await (const f of readFrames(res.body!)) {
        let ev: VaStreamEvent;
        try {
          ev = JSON.parse(f.data) as VaStreamEvent;
        } catch {
          continue;
        }
        if (ev.type === "text") onText(ev.delta);
        else if (ev.type === "reply") reply = ev.reply;
        else if (ev.type === "error") throw new ApiError(400, "va_error", ev.message_fa);
      }
      if (!reply) throw new ApiError(502, "va_no_reply", "پاسخ کامل نرسید؛ دوباره بفرستید");
      return reply;
    },
    handoff: async (id, note) => (await api.post<{ reply: VaReply }>(`/ai/va/conversations/${enc(id)}/handoff`, { note: note ?? null })).reply,
    end: async (id) => (await api.post<{ reply: VaReply }>(`/ai/va/conversations/${enc(id)}/end`, {})).reply,
    messages: async (id) => (await api.get<{ messages: VaMessageView[] }>(`/ai/va/conversations/${enc(id)}/messages`)).messages,
    conversations: async () => (await api.get<{ conversations: VaConversationView[] }>("/ai/va/conversations")).conversations,
  };
}
