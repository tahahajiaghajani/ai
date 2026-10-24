import "server-only";
import { assertAdmin } from "@/lib/admin-auth";
import { isAdminPhone } from "@/lib/admin-phones";
import { EMAIL_RE, hashPassword, PASSWORD_MAX, PASSWORD_MIN, PROFILE_COLUMNS, USERS, type Account } from "@/lib/auth";
import { allRows, db, isMissingColumn, isMissingTable, requireDb, UserError } from "@/lib/db";
import { mailHtml, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { formatDate, normalizePhone } from "@/lib/format";
import { CODE_MARK, postMessage } from "@/lib/messages";
import { CODE_COLUMNS, CODES, codeState, issueCode, REQUESTS, revealCode, type CodeRow, type CodeState } from "@/lib/pro";
import { getSettings } from "@/lib/settings";
import { sendSms } from "@/lib/sms";

/** Admin side of accounts and Pro membership. Every exported function checks the admin session first. */

export interface MemberRow extends Account {
  created_at: string;
  last_sign_in_at: string | null;
  created_by_admin: boolean;
  admin_note: string;
  has_password: boolean;
  pro: { state: CodeState | "none"; expires_at: string | null; code_id: string | null; hint: string };
  orders: number;
  spent: number;
  pending_request: boolean;
}

export interface RequestRow {
  id: string;
  user_id: string;
  business: string;
  city: string;
  instagram: string;
  kind: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  reply: string;
  created_at: string;
  decided_at: string | null;
  user: Pick<Account, "name" | "phone" | "email" | "business" | "city"> | null;
}

export interface CodeListRow extends Omit<CodeRow, "code_enc"> {
  state: CodeState;
  user: Pick<Account, "name" | "phone"> | null;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

export async function listMembers(): Promise<MemberRow[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  let users: (Account & { created_at: string; last_sign_in_at: string | null; created_by_admin: boolean; admin_note: string; password_hash: string | null })[];
  try {
    users = await allRows((a, b) => c.from(USERS).select(`${PROFILE_COLUMNS}, created_at, last_sign_in_at, created_by_admin, admin_note, password_hash`).order("created_at", { ascending: false }).range(a, b));
  } catch (e) {
    if (isMissingTable(e as { code?: string })) return null;
    throw e;
  }
  const [codes, orders, requests] = await Promise.all([
    allRows<CodeRow>((a, b) => c.from(CODES).select(CODE_COLUMNS).is("revoked_at", null).order("created_at", { ascending: false }).range(a, b)),
    allRows<{ user_id: string; total: number; status: string }>((a, b) => c.from("celin_orders").select("user_id, total, status").order("created_at").range(a, b)),
    allRows<{ user_id: string }>((a, b) => c.from(REQUESTS).select("user_id").eq("status", "pending").range(a, b)),
  ]);
  const codeOf = new Map<string, CodeRow>();
  for (const k of codes) if (!codeOf.has(k.user_id)) codeOf.set(k.user_id, k);
  const stats = new Map<string, { n: number; spent: number }>();
  for (const o of orders) {
    const s = stats.get(o.user_id) ?? { n: 0, spent: 0 };
    s.n++;
    if (o.status !== "cancelled") s.spent += Number(o.total);
    stats.set(o.user_id, s);
  }
  const pending = new Set(requests.map((r) => r.user_id));
  return users.map(({ password_hash, ...u }) => {
    const k = codeOf.get(u.id);
    return {
      ...u,
      // the owner's number (ADMIN_PHONES) is an admin even before its next sign-in promotes it
      role: isAdminPhone(u.phone) ? "admin" : u.role,
      has_password: Boolean(password_hash),
      pro: k ? { state: codeState(k), expires_at: k.expires_at, code_id: k.id, hint: k.hint } : { state: "none", expires_at: null, code_id: null, hint: "" },
      orders: stats.get(u.id)?.n ?? 0,
      spent: stats.get(u.id)?.spent ?? 0,
      pending_request: pending.has(u.id),
    };
  });
}

/** How a new code reached the member (for the admin's note). */
export interface Delivered {
  /** the code is readable in the member's inbox on the site */
  inbox: boolean;
  sms: boolean;
  /** why the SMS was not sent ("" when it was, or SMS is off) */
  smsError: string;
  email: boolean;
}

/**
 * Sends a freshly issued code to the member: inbox (the code is shown there if the setting allows — stored
 * only as a placeholder, see messages.ts), SMS, e-mail. Module-private: callers check the admin session.
 */
async function deliverCode(user: Pick<Account, "id" | "name" | "phone" | "email">, code: string, expiresAt: string | null, reason: "request" | "admin"): Promise<Delivered> {
  await assertAdmin();
  const s = await getSettings();
  const until = expiresAt ? formatDate(expiresAt, "fa") : "";
  const untilEn = expiresAt ? formatDate(expiresAt, "en") : "";
  const site = env.siteUrl.replace(/^https?:\/\//, "");
  // inside Persian text the digit groups of "1234 5678 9012" would be laid out right-to-left; a leading LRM keeps their order
  const faCode = `\u200e${code}`;
  await postMessage(user.id, {
    kind: "pro",
    title_fa: "کد اشتراک Pro شما صادر شد",
    title_en: "Your Pro code has been issued",
    body_fa: s.pro.codeInInbox
      ? `کد اختصاصی شما: ${CODE_MARK}\nاین کد را در بخش «اشتراک Pro» یا هنگام ورود وارد کنید تا قیمت‌ها و موجودی محصولات نمایش داده شود و بتوانید سفارش ثبت کنید.${until ? `\nاعتبار تا ${until}` : ""}`
      : "کد اختصاصی شما از طریق پیامک یا تماس فروشگاه برایتان ارسال می‌شود. پس از دریافت، آن را در بخش «اشتراک Pro» وارد کنید.",
    body_en: s.pro.codeInInbox
      ? `Your personal code: ${CODE_MARK}\nEnter it under “Pro membership” or when signing in to see prices and stock and to place orders.${untilEn ? `\nValid until ${untilEn}` : ""}`
      : "Your personal code will reach you by text message or a call from the store. Enter it under “Pro membership” once you have it.",
    link: "/account/pro",
  });
  let sms = false;
  let smsError = "";
  if (s.sms.onCode && s.sms.provider !== "none") {
    const r = await sendSms(user.phone, { kind: "code", code, text: `سلین | کد اشتراک Pro شما: ${faCode}\nورود: ${site}/pro` }, s.sms);
    sms = r.ok;
    smsError = r.ok ? "" : String((r as { error?: string }).error ?? "failed");
  }
  let email = false;
  if (user.email) {
    const lead = reason === "request" ? "درخواست اشتراک Pro شما تأیید شد." : "اشتراک Pro سلین برای شما فعال شد.";
    const html = mailHtml(
      "fa",
      [`${user.name ? `${user.name} عزیز، ` : ""}${lead}`, `کد اختصاصی شما: ${faCode}`, "این کد را در سایت، بخش «اشتراک Pro» یا هنگام ورود وارد کنید تا قیمت‌ها و موجودی را ببینید و سفارش ثبت کنید."],
      { href: `${env.siteUrl}/pro`, label: "ورود کد در سایت" },
    );
    email = (await sendEmail(user.email, "کد اشتراک Pro سلین", html)).ok;
  }
  return { inbox: s.pro.codeInInbox, sms, smsError, email };
}

/**
 * What was opened with a code ends with it: every session of the account (session_version) and a password
 * the member set from a code session (password_from_code). Called when a used code is revoked or replaced.
 */
async function endCodeAccess(userId: string): Promise<{ passwordCleared: boolean }> {
  const c = requireDb();
  let row = await c.from(USERS).select("session_version, password_from_code").eq("id", userId).maybeSingle();
  if (isMissingColumn(row.error)) row = await c.from(USERS).select("session_version").eq("id", userId).maybeSingle();
  if (row.error) throw new Error(row.error.message);
  const u = row.data as { session_version: number; password_from_code?: boolean } | null;
  if (!u) return { passwordCleared: false };
  const clear = u.password_from_code === true;
  const { error } = await c
    .from(USERS)
    .update({ session_version: u.session_version + 1, updated_at: new Date().toISOString(), ...(clear ? { password_hash: null, password_from_code: false } : {}) })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  return { passwordCleared: clear };
}

export interface CreateMemberInput {
  name: unknown;
  phone: unknown;
  email?: unknown;
  business?: unknown;
  city?: unknown;
  address?: unknown;
  password?: unknown;
  admin_note?: unknown;
  issue?: unknown;
  days?: unknown;
}

/** Admin creates an account by hand (optionally with a password) and, if asked, issues its Pro code. */
export async function createMember(input: CreateMemberInput): Promise<{ id: string; code: string | null; delivered: Delivered | null }> {
  await assertAdmin();
  const c = requireDb();
  const name = text(input.name, 80);
  const phone = normalizePhone(text(input.phone, 30));
  const email = text(input.email, 160).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (name.length < 2) throw new UserError("نام را بنویسید.");
  if (!phone) throw new UserError("شماره‌ی موبایل معتبر نیست (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).");
  if (email && !EMAIL_RE.test(email)) throw new UserError("ایمیل معتبر نیست.");
  if (password && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) throw new UserError("رمز عبور باید دست‌کم ۸ نویسه باشد.");
  const row = {
    name,
    phone,
    email,
    business: text(input.business, 120),
    city: text(input.city, 80),
    address: text(input.address, 400),
    admin_note: text(input.admin_note, 1000),
    password_hash: password ? await hashPassword(password) : null,
    created_by_admin: true,
  };
  const { data, error } = await c.from(USERS).insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") throw new UserError("حسابی با این شماره یا ایمیل از قبل وجود دارد.");
    throw new Error(error.message);
  }
  const id = (data as { id: string }).id;
  if (input.issue === true || input.issue === "on" || input.issue === "true") {
    const days = Math.max(0, Math.round(Number(input.days ?? (await getSettings()).pro.defaultDays) || 0));
    const issued = await issueCode(id, { days });
    const delivered = await deliverCode({ id, name, phone, email }, issued.code, issued.expiresAt, "admin");
    return { id, code: issued.code, delivered };
  }
  return { id, code: null, delivered: null };
}

export async function updateMember(id: string, input: Record<string, unknown>): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("name" in input) {
    const name = text(input.name, 80);
    if (name.length < 2) throw new UserError("نام را بنویسید.");
    fields.name = name;
  }
  if ("phone" in input) {
    const phone = normalizePhone(text(input.phone, 30));
    if (!phone) throw new UserError("شماره‌ی موبایل معتبر نیست.");
    fields.phone = phone;
  }
  if ("email" in input) {
    const email = text(input.email, 160).toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw new UserError("ایمیل معتبر نیست.");
    fields.email = email;
  }
  for (const k of ["business", "city", "address", "postal_code", "admin_note"] as const) if (k in input) fields[k] = text(input[k], k === "admin_note" ? 1000 : 400);
  const { error } = await c.from(USERS).update(fields).eq("id", id);
  if (error) {
    if (error.code === "23505") throw new UserError("این شماره یا ایمیل برای حساب دیگری ثبت شده است.");
    throw new Error(error.message);
  }
}

async function bumpSession(id: string, extra: Record<string, unknown>): Promise<void> {
  const c = requireDb();
  const { data, error } = await c.from(USERS).select("session_version").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserError("حساب پیدا نشد.");
  const { error: ue } = await c
    .from(USERS)
    .update({ ...extra, session_version: (data as { session_version: number }).session_version + 1, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (ue) throw Object.assign(new Error(ue.message), { code: ue.code });
}

export async function setMemberPassword(id: string, password: string): Promise<void> {
  await assertAdmin();
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw new UserError("رمز عبور باید دست‌کم ۸ نویسه باشد.");
  const password_hash = await hashPassword(password);
  // a password the admin sets is the account's own, not tied to a Pro code
  try {
    await bumpSession(id, { password_hash, password_from_code: false });
  } catch (e) {
    if (!isMissingColumn(e as { code?: string })) throw e;
    await bumpSession(id, { password_hash });
  }
}

export async function setMemberDisabled(id: string, disabled: boolean): Promise<void> {
  await assertAdmin();
  await bumpSession(id, { disabled });
}

export async function setMemberRole(id: string, role: "user" | "admin"): Promise<void> {
  await assertAdmin();
  if (role === "user") {
    const { data } = await requireDb().from(USERS).select("phone").eq("id", id).maybeSingle();
    if (data && isAdminPhone((data as { phone: string }).phone)) throw new UserError("این شماره در ADMIN_PHONES (Vercel) آمده و همیشه مدیر است؛ برای برداشتن دسترسی، اول آن را از ADMIN_PHONES حذف و دوباره Deploy کنید.");
  }
  await bumpSession(id, { role });
}

export async function deleteMember(id: string): Promise<void> {
  await assertAdmin();
  const { error } = await requireDb().from(USERS).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ Pro requests & codes

export async function listRequests(): Promise<RequestRow[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from(REQUESTS).select("id, user_id, business, city, instagram, kind, note, status, reply, created_at, decided_at").order("created_at", { ascending: false }).limit(1000);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Omit<RequestRow, "user">[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = new Map<string, RequestRow["user"]>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: us } = await c.from(USERS).select("id, name, phone, email, business, city").in("id", ids.slice(i, i + 150));
    for (const u of (us ?? []) as (NonNullable<RequestRow["user"]> & { id: string })[]) users.set(u.id, u);
  }
  return rows.map((r) => ({ ...r, user: users.get(r.user_id) ?? null }));
}

const DECIDED = "این درخواست قبلاً بررسی شده است؛ صفحه را دوباره باز کنید.";

export async function approveRequest(requestId: string, daysInput?: unknown): Promise<{ code: string; delivered: Delivered; user: Pick<Account, "name" | "phone"> }> {
  await assertAdmin();
  const c = requireDb();
  // claim the request first (one approval only, even from two tabs or two admins)
  const { data, error } = await c.from(REQUESTS).update({ status: "approved", decided_at: new Date().toISOString(), reply: "" }).eq("id", requestId).eq("status", "pending").select("id, user_id").maybeSingle();
  if (error) throw new Error(error.message);
  const req = data as { id: string; user_id: string } | null;
  if (!req) {
    const { data: exists } = await c.from(REQUESTS).select("id").eq("id", requestId).maybeSingle();
    throw new UserError(exists ? DECIDED : "درخواست پیدا نشد.");
  }
  const { data: u, error: ue } = await c.from(USERS).select("id, name, phone, email, disabled").eq("id", req.user_id).maybeSingle();
  if (ue) throw new Error(ue.message);
  const user = u as (Pick<Account, "id" | "name" | "phone" | "email"> & { disabled: boolean }) | null;
  if (!user) throw new UserError("حساب این درخواست دیگر وجود ندارد.");
  const days = Math.max(0, Math.round(Number(daysInput ?? (await getSettings()).pro.defaultDays) || 0));
  let issued;
  try {
    issued = await issueCode(user.id, { days, requestId: req.id });
  } catch (e) {
    // give the request back, so it can be approved again
    await c.from(REQUESTS).update({ status: "pending", decided_at: null }).eq("id", req.id);
    throw e;
  }
  if (issued.replacedLive) await endCodeAccess(user.id);
  const delivered = await deliverCode(user, issued.code, issued.expiresAt, "request");
  return { code: issued.code, delivered, user: { name: user.name, phone: user.phone } };
}

export async function rejectRequest(requestId: string, reply: string): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const { data, error } = await c
    .from(REQUESTS)
    .update({ status: "rejected", reply: reply.trim().slice(0, 800), decided_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: exists } = await c.from(REQUESTS).select("id").eq("id", requestId).maybeSingle();
    throw new UserError(exists ? DECIDED : "درخواست پیدا نشد.");
  }
  await postMessage((data as { user_id: string }).user_id, {
    kind: "pro",
    title_fa: "درباره‌ی درخواست اشتراک Pro",
    title_en: "About your Pro request",
    body_fa: reply.trim() ? reply.trim().slice(0, 800) : "درخواست اشتراک Pro شما در حال حاضر تأیید نشد. برای اطلاعات بیشتر با فروشگاه در تماس باشید.",
    body_en: reply.trim() ? reply.trim().slice(0, 800) : "Your Pro request was not approved at this time. Please contact the store for details.",
    link: "/account/pro",
  });
}

/** Issues (or re-issues) a code for an account directly, without a request. */
export async function issueForMember(userId: string, daysInput?: unknown): Promise<{ code: string; delivered: Delivered; ended: boolean }> {
  await assertAdmin();
  const c = requireDb();
  const { data, error } = await c.from(USERS).select("id, name, phone, email").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const user = data as Pick<Account, "id" | "name" | "phone" | "email"> | null;
  if (!user) throw new UserError("حساب پیدا نشد.");
  const days = Math.max(0, Math.round(Number(daysInput ?? (await getSettings()).pro.defaultDays) || 0));
  const issued = await issueCode(user.id, { days });
  // the replaced code was in use: whoever used it is signed out (a leaked code is the usual reason to replace one)
  if (issued.replacedLive) await endCodeAccess(user.id);
  // an open request of this member is answered by this code
  await c.from(REQUESTS).update({ status: "approved", decided_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "pending");
  const delivered = await deliverCode(user, issued.code, issued.expiresAt, "admin");
  return { code: issued.code, delivered, ended: issued.replacedLive };
}

export async function listCodes(): Promise<CodeListRow[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from(CODES).select(CODE_COLUMNS).order("created_at", { ascending: false }).limit(2000);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as CodeRow[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = new Map<string, Pick<Account, "name" | "phone">>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: us } = await c.from(USERS).select("id, name, phone").in("id", ids.slice(i, i + 150));
    for (const u of (us ?? []) as (Pick<Account, "name" | "phone"> & { id: string })[]) users.set(u.id, { name: u.name, phone: u.phone });
  }
  return rows.map(({ code_enc: _, ...r }) => ({ ...r, state: codeState(r), user: users.get(r.user_id) ?? null }));
}

export async function revealMemberCode(codeId: string): Promise<string> {
  await assertAdmin();
  const { data, error } = await requireDb().from(CODES).select("code_enc").eq("id", codeId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserError("کد پیدا نشد.");
  const code = revealCode(data as { code_enc: string });
  if (!code) throw new UserError("این کد با کلید فعلی خوانده نمی‌شود (APP_SECRET عوض شده است)؛ کد تازه صادر کنید.");
  return code;
}

/**
 * Revokes a code. If it was in use, every session of the account ends and a password set from a code
 * session is removed (whoever had the code loses the account too); the member gets an inbox note.
 */
export async function revokeMemberCode(codeId: string): Promise<{ ended: boolean; passwordCleared: boolean }> {
  await assertAdmin();
  const c = requireDb();
  const { data, error } = await c.from(CODES).update({ revoked_at: new Date().toISOString() }).eq("id", codeId).is("revoked_at", null).select("user_id, redeemed_at, expires_at").maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { user_id: string; redeemed_at: string | null; expires_at: string | null } | null;
  if (!row) return { ended: false, passwordCleared: false };
  const used = Boolean(row.redeemed_at);
  const { passwordCleared } = used ? await endCodeAccess(row.user_id) : { passwordCleared: false };
  if (used && codeState({ ...row, revoked_at: null }) === "active") {
    await postMessage(row.user_id, {
      kind: "pro",
      title_fa: "اشتراک Pro شما پایان یافت",
      title_en: "Your Pro membership has ended",
      body_fa: "کد اشتراک Pro شما از سوی فروشگاه باطل شد و قیمت‌ها و موجودی دیگر نمایش داده نمی‌شود. برای تمدید یا کد تازه، از بخش «اشتراک Pro» درخواست دهید یا با فروشگاه تماس بگیرید.",
      body_en: "Your Pro code was revoked by the store, so prices and stock are no longer shown. To renew, send a request under “Pro membership” or contact the store.",
      link: "/account/pro",
    });
  }
  return { ended: used, passwordCleared };
}

/** Sets a new expiry: `days` from today (0 = never expires). */
export async function extendMemberCode(codeId: string, daysInput: unknown): Promise<void> {
  await assertAdmin();
  const days = Math.max(0, Math.round(Number(daysInput) || 0));
  const expires_at = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
  const { error } = await requireDb().from(CODES).update({ expires_at }).eq("id", codeId).is("revoked_at", null);
  if (error) throw new Error(error.message);
}
