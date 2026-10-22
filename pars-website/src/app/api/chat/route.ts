import { after } from "next/server";
import { hashIp } from "@/lib/crypto";
import { allow, allowAi } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";
import { chatSystemPrompt, openStream, runtimeFrom } from "@/lib/ai/runtime";
import { ProviderError, type ChatMessage } from "@/lib/ai/providers";
import { parseMarkers } from "@/lib/markers";
import { logChat } from "@/lib/chat-log";

export const maxDuration = 60;
/** the provider call ends well before maxDuration, so the cut-off text and the after() log still go out */
const DEADLINE_MS = 45_000;
/** the history sent to the model, in characters; older turns beyond it are dropped */
const HISTORY_CHARS = 12_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OFFLINE = {
  fa: "دستیار هوشمند پارس در حال حاضر در دسترس نیست. می‌توانید درخواستتان را ثبت کنید تا همکاران ما در اولین فرصت پاسخ دهند، یا مستقیم تماس بگیرید.\n[[action:ticket]] [[action:contact]]",
  en: "Pars AI is not available right now. Please submit a request and our team will get back to you shortly, or contact us directly.\n[[action:ticket]] [[action:contact]]",
};

function json(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function textStream(text: string) {
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(DEADLINE_MS)]);
  let body: { messages?: ChatMessage[]; lang?: string; sessionId?: string; logId?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, "invalid");
  }
  const lang = body.lang === "en" ? "en" : "fa";
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-12);
  // keep the newest turns within the size budget (the new question alone always fits)
  let size = messages.reduce((n, m) => n + m.content.length, 0);
  while (messages.length > 1 && size > HISTORY_CHARS) size -= messages.shift()!.content.length;
  // the conversation must start with the user and end with the new question
  while (messages.length && messages[0].role !== "user") messages.shift();
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) return json(400, "invalid");

  const settings = await getSettings();
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "0.0.0.0").trim();
  const visitor = hashIp(ip);
  const [okShort, okDay] = await Promise.all([
    allow(`chat:10m:${visitor}`, 600, settings.chat.perTenMinutes),
    allow(`chat:day:${visitor}`, 86400, settings.chat.perDay),
  ]);
  if (!okShort || !okDay) return json(429, "rate");

  const rt = settings.ai.enabled ? runtimeFrom(settings.ai) : null;
  if (!rt) return textStream(OFFLINE[lang]);
  // one daily budget shared by every visitor, so a few addresses cannot use up the key for everyone
  if (!(await allowAi())) return json(503, "busy");

  const { entries } = await getKnowledge();
  const query = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join("\n");
  const system = chatSystemPrompt(selectKnowledge(entries, query), rt.instructions);

  let opened: Awaited<ReturnType<typeof openStream>>;
  try {
    opened = await openStream(rt, system, messages, { signal: deadline });
  } catch (e) {
    console.error("[chat] provider error", e instanceof ProviderError ? `${e.kind} ${e.status} ${e.message}` : e);
    if (e instanceof ProviderError && e.kind === "quota") return json(503, "busy");
    return textStream(OFFLINE[lang]);
  }

  let answer = "";
  let finished: () => void = () => {};
  const done = new Promise<void>((r) => (finished = r));
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done: end } = await opened.chunks.next();
        if (end) {
          controller.close();
          finished();
          return;
        }
        answer += value;
        controller.enqueue(enc.encode(value));
      } catch (e) {
        console.error("[chat] stream error", e);
        controller.enqueue(enc.encode(lang === "fa" ? "\n\n…پاسخ ناتمام ماند. لطفاً دوباره بپرسید." : "\n\n…The answer was cut off. Please ask again."));
        controller.close();
        finished();
      }
    },
    cancel() {
      finished();
    },
  });

  if (settings.chat.logChats) {
    const logId = typeof body.logId === "string" && UUID.test(body.logId) ? body.logId : crypto.randomUUID();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "";
    after(async () => {
      await done;
      const parsed = parseMarkers(answer);
      await logChat({ id: logId, session_id: sessionId, lang, question: last.content, answer: parsed.text, unknown: parsed.unknown, model: opened.model, visitor }).catch(() => {});
    });
  }

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", "x-model": opened.model },
  });
}
