"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { clientIp, hashIp } from "@/lib/crypto";
import { allow } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { endSession, requireAdmin, startSession } from "@/lib/admin-auth";
import { addMessage, getRequest, setStatus, triageRequest } from "@/lib/requests";
import { isStatus, normalizeCode } from "@/lib/request-meta";

const text = (f: FormData, k: string, max: number) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};

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

export async function ownerReply(form: FormData): Promise<void> {
  await requireAdmin();
  const code = normalizeCode(text(form, "code", 20));
  const body = text(form, "body", 6000);
  const r = await getRequest(code);
  if (!r || body.length < 2) return;
  await addMessage(r, "owner", body);
  const status = text(form, "status", 20);
  if (isStatus(status) && status !== "answered") await setStatus(r.id, status);
  revalidatePath(`/admin/requests/${code}`);
}

export async function changeStatus(form: FormData): Promise<void> {
  await requireAdmin();
  const code = normalizeCode(text(form, "code", 20));
  const status = text(form, "status", 20);
  const r = await getRequest(code);
  if (!r || !isStatus(status)) return;
  await setStatus(r.id, status);
  revalidatePath(`/admin/requests/${code}`);
  revalidatePath("/admin");
}

export async function retriage(form: FormData): Promise<void> {
  await requireAdmin();
  const r = await getRequest(normalizeCode(text(form, "code", 20)));
  if (!r) return;
  await triageRequest(r.id, { signal: AbortSignal.timeout(50_000) });
  revalidatePath(`/admin/requests/${r.code}`);
}

export async function addFact(form: FormData): Promise<void> {
  await requireAdmin();
  const c = db();
  const title = text(form, "title", 200);
  const body = text(form, "body", 6000);
  if (!c || !title || !body) return;
  const tags = text(form, "tags", 300).split(/[,،]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
  await c.from("portfolio_knowledge").insert({ title, body, tags });
  revalidateTag("knowledge", "max");
  revalidatePath("/admin/knowledge");
}

export async function deleteFact(form: FormData): Promise<void> {
  await requireAdmin();
  const c = db();
  const id = text(form, "id", 60);
  if (!c || !id) return;
  await c.from("portfolio_knowledge").delete().eq("id", id);
  revalidateTag("knowledge", "max");
  revalidatePath("/admin/knowledge");
}
