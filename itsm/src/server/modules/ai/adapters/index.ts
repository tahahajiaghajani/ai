// One neutral adapter per connection: the preset's protocol decides who talks to the provider.
import type { Adapter, AdapterEnv, ResolvedConnection } from "../types";
import { ProviderError } from "../types";
import { anthropicAdapter } from "./anthropic";
import { openaiResponsesAdapter } from "./openai-responses";
import { openaiChatAdapter } from "./openai-chat";
import { geminiAdapter } from "./gemini";
import { fakeAdapter, fakeEnabled } from "./fake";

export function createAdapter(conn: ResolvedConnection, env: AdapterEnv): Adapter {
  if (conn.preset.id === "fake") {
    if (!fakeEnabled()) throw new ProviderError("not_configured", "پاسخ‌گوی آزمایشی فقط در حالت آزمایش در دسترس است");
    return fakeAdapter(conn.id);
  }
  switch (conn.protocol) {
    case "anthropic":
      return anthropicAdapter(conn, env);
    case "openai-responses":
      return openaiResponsesAdapter(conn, env);
    case "gemini":
      return geminiAdapter(conn, env);
    default:
      return openaiChatAdapter(conn, env);
  }
}
