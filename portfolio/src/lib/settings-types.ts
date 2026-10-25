/** What the panel saves in settings.json of the data repository (client-safe types and parsing). */

export type NotifyChannel = "telegram" | "bale" | "none";

export interface Settings {
  ai: {
    /** off = the assistant answers with the fixed "not available" text and requests are not triaged */
    enabled: boolean;
    /** Google AI Studio key, AES-256-GCM encrypted with APP_SECRET ("" = use GEMINI_API_KEY from Vercel) */
    keyEnc: string;
    keyHint: string;
    /** models tried before the built-in free chain ([] = GEMINI_MODELS from Vercel, then the chain) */
    models: string[];
  };
  notify: {
    channel: NotifyChannel;
    tokenEnc: string;
    tokenHint: string;
    chatId: string;
  };
  updatedAt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ai: { enabled: true, keyEnc: "", keyHint: "", models: [] },
  notify: { channel: "telegram", tokenEnc: "", tokenHint: "", chatId: "" },
  updatedAt: "",
};

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

/** Tolerant reading of settings.json: unknown or missing fields fall back to the defaults. */
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const ai = r.ai ?? {};
  const n = r.notify ?? {};
  const channel = n.channel === "bale" || n.channel === "none" || n.channel === "telegram" ? n.channel : DEFAULT_SETTINGS.notify.channel;
  return {
    ai: {
      enabled: typeof ai.enabled === "boolean" ? ai.enabled : DEFAULT_SETTINGS.ai.enabled,
      keyEnc: str(ai.keyEnc),
      keyHint: str(ai.keyHint, 20),
      models: Array.isArray(ai.models) ? ai.models.filter((m): m is string => typeof m === "string" && /^[\w.:-]{2,80}$/.test(m)).slice(0, 8) : [],
    },
    notify: { channel, tokenEnc: str(n.tokenEnc), tokenHint: str(n.tokenHint, 20), chatId: str(n.chatId, 40) },
    updatedAt: str((raw as { updatedAt?: unknown } | null)?.updatedAt, 40),
  };
}

/** Comma- or space-separated model ids from a form field. */
export function parseModels(input: string): string[] {
  return [...new Set(input.split(/[\s,،]+/).map((m) => m.trim()).filter((m) => /^[\w.:-]{2,80}$/.test(m)))].slice(0, 8);
}
