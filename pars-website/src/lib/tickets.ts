import "server-only";
import { randomBytes } from "node:crypto";
import { db, requireDb } from "@/lib/db";
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { getKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";
import { complete, getRuntime, knowledgeBlock, noteAi, parseJsonObject } from "@/lib/ai/runtime";
import { ProviderError } from "@/lib/ai/providers";
import { allowAi } from "@/lib/rate-limit";
import { canEmail, emailCustomer, notifyTeam } from "@/lib/notify";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  dueAt,
  isCategory,
  isPriority,
  ticketCode,
  type TicketCategory,
  type TicketPriority,
  type TicketProduct,
  type TicketStatus,
} from "@/lib/ticket-meta";

export interface TicketRow {
  id: string;
  code: string;
  access_hash: string;
  access_enc: string | null;
  name: string;
  email: string;
  phone: string;
  organization: string;
  subject: string;
  body: string;
  lang: "fa" | "en";
  product: TicketProduct;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  sentiment: string | null;
  ai_summary: string | null;
  ai_reply: string | null;
  ai_triage: Record<string, unknown> | null;
  source: string;
  rating: number | null;
  rating_note: string | null;
  first_response_at: string | null;
  due_at: string | null;
  last_customer_at: string;
  last_staff_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  ticket_id: string;
  author: "customer" | "staff" | "system";
  body: string;
  internal: boolean;
  created_at: string;
}

/** Public view of a ticket (no secrets, no AI internals). */
export type PublicTicket = Pick<TicketRow, "code" | "name" | "subject" | "body" | "lang" | "product" | "category" | "status" | "rating" | "created_at" | "updated_at">;

export function toPublic(t: TicketRow): PublicTicket {
  const { code, name, subject, body, lang, product, category, status, rating, created_at, updated_at } = t;
  return { code, name, subject, body, lang, product, category, status, rating, created_at, updated_at };
}

/** Same-origin path of the customer's ticket page, for navigation in the browser. */
export function ticketPath(code: string, key: string, lang: "fa" | "en"): string {
  return `${lang === "en" ? "/en" : ""}/support/t/${code}?k=${encodeURIComponent(key)}`;
}

/** Absolute link of the customer's ticket page, for e-mails and links copied outside the site. */
export function ticketLink(code: string, key: string, lang: "fa" | "en"): string {
  return `${env.siteUrl}${ticketPath(code, key, lang)}`;
}

export function accessKeyOf(t: TicketRow): string {
  return decrypt(t.access_enc);
}

export async function getTicket(code: string): Promise<TicketRow | null> {
  const c = db();
  if (!c) return null;
  const { data } = await c.from("pars_tickets").select("*").eq("code", code).maybeSingle();
  return (data as TicketRow) ?? null;
}

export function canAccess(t: TicketRow, key: string | undefined | null): boolean {
  return Boolean(key) && safeEqual(sha256(key!), t.access_hash);
}

export async function listMessages(ticketId: string, includeInternal: boolean): Promise<MessageRow[]> {
  const c = requireDb();
  let q = c.from("pars_ticket_messages").select("*").eq("ticket_id", ticketId).order("created_at");
  if (!includeInternal) q = q.eq("internal", false);
  const { data } = await q;
  return (data as MessageRow[]) ?? [];
}

export interface NewTicket {
  name: string;
  email: string;
  phone: string;
  organization: string;
  subject: string;
  body: string;
  lang: "fa" | "en";
  product: TicketProduct;
  category: TicketCategory;
  source: string;
  /** the account that submitted it */
  user_id?: string;
}

export async function createTicket(input: NewTicket): Promise<{ code: string; key: string; id: string }> {
  const c = requireDb();
  const key = randomToken(18);
  const priority: TicketPriority = input.category === "bug" ? "high" : "normal";
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = ticketCode((n) => randomBytes(n));
    const { data, error } = await c
      .from("pars_tickets")
      .insert({
        ...input,
        code,
        access_hash: sha256(key),
        access_enc: encrypt(key),
        priority,
        status: "new",
        due_at: dueAt(Date.now(), priority),
      })
      .select("id")
      .single();
    if (!error && data) return { code, key, id: data.id as string };
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("could not allocate a ticket code");
}

/** Adds a message and returns the ticket's status after it. */
export async function addMessage(t: TicketRow, author: "customer" | "staff", body: string, internal = false): Promise<TicketStatus> {
  const c = requireDb();
  const now = new Date().toISOString();
  const { error } = await c.from("pars_ticket_messages").insert({ ticket_id: t.id, author, body, internal });
  if (error) throw new Error(error.message);
  if (internal) {
    await c.from("pars_tickets").update({ updated_at: now }).eq("id", t.id);
    return t.status;
  }
  // a staff reply on a closed ticket keeps it closed; staff reopen it with the status control
  const status: TicketStatus = author === "staff" ? (t.status === "closed" ? "closed" : "answered") : t.status === "new" ? "new" : "in_progress";
  const patch: Partial<TicketRow> =
    author === "staff"
      ? { status, last_staff_at: now, updated_at: now, first_response_at: t.first_response_at ?? now }
      : { status, last_customer_at: now, updated_at: now };
  await c.from("pars_tickets").update(patch).eq("id", t.id);
  return status;
}

export async function setStatus(t: TicketRow, status: TicketStatus): Promise<void> {
  const c = requireDb();
  await c.from("pars_tickets").update({ status, updated_at: new Date().toISOString() }).eq("id", t.id);
}

// ------------------------------------------------------------------ AI

interface Triage {
  category?: string;
  priority?: string;
  sentiment?: string;
  summary?: string;
  tags?: string[];
  reply?: string;
  confidence?: number;
  needs_human?: boolean;
}

export type TriageResult = "ok" | "disabled" | "no_ai" | "limit" | "failed";

/**
 * AI triage: category, priority, sentiment, a summary for the team and a draft reply.
 * `manual` (the admin's "analyse again") skips the automatic-triage switch and the visitors' daily AI budget.
 */
export async function triageTicket(ticketId: string, opts: { manual?: boolean } = {}): Promise<TriageResult> {
  const settings = await getSettings();
  if (!opts.manual && !settings.support.triage) return "disabled";
  const rt = await getRuntime();
  const c = db();
  if (!rt || !c) return "no_ai";
  const { data } = await c.from("pars_tickets").select("*").eq("id", ticketId).single();
  const t = data as TicketRow | null;
  if (!t) return "failed";
  if (!opts.manual && !(await allowAi())) return "limit";
  const { entries } = await getKnowledge();
  const knowledge = knowledgeBlock(selectKnowledge(entries, `${t.subject}\n${t.body}`, 16000));
  const system = `You are the triage assistant of the support desk of Pars Project Management (شرکت مدیریت پروژه پارس), an enterprise software company (EPM/EPPM, custom enterprise software, AI agents, training).
Return ONLY a JSON object, no prose:
{"category": "support|bug|sales|demo|training|consulting|feature|other", "priority": "low|normal|high|urgent", "sentiment": "positive|neutral|negative|angry", "summary": "max 2 short sentences in Persian for the team", "tags": ["2-5 short keywords"], "reply": "draft reply to the customer", "confidence": 0.0-1.0, "needs_human": true|false}
Priority guide: urgent = production system down, data loss, security incident or many users blocked; high = a major function broken or a deadline within days; normal = questions, how-to, sales, demos; low = suggestions and general information.
The draft reply: in the customer's language (${t.lang === "en" ? "English" : "fluent Persian"}), warm and professional, addressing the customer by name, max 140 words. Use only facts from <knowledge>; when the answer needs internal information, acknowledge the request and list what the team needs from the customer. Never promise dates or prices. Sign as ${t.lang === "en" ? '"Pars Support Team"' : "«تیم پشتیبانی پارس»"}.
<knowledge>
${knowledge}
</knowledge>`;
  const user = `Customer: ${t.name}${t.organization ? ` (${t.organization})` : ""}\nCustomer-selected type: ${t.category}\nProduct: ${t.product}\nSubject: ${t.subject}\n\n${t.body}`;
  try {
    const { text, model } = await complete({ ...rt, temperature: 0.2 }, system, [{ role: "user", content: user }], { json: true, maxTokens: 900, signal: AbortSignal.timeout(120_000) });
    const j = parseJsonObject<Triage>(text);
    if (!j) return "failed";
    const priority = isPriority(j.priority) ? j.priority : t.priority;
    const patch: Partial<TicketRow> = {
      priority,
      category: isCategory(j.category) && t.category === "other" ? j.category : t.category,
      sentiment: typeof j.sentiment === "string" ? j.sentiment.slice(0, 20) : null,
      ai_summary: typeof j.summary === "string" ? j.summary.slice(0, 600) : null,
      ai_reply: typeof j.reply === "string" ? j.reply.slice(0, 4000) : null,
      ai_triage: { ...j, reply: undefined, model, at: new Date().toISOString() },
      due_at: dueAt(t.created_at, priority),
    };
    await noteAi({ ok: true, model }).catch(() => {});
    const { error } = await c.from("pars_tickets").update(patch).eq("id", t.id);
    if (error) {
      console.error("[triage] update failed", error);
      return "failed";
    }
    return "ok";
  } catch (e) {
    console.error("[triage] failed", e);
    await noteAi({ ok: false, error: e, where: "triage" }).catch(() => {});
    return "failed";
  }
}

/** Before a ticket is submitted: a short answer from the knowledge base, or null. */
export async function suggestFromKnowledge(subject: string, body: string, lang: "fa" | "en"): Promise<string | null> {
  const rt = await getRuntime();
  if (!rt || !(await allowAi())) return null;
  const { entries } = await getKnowledge();
  const knowledge = knowledgeBlock(selectKnowledge(entries, `${subject}\n${body}`, 16000));
  const system = `You help customers of Pars Project Management before they submit a support ticket.
If the facts in <knowledge> clearly answer the customer's message, reply with a short helpful answer (max 110 words, ${lang === "en" ? "English" : "fluent Persian"}, Markdown bullets allowed). Use only facts from <knowledge>; no guesses, prices or promises.
If the knowledge does not clearly answer it, or the message reports a problem that needs the team (errors, outages, account-specific questions, quotes, meetings), reply with exactly: NONE
<knowledge>
${knowledge}
</knowledge>`;
  try {
    // the visitor is waiting on the form: give up quickly and let them submit the ticket
    const { text, model } = await complete({ ...rt, temperature: 0.2 }, system, [{ role: "user", content: `${subject}\n\n${body}`.slice(0, 4000) }], { maxTokens: 500, signal: AbortSignal.timeout(25_000) });
    await noteAi({ ok: true, model }).catch(() => {});
    const out = text.trim();
    if (!out || /^NONE\b/i.test(out) || out.length < 20) return null;
    return out;
  } catch (e) {
    console.error("[suggest] failed", e instanceof ProviderError ? `${e.model} ${e.kind} ${e.status} ${e.message}` : e);
    await noteAi({ ok: false, error: e, where: "ticket-suggestion" }).catch(() => {});
    return null;
  }
}

// ------------------------------------------------------------ notices

export async function noticeNewTicket(code: string): Promise<void> {
  const s = await getSettings();
  const t = await getTicket(code);
  if (!t) return;
  await notifyTeam(
    s.notify,
    `🎫 درخواست جدید ${t.code}\n${t.subject}\n\n👤 ${t.name}${t.organization ? ` — ${t.organization}` : ""}\n📂 ${CATEGORY_LABEL[t.category].fa} · اولویت ${PRIORITY_LABEL[t.priority].fa}${t.ai_summary ? `\n🤖 ${t.ai_summary}` : ""}\n\n${env.siteUrl}/admin/tickets/${t.code}`,
  );
}

export async function noticeCustomerReply(t: TicketRow, body: string): Promise<void> {
  const s = await getSettings();
  await notifyTeam(s.notify, `💬 پاسخ مشتری در ${t.code}\n${t.subject}\n\n${body.slice(0, 600)}\n\n${env.siteUrl}/admin/tickets/${t.code}`);
}

/** E-mails a staff reply to the customer; `status` is the ticket's status after the reply (a closed ticket takes no replies). */
export async function noticeStaffReply(t: TicketRow, body: string, status: TicketStatus): Promise<void> {
  const s = await getSettings();
  if (!s.notify.emailCustomers || !(await canEmail())) return;
  const key = accessKeyOf(t);
  if (!key) return;
  const link = ticketLink(t.code, key, t.lang);
  const fa = t.lang !== "en";
  const closed = status === "closed";
  const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const html = `<div dir="${fa ? "rtl" : "ltr"}" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#1a183a;max-width:560px">
<p>${fa ? `${esc(t.name)} عزیز، سلام` : `Hello ${esc(t.name)},`}</p>
<p>${fa ? `پاسخ جدیدی برای درخواست <b>${t.code}</b> («${esc(t.subject)}») ثبت شد:` : `There is a new reply to your request <b>${t.code}</b> (“${esc(t.subject)}”):`}</p>
<blockquote style="border-${fa ? "right" : "left"}:3px solid #df1173;margin:0;padding:8px 14px;background:#f7f3fa;white-space:pre-wrap">${esc(body)}</blockquote>
<p><a href="${link}" style="display:inline-block;background:#df1173;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${closed ? (fa ? "مشاهده‌ی پاسخ" : "View the reply") : fa ? "مشاهده و پاسخ" : "View and reply"}</a></p>
<p style="color:#6b6880;font-size:12px">${fa ? "مدیریت پروژه پارس" : "Pars Project Management"} · ${STATUS_LABEL[status][fa ? "fa" : "en"]}</p></div>`;
  await emailCustomer(t.email, fa ? `پاسخ به درخواست ${t.code}` : `Reply to your request ${t.code}`, html);
}
