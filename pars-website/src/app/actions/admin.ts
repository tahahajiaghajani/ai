"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { assertAdmin, checkPassword, endSession, startSession } from "@/lib/admin-auth";
import { USERS, currentUser, endUserSession, startUserSession } from "@/lib/auth";
import { hashIp, encrypt } from "@/lib/crypto";
import { db, requireDb } from "@/lib/db";
import { latinDigits as toLatinDigits } from "@/lib/digits";
import { clientIp } from "@/lib/request";
import { allow } from "@/lib/rate-limit";
import { getSettingsFresh, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type AiSettings, type ChatSettings, type NotifySettings, type ProviderId, type SiteContent, type SupportSettings } from "@/lib/settings-types";
import { DEFAULT_KNOWLEDGE } from "@/lib/knowledge-default";
import { getKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";
import { chatSystemPrompt, complete, runtimeFrom, type Attempt } from "@/lib/ai/runtime";
import { ProviderError } from "@/lib/ai/providers";
import { aiErrorText } from "@/lib/ai-errors";
import { notifyTeam } from "@/lib/notify";
import { addMessage, getTicket, noticeStaffReply, setStatus, triageTicket } from "@/lib/tickets";
import { dueAt, isCategory, isPriority, isStatus } from "@/lib/ticket-meta";

export type AdminResult<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

async function guard<R extends AdminResult>(fn: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  try {
    await assertAdmin();
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "unauthorized") return { ok: false, error: "نشست شما منقضی شده است؛ دوباره وارد شوید." };
    if (msg === "db_missing") return { ok: false, error: "پایگاه داده تنظیم نشده است." };
    if (e instanceof ProviderError) return { ok: false, error: aiErrorText(e) };
    if (e instanceof Error && e.name === "TimeoutError") return { ok: false, error: "سرویس در زمان مقرر پاسخ نداد؛ کمی بعد دوباره امتحان کنید." };
    console.error("[admin]", e);
    return { ok: false, error: msg.slice(0, 300) };
  }
}

function str(v: unknown, max = 20000): string {
  // Postgres text and jsonb reject NUL
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

/** An API key as pasted: spaces, line breaks and invisible direction marks (common when copying in RTL pages) removed. */
function cleanKey(v: unknown): string {
  return str(v, 500).replace(/[\s\p{Cf}]/gu, "");
}

/** A sort value for an int4 column: 0 and negatives are kept, fractions rounded, anything else → fallback. */
function toSort(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(-2147483648, Math.min(2147483647, Math.round(n))) : fallback;
}

/** Persian and Arabic-Indic digits (and ٪) → ASCII, for values the pages parse (tel: links, counters); num() shows them in Persian again. */
function latinDigits(s: string): string {
  return toLatinDigits(s).replace(/٪/g, "%");
}

function refreshAdmin() {
  revalidatePath("/admin", "layout");
}

// ---------------------------------------------------------------- session

export async function login(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const ip = hashIp(await clientIp());
  if (!(await allow(`admin-login:${ip}`, 900, 8))) return { error: "تلاش‌های زیادی انجام شد؛ ۱۵ دقیقه‌ی دیگر امتحان کنید." };
  if (!checkPassword(String(form.get("password") ?? ""))) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: "رمز عبور درست نیست." };
  }
  await startSession();
  // the password also promotes the account signed in in this browser, so from now on it is recognized as admin
  const me = await currentUser();
  if (me && me.role !== "admin") {
    const { error } = await requireDb().from(USERS).update({ role: "admin", updated_at: new Date().toISOString() }).eq("id", me.id);
    if (error) console.error("[admin] promote", error.message);
    else await startUserSession({ ...me, role: "admin" });
  }
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await endSession();
  await endUserSession();
  redirect("/");
}

// --------------------------------------------------------------- settings

export async function saveAi(input: Omit<AiSettings, "apiKeyEnc" | "apiKeyHint"> & { apiKey?: string; clearKey?: boolean }): Promise<AdminResult> {
  return guard(async () => {
    const cur = (await getSettingsFresh()).ai;
    const provider: ProviderId = ["google", "anthropic", "openai"].includes(input.provider) ? input.provider : "google";
    const next: AiSettings = {
      enabled: Boolean(input.enabled),
      provider,
      model: str(input.model, 120) || DEFAULT_SETTINGS.ai.model,
      fallbackModels: (Array.isArray(input.fallbackModels) ? input.fallbackModels : []).map((m) => str(m, 120)).filter(Boolean).slice(0, 6),
      baseUrl: str(input.baseUrl, 300).replace(/\/$/, ""),
      temperature: Math.min(1.5, Math.max(0, Number(input.temperature) || 0)),
      maxTokens: Math.min(8000, Math.max(200, Math.round(Number(input.maxTokens) || 1200))),
      instructions: str(input.instructions, 6000),
      apiKeyEnc: cur.apiKeyEnc,
      apiKeyHint: cur.apiKeyHint,
    };
    const key = cleanKey(input.apiKey);
    if (input.clearKey) {
      next.apiKeyEnc = undefined;
      next.apiKeyHint = undefined;
    } else if (key) {
      next.apiKeyEnc = encrypt(key);
      next.apiKeyHint = `…${key.slice(-4)}`;
    }
    await saveSettings("ai", next);
    refreshAdmin();
    return { ok: true, message: "تنظیمات هوش مصنوعی ذخیره شد." };
  });
}

export type AiTest = { success: boolean; answer: string; model: string; ms: number; attempts: Attempt[]; error: string };

/**
 * Sends one short question through the whole model chain with the saved settings (or the unsaved form values) and
 * reports every model's result with the provider's own message, so the admin sees which models this key can use.
 */
export async function testAi(input?: { provider: ProviderId; model: string; baseUrl: string; apiKey?: string; fallbackModels?: string[] }): Promise<AdminResult<AiTest>> {
  return guard(async () => {
    const s = await getSettingsFresh();
    const ai: AiSettings = input
      ? {
          ...s.ai,
          provider: input.provider,
          model: str(input.model, 120),
          baseUrl: str(input.baseUrl, 300).replace(/\/$/, ""),
          enabled: true,
          // the stored fallbacks belong to the stored provider
          fallbackModels: Array.isArray(input.fallbackModels) ? input.fallbackModels.map((m) => str(m, 120)).filter(Boolean).slice(0, 6) : input.provider === s.ai.provider ? s.ai.fallbackModels : [],
        }
      : s.ai;
    const key = cleanKey(input?.apiKey);
    if (key) ai.apiKeyEnc = encrypt(key);
    const rt = runtimeFrom(ai);
    if (!rt) return { ok: false, error: "کلید API تنظیم نشده است." };
    const started = Date.now();
    const attempts: Attempt[] = [];
    try {
      const { entries } = await getKnowledge();
      const { text, model } = await complete(rt, chatSystemPrompt(selectKnowledge(entries, "معرفی پارس"), rt.instructions), [{ role: "user", content: "در یک جمله، پارس چه کاری انجام می‌دهد؟" }], {
        maxTokens: 300,
        fresh: true,
        signal: AbortSignal.timeout(90_000),
        onAttempt: (x) => attempts.push(x),
      });
      return { ok: true, success: true, answer: text.replace(/\[\[[^\]]*\]\]/g, "").trim(), model, ms: Date.now() - started, attempts, error: "" };
    } catch (e) {
      const error = e instanceof ProviderError ? aiErrorText(e) : e instanceof Error && e.name === "TimeoutError" ? "آزمایش در ۹۰ ثانیه تمام نشد." : e instanceof Error ? e.message.slice(0, 300) : "خطا";
      return { ok: true, success: false, answer: "", model: "", ms: Date.now() - started, attempts, error };
    }
  });
}

export async function saveChat(input: ChatSettings): Promise<AdminResult> {
  return guard(async () => {
    const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 8);
    await saveSettings("chat", {
      greetingFa: str(input.greetingFa, 600),
      greetingEn: str(input.greetingEn, 600),
      suggestionsFa: list(input.suggestionsFa),
      suggestionsEn: list(input.suggestionsEn),
      perTenMinutes: Math.min(200, Math.max(1, Math.round(Number(input.perTenMinutes) || 20))),
      perDay: Math.min(5000, Math.max(1, Math.round(Number(input.perDay) || 120))),
      logChats: Boolean(input.logChats),
    });
    refreshAdmin();
    return { ok: true, message: "تنظیمات گفتگو ذخیره شد." };
  });
}

export async function saveSupport(input: SupportSettings): Promise<AdminResult> {
  return guard(async () => {
    await saveSettings("support", { deflection: Boolean(input.deflection), triage: Boolean(input.triage) });
    refreshAdmin();
    return { ok: true, message: "ذخیره شد." };
  });
}

export async function saveSite(input: SiteContent): Promise<AdminResult> {
  return guard(async () => {
    const d = DEFAULT_SETTINGS.site;
    const c = input.ceo ?? d.ceo;
    const k = input.contact ?? d.contact;
    const so = input.social ?? d.social;
    const url = (v: unknown) => {
      const u = str(v, 400);
      return /^https?:\/\//i.test(u) ? u : "";
    };
    const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 6);
    await saveSettings("site", {
      ceo: {
        nameFa: str(c.nameFa, 120),
        nameEn: str(c.nameEn, 120),
        titleFa: str(c.titleFa, 120),
        titleEn: str(c.titleEn, 120),
        quoteFa: str(c.quoteFa, 1200),
        quoteEn: str(c.quoteEn, 1200),
        bioFa: str(c.bioFa, 1500),
        bioEn: str(c.bioEn, 1500),
        years: latinDigits(str(c.years, 12)),
        highlightsFa: list(c.highlightsFa),
        highlightsEn: list(c.highlightsEn),
      },
      contact: {
        phones: (Array.isArray(k.phones) ? k.phones : []).map((p) => latinDigits(str(p, 40))).filter(Boolean).slice(0, 4),
        email: str(k.email, 120),
        addressFa: str(k.addressFa, 300),
        addressEn: str(k.addressEn, 300),
        mapUrl: url(k.mapUrl),
        hoursFa: str(k.hoursFa, 120),
        hoursEn: str(k.hoursEn, 120),
      },
      social: { linkedin: url(so.linkedin), telegram: url(so.telegram), instagram: url(so.instagram), bale: url(so.bale), aparat: url(so.aparat) },
      stats: (Array.isArray(input.stats) ? input.stats : d.stats).slice(0, 4).map((s) => ({ value: latinDigits(str(s.value, 12)), labelFa: str(s.labelFa, 80), labelEn: str(s.labelEn, 80) })),
    });
    refreshAdmin();
    return { ok: true, message: "محتوای سایت ذخیره شد و صفحه‌ها به‌روز شدند." };
  });
}

export async function saveNotify(input: Omit<NotifySettings, "botTokenEnc" | "botTokenHint"> & { botToken?: string; clearToken?: boolean }): Promise<AdminResult> {
  return guard(async () => {
    const cur = (await getSettingsFresh()).notify;
    const channel = (["none", "telegram", "bale"] as const).includes(input.channel) ? input.channel : "none";
    const next: NotifySettings = { channel, chatId: str(input.chatId, 60), emailCustomers: Boolean(input.emailCustomers), botTokenEnc: cur.botTokenEnc, botTokenHint: cur.botTokenHint };
    const token = str(input.botToken, 200);
    if (input.clearToken) {
      next.botTokenEnc = undefined;
      next.botTokenHint = undefined;
    } else if (token) {
      next.botTokenEnc = encrypt(token);
      next.botTokenHint = `…${token.slice(-4)}`;
    }
    await saveSettings("notify", next);
    refreshAdmin();
    return { ok: true, message: "تنظیمات اعلان ذخیره شد." };
  });
}

export async function testNotify(): Promise<AdminResult> {
  return guard(async () => {
    const n = (await getSettingsFresh()).notify;
    if (n.channel === "none" || !n.chatId || !n.botTokenEnc) return { ok: false, error: "ابتدا کانال، توکن ربات و شناسه‌ی گفتگو را ذخیره کنید." };
    const r = await notifyTeam(n, "✅ پیام آزمایشی از سایت مدیریت پروژه پارس — اعلان‌ها درست کار می‌کنند.");
    if (!r.ok) return { ok: false, error: `ارسال نشد (${r.error})؛ توکن ربات، شناسه‌ی گفتگو و عضویت ربات در گروه را بررسی کنید.` };
    return { ok: true, message: "پیام آزمایشی ارسال شد؛ گفتگوی ربات را بررسی کنید." };
  });
}

// -------------------------------------------------------------- knowledge

function refreshKnowledge() {
  revalidateTag("knowledge", { expire: 0 });
  refreshAdmin();
}

export async function upsertKnowledge(input: { id?: string; title: string; body: string; tags: string[]; pinned: boolean; enabled: boolean; sort: number }): Promise<AdminResult<{ id: string }>> {
  return guard(async () => {
    const c = requireDb();
    const row = {
      title: str(input.title, 200),
      body: str(input.body, 20000),
      tags: (Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 20),
      pinned: Boolean(input.pinned),
      enabled: Boolean(input.enabled),
      sort: toSort(input.sort, 100),
      updated_at: new Date().toISOString(),
    };
    if (!row.title || !row.body) return { ok: false, error: "عنوان و متن الزامی است." };
    const q = input.id ? c.from("pars_knowledge").update(row).eq("id", input.id).select("id").single() : c.from("pars_knowledge").insert(row).select("id").single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    refreshKnowledge();
    return { ok: true, id: data.id as string, message: "ذخیره شد؛ دستیار از همین حالا با این دانش پاسخ می‌دهد." };
  });
}

export async function deleteKnowledge(id: string): Promise<AdminResult> {
  return guard(async () => {
    const { error } = await requireDb().from("pars_knowledge").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refreshKnowledge();
    return { ok: true, message: "حذف شد." };
  });
}

export async function importKnowledge(input: { mode: "defaults" | "json"; json?: string; replace?: boolean }): Promise<AdminResult<{ count: number }>> {
  return guard(async () => {
    const c = requireDb();
    let rows: { title: string; body: string; tags: string[]; pinned: boolean; enabled: boolean; sort: number }[];
    if (input.mode === "defaults") rows = DEFAULT_KNOWLEDGE.map(({ title, body, tags, pinned, enabled, sort }) => ({ title, body, tags, pinned, enabled, sort }));
    else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.json ?? "");
      } catch {
        return { ok: false, error: "JSON معتبر نیست." };
      }
      if (!Array.isArray(parsed)) return { ok: false, error: "فایل باید آرایه‌ای از مدخل‌ها باشد." };
      rows = parsed
        .filter((r) => r && typeof r.title === "string" && typeof r.body === "string")
        .map((r, i) => ({ title: str(r.title, 200), body: str(r.body, 20000), tags: Array.isArray(r.tags) ? r.tags.map((t: unknown) => str(t, 60)).filter(Boolean).slice(0, 20) : [], pinned: Boolean(r.pinned), enabled: r.enabled !== false, sort: toSort(r.sort, (i + 1) * 10) }))
        .filter((r) => r.title && r.body)
        .slice(0, 500);
    }
    if (!rows.length) return { ok: false, error: "هیچ مدخل معتبری (با title و body) در فایل نبود؛ چیزی تغییر نکرد." };
    // insert first: if it fails, the current entries are still there
    const { data, error } = await c.from("pars_knowledge").insert(rows).select("created_at");
    if (error) throw new Error(error.message);
    if (input.replace) {
      // one insert = one transaction, so every new row has the same created_at (now()) and all older rows are before it
      const since = (data?.[0] as { created_at?: string } | undefined)?.created_at;
      if (!since) throw new Error("import: missing created_at");
      const { error } = await c.from("pars_knowledge").delete().lt("created_at", since);
      if (error) throw new Error(error.message);
    }
    refreshKnowledge();
    return { ok: true, count: rows.length, message: `${rows.length} مدخل وارد شد.` };
  });
}

/** Asks the assistant with the current knowledge (admin playground — no rate limit, not logged). */
export async function askAssistant(question: string): Promise<AdminResult<{ answer: string; model: string; used: string[] }>> {
  return guard(async () => {
    const s = await getSettingsFresh();
    const rt = runtimeFrom({ ...s.ai, enabled: true });
    if (!rt) return { ok: false, error: "کلید API تنظیم نشده است." };
    const { entries } = await getKnowledge();
    const used = selectKnowledge(entries, question);
    try {
      const { text, model } = await complete(rt, chatSystemPrompt(used, rt.instructions), [{ role: "user", content: str(question, 4000) }]);
      return { ok: true, answer: text, model, used: used.map((e) => e.title) };
    } catch (e) {
      return { ok: false, error: e instanceof ProviderError ? aiErrorText(e) : e instanceof Error ? e.message.slice(0, 300) : "خطا" };
    }
  });
}

// ------------------------------------------------------------------ demos

export async function upsertDemo(input: { id?: string; title_fa: string; title_en: string; description_fa: string; description_en: string; url: string; tag: string; enabled: boolean; sort: number }): Promise<AdminResult> {
  return guard(async () => {
    const c = requireDb();
    const url = str(input.url, 600);
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "آدرس باید با http:// یا https:// شروع شود." };
    const row = {
      title_fa: str(input.title_fa, 120),
      title_en: str(input.title_en, 120),
      description_fa: str(input.description_fa, 400),
      description_en: str(input.description_en, 400),
      url,
      tag: str(input.tag, 40),
      enabled: Boolean(input.enabled),
      sort: toSort(input.sort, 100),
    };
    if (!row.title_fa) return { ok: false, error: "عنوان فارسی الزامی است." };
    const { error } = input.id ? await c.from("pars_demos").update(row).eq("id", input.id) : await c.from("pars_demos").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/api/demos");
    refreshAdmin();
    return { ok: true, message: "دمو ذخیره شد." };
  });
}

export async function deleteDemo(id: string): Promise<AdminResult> {
  return guard(async () => {
    const { error } = await requireDb().from("pars_demos").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/api/demos");
    refreshAdmin();
    return { ok: true, message: "حذف شد." };
  });
}

export async function reorderDemos(ids: string[]): Promise<AdminResult> {
  return guard(async () => {
    const c = requireDb();
    await Promise.all(ids.slice(0, 200).map((id, i) => c.from("pars_demos").update({ sort: (i + 1) * 10 }).eq("id", id)));
    revalidatePath("/api/demos");
    refreshAdmin();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- tickets

export async function staffReply(input: { code: string; body: string; internal: boolean; status?: string }): Promise<AdminResult> {
  return guard(async () => {
    const t = await getTicket(str(input.code, 20));
    if (!t) return { ok: false, error: "تیکت پیدا نشد." };
    const body = str(input.body, 8000);
    if (body.length < 2) return { ok: false, error: "متن پاسخ خالی است." };
    const status = await addMessage(t, "staff", body, Boolean(input.internal));
    if (!input.internal) {
      // "answered" is the default choice: it leaves a closed ticket closed; any other choice sets that status
      const chosen = isStatus(input.status) && input.status !== "answered" ? input.status : null;
      if (chosen) await setStatus(t, chosen);
      after(() => noticeStaffReply(t, body, chosen ?? status));
    }
    refreshAdmin();
    return { ok: true, message: input.internal ? "یادداشت داخلی ثبت شد." : "پاسخ برای مشتری ارسال شد." };
  });
}

export async function updateTicket(input: { code: string; status?: string; priority?: string; category?: string }): Promise<AdminResult> {
  return guard(async () => {
    const t = await getTicket(str(input.code, 20));
    if (!t) return { ok: false, error: "تیکت پیدا نشد." };
    const now = new Date().toISOString();
    const patch: Record<string, string> = { updated_at: now };
    if (isStatus(input.status)) {
      patch.status = input.status;
      // marked answered by hand (e.g. after a call): the first response is done, so it no longer counts as overdue
      if (input.status === "answered" && !t.first_response_at) patch.first_response_at = now;
    }
    if (isPriority(input.priority)) {
      patch.priority = input.priority;
      // the first-response deadline follows the priority, counted from when the ticket was created
      patch.due_at = dueAt(t.created_at, input.priority);
    }
    if (isCategory(input.category)) patch.category = input.category;
    const { error } = await requireDb().from("pars_tickets").update(patch).eq("id", t.id);
    if (error) throw new Error(error.message);
    refreshAdmin();
    return { ok: true, message: "به‌روز شد." };
  });
}

export async function retriage(code: string): Promise<AdminResult> {
  return guard(async () => {
    const t = await getTicket(str(code, 20));
    if (!t) return { ok: false, error: "تیکت پیدا نشد." };
    const r = await triageTicket(t.id, { manual: true });
    if (r !== "ok") return { ok: false, error: r === "no_ai" ? "هوش مصنوعی خاموش است یا کلید API تنظیم نشده است." : "تحلیل انجام نشد؛ کلید و سهمیه‌ی مدل را بررسی کنید." };
    refreshAdmin();
    return { ok: true, message: "تحلیل هوش مصنوعی به‌روز شد." };
  });
}

export async function deleteTicket(code: string): Promise<AdminResult> {
  return guard(async () => {
    const { error } = await requireDb().from("pars_tickets").delete().eq("code", str(code, 20));
    if (error) throw new Error(error.message);
    refreshAdmin();
    return { ok: true, message: "تیکت حذف شد." };
  });
}

// ------------------------------------------------------------------ chats

export async function reviewChat(id: string, reviewed: boolean): Promise<AdminResult> {
  return guard(async () => {
    const c = db();
    if (!c) return { ok: false, error: "پایگاه داده تنظیم نشده است." };
    await c.from("pars_chat_logs").update({ reviewed }).eq("id", id);
    refreshAdmin();
    return { ok: true };
  });
}

export async function deleteChats(input: { olderThanDays: number }): Promise<AdminResult> {
  return guard(async () => {
    const days = Math.max(1, Math.round(Number(input.olderThanDays) || 90));
    const { error } = await requireDb().from("pars_chat_logs").delete().lt("created_at", new Date(Date.now() - days * 86400_000).toISOString());
    if (error) throw new Error(error.message);
    refreshAdmin();
    return { ok: true, message: `گفتگوهای قدیمی‌تر از ${days} روز حذف شد.` };
  });
}
