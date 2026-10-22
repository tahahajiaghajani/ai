"use server";

import { after } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashIp } from "@/lib/crypto";
import { clientIp } from "@/lib/request";
import { allow } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import {
  accessKeyOf,
  addMessage,
  canAccess,
  createTicket,
  getTicket,
  noticeCustomerReply,
  noticeNewTicket,
  setStatus,
  suggestFromKnowledge,
  ticketPath,
  triageTicket,
} from "@/lib/tickets";
import { isCategory, isProduct, normalizeCode } from "@/lib/ticket-meta";

type Lang = "fa" | "en";
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MSG = {
  rate: { fa: "درخواست‌های زیادی ثبت شده؛ چند دقیقه‌ی دیگر دوباره امتحان کنید.", en: "Too many requests — please try again in a few minutes." },
  db: { fa: "ثبت درخواست موقتاً در دسترس نیست. لطفاً تماس بگیرید: ۰۲۱-۸۸۷۳۱۶۰۱", en: "Requests are temporarily unavailable. Please call +98 21 8873 1601." },
  invalid: { fa: "لطفاً فیلدهای ضروری را کامل و درست وارد کنید.", en: "Please fill in the required fields correctly." },
  email: { fa: "نشانی ایمیل معتبر نیست.", en: "The e-mail address is not valid." },
  notFound: { fa: "درخواستی با این کد و ایمیل پیدا نشد.", en: "No request matches this code and e-mail." },
  denied: { fa: "دسترسی به این درخواست مجاز نیست.", en: "You don't have access to this request." },
  closed: { fa: "این درخواست بسته شده است؛ برای موضوع جدید درخواست تازه ثبت کنید.", en: "This request is closed — please open a new one." },
  failed: { fa: "مشکلی پیش آمد؛ دوباره امتحان کنید.", en: "Something went wrong — please try again." },
  signIn: { fa: "برای ثبت درخواست، اول وارد حساب کاربری شوید.", en: "Please sign in to submit a request." },
};

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function visitor(): Promise<string> {
  return hashIp(await clientIp());
}

export async function suggestAnswer(input: { subject: string; body: string; lang: Lang }): Promise<Result<{ answer: string | null }>> {
  const lang: Lang = input.lang === "en" ? "en" : "fa";
  const subject = text(input.subject, 160);
  const body = text(input.body, 4000);
  if (subject.length + body.length < 12) return { ok: true, answer: null };
  const s = await getSettings();
  if (!s.support.deflection) return { ok: true, answer: null };
  if (!(await allow(`suggest:${await visitor()}`, 600, 8))) return { ok: true, answer: null };
  // suggestFromKnowledge also returns null once the visitors' shared daily AI budget is used up
  return { ok: true, answer: await suggestFromKnowledge(subject, body, lang) };
}

export async function submitTicket(input: Record<string, unknown>): Promise<Result<{ code: string; key: string; url: string }>> {
  const lang: Lang = input.lang === "en" ? "en" : "fa";
  if (text(input.website, 200)) return { ok: false, error: MSG.invalid[lang] }; // honeypot
  // tickets need an account: the reply e-mail and "my requests" come from it
  const me = await currentUser();
  if (!me) return { ok: false, error: MSG.signIn[lang] };
  const data = {
    name: text(input.name, 80) || me.name,
    email: me.email,
    user_id: me.id,
    phone: text(input.phone, 30) || me.phone,
    organization: text(input.organization, 120) || me.organization,
    subject: text(input.subject, 160),
    body: text(input.body, 6000),
    source: text(input.source, 160),
    lang,
    product: isProduct(input.product) ? input.product : "other",
    category: isCategory(input.category) ? input.category : "support",
  } as const;
  if (data.name.length < 2 || data.subject.length < 3 || data.body.length < 10) return { ok: false, error: MSG.invalid[lang] };
  if (!EMAIL.test(data.email)) return { ok: false, error: MSG.email[lang] };
  if (!db()) return { ok: false, error: MSG.db[lang] };
  if (!(await allow(`ticket:${await visitor()}`, 3600, 6))) return { ok: false, error: MSG.rate[lang] };
  try {
    const { code, key, id } = await createTicket(data);
    after(async () => {
      await triageTicket(id);
      await noticeNewTicket(code);
    });
    // a same-origin path: the browser stays on the deployment the visitor is using (e-mails use the absolute ticketLink)
    return { ok: true, code, key, url: ticketPath(code, key, lang) };
  } catch (e) {
    console.error("[ticket] create failed", e);
    return { ok: false, error: MSG.failed[lang] };
  }
}

export async function findTicket(input: { code: string; email: string; lang: Lang }): Promise<Result<{ url: string }>> {
  const lang: Lang = input.lang === "en" ? "en" : "fa";
  if (!db()) return { ok: false, error: MSG.db[lang] };
  if (!(await allow(`find:${await visitor()}`, 600, 10))) return { ok: false, error: MSG.rate[lang] };
  const t = await getTicket(normalizeCode(text(input.code, 20)));
  const email = text(input.email, 120).toLowerCase();
  if (!t || t.email.toLowerCase() !== email) return { ok: false, error: MSG.notFound[lang] };
  const key = accessKeyOf(t);
  if (!key) return { ok: false, error: MSG.failed[lang] };
  return { ok: true, url: ticketPath(t.code, key, lang) };
}

export async function replyTicket(input: { code: string; key: string; body: string; lang: Lang }): Promise<Result> {
  const lang: Lang = input.lang === "en" ? "en" : "fa";
  const body = text(input.body, 6000);
  if (body.length < 2) return { ok: false, error: MSG.invalid[lang] };
  if (!(await allow(`reply:${await visitor()}`, 600, 20))) return { ok: false, error: MSG.rate[lang] };
  const t = await getTicket(text(input.code, 20));
  if (!t || !canAccess(t, input.key)) return { ok: false, error: MSG.denied[lang] };
  if (t.status === "closed") return { ok: false, error: MSG.closed[lang] };
  await addMessage(t, "customer", body);
  after(() => noticeCustomerReply(t, body));
  return { ok: true };
}

export async function closeTicket(input: { code: string; key: string; status: "resolved" | "closed"; rating?: number; note?: string; lang: Lang }): Promise<Result> {
  const lang: Lang = input.lang === "en" ? "en" : "fa";
  const t = await getTicket(text(input.code, 20));
  if (!t || !canAccess(t, input.key)) return { ok: false, error: MSG.denied[lang] };
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  if (input.status === "resolved" || input.status === "closed") await setStatus(t, input.status);
  const rating = Number(input.rating);
  if (rating >= 1 && rating <= 5) await c.from("pars_tickets").update({ rating: Math.round(rating), rating_note: text(input.note, 500) || null }).eq("id", t.id);
  return { ok: true };
}

/** 👍 / 👎 on an assistant answer — flags it for review in the admin panel. */
export async function rateAnswer(input: { logId: string; rating: 1 | -1 }): Promise<Result> {
  const c = db();
  if (!c || !/^[0-9a-f-]{36}$/i.test(input.logId)) return { ok: true };
  if (!(await allow(`rate:${await visitor()}`, 600, 30))) return { ok: true };
  await c.from("pars_chat_logs").update({ rating: input.rating === 1 ? 1 : -1, reviewed: false }).eq("id", input.logId);
  return { ok: true };
}
