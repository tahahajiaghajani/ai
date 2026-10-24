"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/admin-action";
import {
  approveRequest,
  createMember,
  deleteMember,
  extendMemberCode,
  issueForMember,
  rejectRequest,
  revealMemberCode,
  revokeMemberCode,
  setMemberDisabled,
  setMemberPassword,
  setMemberRole,
  updateMember,
  type Delivered,
} from "@/lib/members";
import { text, type Result } from "@/lib/action";

/** Admin: accounts, Pro requests and codes. Every action runs through guard() (session check first). */

function refresh() {
  revalidatePath("/admin", "layout");
}

/** What actually carried the code to the member; `warn` when nothing did (the admin sends it with the buttons). */
function deliveredNote(d: Delivered | null): { note: string; warn: boolean } {
  if (!d) return { note: "", warn: false };
  const ways = [d.inbox ? "در پیام‌های حساب عضو قرار گرفت" : "", d.sms ? "پیامک شد" : "", d.email ? "ایمیل شد" : ""].filter(Boolean);
  const smsFailed = d.smsError && d.smsError !== "not configured" ? ` (پیامک فرستاده نشد: ${d.smsError})` : "";
  if (!ways.length) return { note: `کد برای عضو فرستاده نشد${smsFailed}؛ با دکمه‌های زیر برایش بفرستید.`, warn: true };
  return { note: `کد ${ways.join("، ")}.${smsFailed}`, warn: Boolean(smsFailed) };
}

export async function adminCreateMember(input: Record<string, unknown>): Promise<Result<{ id: string; code: string | null; note: string; warn: boolean }>> {
  return guard(async () => {
    const r = await createMember({ ...input, name: input.name, phone: input.phone });
    refresh();
    return { ok: true, message: r.code ? "حساب ساخته شد و کد Pro صادر شد." : "حساب ساخته شد.", id: r.id, code: r.code, ...deliveredNote(r.delivered) };
  });
}

export async function adminUpdateMember(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await updateMember(text(input.id, 40), input);
    refresh();
    return { ok: true, message: "ذخیره شد." };
  });
}

export async function adminSetPassword(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await setMemberPassword(text(input.id, 40), typeof input.password === "string" ? input.password : "");
    refresh();
    return { ok: true, message: "رمز تازه ذخیره شد؛ کاربر از همه‌ی دستگاه‌ها خارج شد." };
  });
}

export async function adminSetDisabled(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const disabled = input.disabled === true;
    await setMemberDisabled(text(input.id, 40), disabled);
    refresh();
    return { ok: true, message: disabled ? "حساب غیرفعال شد." : "حساب فعال شد." };
  });
}

export async function adminSetRole(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const role = input.role === "admin" ? "admin" : "user";
    await setMemberRole(text(input.id, 40), role);
    refresh();
    return { ok: true, message: role === "admin" ? "این حساب اکنون مدیر است." : "دسترسی مدیر برداشته شد." };
  });
}

export async function adminDeleteMember(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await deleteMember(text(input.id, 40));
    refresh();
    return { ok: true, message: "حساب حذف شد." };
  });
}

/**
 * Same as adminDeleteMember, but without revalidating: called from the member's own page, which would
 * otherwise re-render as "not found" before the browser moves on to the list (the list loads fresh anyway).
 */
export async function adminDeleteMemberFromPage(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await deleteMember(text(input.id, 40));
    return { ok: true, message: "حساب حذف شد." };
  });
}

export async function adminApproveRequest(input: Record<string, unknown>): Promise<Result<{ code: string; note: string; warn: boolean; name: string; phone: string }>> {
  return guard(async () => {
    const r = await approveRequest(text(input.id, 40), input.days);
    refresh();
    return { ok: true, message: "درخواست تأیید و کد صادر شد.", code: r.code, ...deliveredNote(r.delivered), name: r.user.name, phone: r.user.phone };
  });
}

export async function adminRejectRequest(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await rejectRequest(text(input.id, 40), text(input.reply, 800));
    refresh();
    return { ok: true, message: "درخواست رد شد و به کاربر اطلاع داده شد." };
  });
}

export async function adminIssueCode(input: Record<string, unknown>): Promise<Result<{ code: string; note: string; warn: boolean }>> {
  return guard(async () => {
    const r = await issueForMember(text(input.userId, 40), input.days);
    refresh();
    const d = deliveredNote(r.delivered);
    const ended = r.ended ? " کد قبلی باطل شد و عضو از همه‌ی دستگاه‌ها خارج شد." : "";
    return { ok: true, message: "کد تازه صادر شد (کدهای قبلی این حساب باطل شدند).", code: r.code, note: `${d.note}${ended}`, warn: d.warn };
  });
}

export async function adminRevealCode(input: Record<string, unknown>): Promise<Result<{ code: string }>> {
  return guard(async () => ({ ok: true, code: await revealMemberCode(text(input.id, 40)) }));
}

export async function adminRevokeCode(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const r = await revokeMemberCode(text(input.id, 40));
    refresh();
    const extra = r.ended ? ` عضو از همه‌ی دستگاه‌ها خارج شد${r.passwordCleared ? " و رمزی که با این کد ساخته بود پاک شد" : ""}.` : "";
    return { ok: true, message: `کد باطل شد؛ قیمت‌ها برای این حساب دیگر نمایش داده نمی‌شود.${extra}` };
  });
}

export async function adminExtendCode(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await extendMemberCode(text(input.id, 40), input.days);
    refresh();
    return { ok: true, message: "اعتبار کد به‌روز شد." };
  });
}
