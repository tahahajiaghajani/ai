"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { clientIp, hashIp } from "@/lib/crypto";
import { allow } from "@/lib/rate-limit";
import { endSession, requireAdmin, startSession } from "@/lib/admin-auth";
import { getFile, GhError, putFile } from "@/lib/github";
import { KNOWLEDGE_FILE, parseKnowledgeFile, serializeKnowledgeFile, type Fact } from "@/lib/knowledge-file";
import { addMessage, getRequest, setStatus, triageRequest } from "@/lib/requests";
import { isStatus } from "@/lib/request-meta";
import { ui } from "@/content/ui";

const text = (f: FormData, k: string, max: number) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
const number = (f: FormData) => Number(text(f, "n", 12)) || 0;

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  if (!(await allow(`admin:login:${hashIp(clientIp(h))}`, 900, 8))) return { error: "تلاش‌های زیاد؛ ۱۵ دقیقه بعد دوباره امتحان کنید." };
  if (!(await startSession(text(form, "password", 200)))) return { error: "رمز درست نیست یا ADMIN_PASSWORD و APP_SECRET تنظیم نشده‌اند." };
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/admin/login");
}

export type ReplyState = { ok: boolean; error?: string; warning?: string; at?: number } | null;

const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : "خطای GitHub");

/**
 * The owner's answer; errors come back to the form so the typed reply is never lost. Once the comment exists the
 * reply counts as sent: a status that could not be saved afterwards is a warning, never "send it again".
 */
export async function ownerReply(_prev: ReplyState, form: FormData): Promise<ReplyState> {
  await requireAdmin();
  const n = number(form);
  const body = text(form, "body", 6000);
  if (body.length < 2) return { ok: false, error: "متن پاسخ خالی است." };
  // a failure leaves the page as it is (a refresh while GitHub is down would replace the form with an error page)
  let r;
  try {
    r = await getRequest(n);
  } catch (e) {
    return { ok: false, error: `ارسال نشد (${why(e)})؛ متن پاسخ سر جایش است، کمی بعد دوباره بفرستید.` };
  }
  if (!r) return { ok: false, error: "درخواست پیدا نشد." };
  let sent;
  try {
    sent = await addMessage(r, "owner", body);
  } catch (e) {
    // a timeout or dropped connection may still have created the comment: only then is the page refreshed to show it
    const unsure = e instanceof GhError && e.status === 0;
    if (!unsure) return { ok: false, error: `ارسال نشد (${why(e)})؛ متن پاسخ سر جایش است، دوباره بفرستید.` };
    revalidatePath(`/admin/requests/${n}`);
    return { ok: false, error: `معلوم نیست ارسال شد (${why(e)}). متن پاسخ سر جایش است؛ اگر در فهرست پیام‌ها نیامده، دوباره بفرستید.` };
  }
  let warning = sent.updated ? undefined : "پاسخ فرستاده شد، ولی وضعیت درخواست به‌روز نشد؛ وضعیت را از دکمه‌های بالا عوض کنید.";
  const status = text(form, "status", 20);
  if (isStatus(status) && status !== "answered") {
    try {
      await setStatus(n, status);
      warning = undefined;
    } catch (e) {
      warning = `پاسخ فرستاده شد، ولی وضعیت «${ui.track.status[status].fa}» ذخیره نشد (${why(e)})؛ از دکمه‌های بالا دوباره امتحان کنید.`;
    }
  }
  revalidatePath(`/admin/requests/${n}`);
  revalidatePath("/admin");
  return { ok: true, warning, at: Date.now() };
}

export async function changeStatus(form: FormData): Promise<void> {
  await requireAdmin();
  const n = number(form);
  const status = text(form, "status", 20);
  const r = await getRequest(n);
  if (!r || !isStatus(status)) return;
  await setStatus(r.number, status);
  revalidatePath(`/admin/requests/${n}`);
  revalidatePath("/admin");
}

export async function retriage(form: FormData): Promise<void> {
  await requireAdmin();
  const r = await getRequest(number(form));
  if (!r) return;
  await triageRequest(r.number, { signal: AbortSignal.timeout(50_000) });
  revalidatePath(`/admin/requests/${r.number}`);
}

/** Read-modify-write of knowledge.md; one retry when the file changed in between (e.g. edited on GitHub). */
async function changeKnowledge(change: (facts: Fact[]) => Fact[], message: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const f = await getFile(KNOWLEDGE_FILE);
    try {
      await putFile(KNOWLEDGE_FILE, serializeKnowledgeFile(change(f ? parseKnowledgeFile(f.text) : [])), message, f?.sha);
      break;
    } catch (e) {
      if (attempt === 0 && e instanceof GhError && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
  updateTag("knowledge");
  revalidatePath("/admin/knowledge");
}

export async function addFact(form: FormData): Promise<void> {
  await requireAdmin();
  const title = text(form, "title", 200);
  const body = text(form, "body", 6000);
  if (!title || !body) return;
  const tags = text(form, "tags", 300).split(/[,،]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  await changeKnowledge((facts) => [...facts, { title, body, tags }], `Panel: add knowledge «${title.slice(0, 60)}»`);
}

/** Picks up edits made to knowledge.md on GitHub at once instead of after the cache expires. */
export async function refreshKnowledge(): Promise<void> {
  await requireAdmin();
  updateTag("knowledge");
  revalidatePath("/admin/knowledge");
}

export async function deleteFact(form: FormData): Promise<void> {
  await requireAdmin();
  const index = Number(text(form, "index", 6));
  const title = text(form, "title", 200);
  // the title must still match, so a file edited on GitHub in the meantime never loses the wrong fact
  await changeKnowledge((facts) => facts.filter((f, i) => !(i === index && f.title === title)), `Panel: remove knowledge «${title.slice(0, 60)}»`);
}
