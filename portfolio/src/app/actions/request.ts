"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { clientIp, hashIp, hasSecret } from "@/lib/crypto";
import { ghConfigured } from "@/lib/github";
import { allow, allowAi } from "@/lib/rate-limit";
import { addMessage, createRequest, getRequest, getRequestByKey, markMessage, noticeNewRequest, noticeVisitorMessage, triageRequest, visitorTriage } from "@/lib/requests";
import { isKind, normalizeCode, type VisitorTriage } from "@/lib/request-meta";

export type SubmitResult =
  | { ok: true; code: string; key: string; triage: VisitorTriage | null }
  | { ok: false; error: "invalid" | "contact" | "rate" | "offline" | "failed"; field?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function field(f: FormData, k: string, max: number): string {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** A new collaboration / demo request: saved, triaged by AI (bounded wait), the owner notified in the background. */
export async function submitRequest(form: FormData): Promise<SubmitResult> {
  // honeypot: real people never fill this field
  if (field(form, "website", 200)) return { ok: false, error: "invalid" };
  const lang = field(form, "lang", 4) === "en" ? "en" : "fa";
  const name = field(form, "name", 120);
  const email = field(form, "email", 160);
  const phone = field(form, "phone", 60);
  const subject = field(form, "subject", 200);
  const body = field(form, "body", 6000);
  const kindRaw = field(form, "kind", 30);
  if (name.length < 2) return { ok: false, error: "invalid", field: "name" };
  if (body.length < 10) return { ok: false, error: "invalid", field: "body" };
  if (email && !EMAIL.test(email)) return { ok: false, error: "invalid", field: "email" };
  if (!email && phone.replace(/\D/g, "").length < 6 && !/^@?[a-z0-9_]{4,}$/i.test(phone)) return { ok: false, error: "contact" };
  // the tracking link is signed with APP_SECRET: without it a saved request could never be followed up
  if (!ghConfigured() || !hasSecret()) return { ok: false, error: "offline" };

  const h = await headers();
  const visitor = hashIp(clientIp(h));
  const [okHour, okDay] = await Promise.all([allow(`req:1h:${visitor}`, 3600, 4), allow(`req:day:${visitor}`, 86400, 10)]);
  if (!okHour || !okDay) return { ok: false, error: "rate" };
  // and a ceiling for the whole instance, well under GitHub's limits on creating content
  if (!(await allow("req:all:1h", 3600, 60))) return { ok: false, error: "rate" };

  const telegram = /^@[a-z0-9_]{4,}$/i.test(phone) ? phone : "";
  let created: { number: number; code: string; key: string };
  try {
    created = await createRequest({
      name,
      email,
      phone: telegram ? "" : phone,
      telegram,
      organization: field(form, "organization", 160),
      kind: isKind(kindRaw) ? kindRaw : "project",
      budget: field(form, "budget", 80),
      timeline: field(form, "timeline", 80),
      subject: subject || body.slice(0, 80),
      body,
      lang,
      source: field(form, "source", 40) || "site",
      visitor,
    });
  } catch (e) {
    console.error("[request] create failed", e);
    return { ok: false, error: "failed" };
  }

  // the visitor waits a little for the AI's reading; if it is slow, the same call finishes in the background
  const job = (await allowAi()) ? triageRequest(created.number).catch(() => null) : null;
  let triage: VisitorTriage | null = null;
  if (job) {
    const quick = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 22_000))]);
    if (quick) {
      const row = await getRequest(created.number).catch(() => null);
      triage = row ? visitorTriage(row) : null;
    }
  }
  after(async () => {
    if (!triage && job) {
      // never a second call while the first is still running; one retry if it failed, within the daily AI budget
      const done = await job;
      if (!done && (await allowAi())) {
        const row = await getRequest(created.number).catch(() => null);
        if (row && !row.ai_triage) await triageRequest(created.number).catch(() => null);
      }
    }
    await noticeNewRequest(created.number).catch((e) => console.error("[request] notice failed", e));
  });
  return { ok: true, code: created.code, key: created.key, triage };
}

export type ReplyResult = { ok: true } | { ok: false; error: "invalid" | "denied" | "closed" | "rate" | "failed" };

/** A follow-up message from the visitor on their tracking page. */
export async function replyToRequest(form: FormData): Promise<ReplyResult> {
  const code = normalizeCode(field(form, "code", 20));
  const key = field(form, "k", 80);
  const body = field(form, "body", 4000);
  if (body.length < 2) return { ok: false, error: "invalid" };
  const h = await headers();
  // per visitor, and a ceiling for the whole instance well under GitHub's limits on creating content
  if (!(await allow(`req:msg:${hashIp(clientIp(h))}`, 3600, 15)) || !(await allow("req:msg:all", 3600, 60))) return { ok: false, error: "rate" };
  const r = await getRequestByKey(code, key).catch(() => null);
  if (!r) return { ok: false, error: "denied" };
  if (r.status === "closed") return { ok: false, error: "closed" };
  let sent;
  try {
    sent = await addMessage(r, "visitor", body);
  } catch {
    return { ok: false, error: "failed" };
  }
  after(async () => {
    // the message is posted; a status that could not be saved is tried once more, and Taha is told if it still fails
    let saved = sent.updated;
    if (!saved) saved = await markMessage(r.number, "visitor", sent.at).then(() => true, () => false);
    await noticeVisitorMessage(r, body, saved);
  });
  return { ok: true };
}
