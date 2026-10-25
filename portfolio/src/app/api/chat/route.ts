import { after } from "next/server";
import { clientIp, hashIp } from "@/lib/crypto";
import { allow, allowAi } from "@/lib/rate-limit";
import { getKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";
import { chatSystemPrompt } from "@/lib/assistant";
import { getRuntime, openStream, TRANSIENT } from "@/lib/ai/runtime";
import { ProviderError, type ChatMessage } from "@/lib/ai/gemini";
import { parseMarkers } from "@/lib/markers";
import { logUnanswered } from "@/lib/chat-log";

export const maxDuration = 60;
/** the provider call ends well before maxDuration, so the cut-off text and the after() log still go out */
const DEADLINE_MS = 45_000;
/** the history sent to the model, in characters; older turns beyond it are dropped */
const HISTORY_CHARS = 12_000;

const OFFLINE = {
  fa: "دستیار هوشمند الان در دسترس نیست. می‌توانید درخواستتان را ثبت کنید تا طاها خودش پاسخ دهد، یا مستقیم پیام بدهید.\n[[action:ticket]] [[action:contact]]",
  en: "The assistant isn't available right now. Send a request and Taha will answer personally, or message him directly.\n[[action:ticket]] [[action:contact]]",
};

function json(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** The fixed "not available" answer; flagged so the client keeps it out of the history it sends back. */
function offline(lang: "fa" | "en") {
  return new Response(OFFLINE[lang], { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-offline": "1" } });
}

export async function POST(req: Request) {
  const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(DEADLINE_MS)]);
  let body: { messages?: ChatMessage[]; lang?: string };
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
  let size = messages.reduce((n, m) => n + m.content.length, 0);
  while (messages.length > 1 && size > HISTORY_CHARS) size -= messages.shift()!.content.length;
  while (messages.length && messages[0].role !== "user") messages.shift();
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) return json(400, "invalid");

  const visitor = hashIp(clientIp(req));
  const [okShort, okDay] = await Promise.all([allow(`chat:10m:${visitor}`, 600, 20), allow(`chat:day:${visitor}`, 86400, 80)]);
  if (!okShort || !okDay) return json(429, "rate");

  const rt = await getRuntime();
  if (!rt) return offline(lang);
  if (!(await allowAi())) return json(503, "busy");

  const entries = await getKnowledge();
  const query = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join("\n");
  const system = chatSystemPrompt(selectKnowledge(entries, query, 30_000));

  let opened: Awaited<ReturnType<typeof openStream>>;
  try {
    opened = await openStream(rt, system, messages, { signal: deadline });
  } catch (e) {
    if (req.signal.aborted) return json(499, "aborted");
    console.error("[chat] provider error", e instanceof ProviderError ? `${e.model} ${e.kind} ${e.status} ${e.message}` : e);
    if (deadline.aborted || (e instanceof ProviderError && TRANSIENT.includes(e.kind))) return json(503, "busy");
    return offline(lang);
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

  // only questions the assistant could not answer are kept, so Taha can add the missing knowledge
  after(async () => {
    await done;
    const parsed = parseMarkers(answer);
    if (parsed.unknown) await logUnanswered({ question: last.content, answer: parsed.text, lang, model: opened.model }).catch(() => {});
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", "x-model": opened.model },
  });
}
