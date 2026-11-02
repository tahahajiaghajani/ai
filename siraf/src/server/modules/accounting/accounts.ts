// Chart of accounts maintenance: add/edit/remove accounts in the three-level tree.
import type { Ctx } from "../../context";
import { insertRow, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { uuidv7 } from "@shared/id";
import { normalizeDigits } from "@shared/money";

export interface AccountInput {
  parent_id?: string | null;
  code?: string;
  name?: string;
  kind?: string;
  nature?: "debit" | "credit" | "both";
  detail_mode?: "none" | "optional" | "required";
  detail_kinds?: string[];
  fx_mode?: "none" | "optional" | "required";
  currency_id?: string | null;
  weight_mode?: "none" | "optional" | "required";
  system_key?: string | null;
  is_active?: boolean;
  description?: string | null;
}

const KINDS = ["asset", "liability", "equity", "income", "expense", "memo", "closing"];

export async function createAccount(ctx: Ctx, input: AccountInput) {
  ctx.need("accounting", "full");
  return ctx.write(async (tx) => {
    let level = 1;
    let kind = input.kind;
    let nature = input.nature ?? "both";
    if (input.parent_id) {
      const p = await tx.one<{ level: number; kind: string; nature: string; code: string }>(`select level, kind, nature, code from tz_accounts where id = $1 and org_id = $2 and deleted_at is null`, [input.parent_id, ctx.org.id]);
      if (!p) throw notFound("حساب بالاتر پیدا نشد");
      if (p.level >= 3) throw bad("زیر حساب معین حساب جدید نمی‌توان ساخت؛ از حساب‌های تفصیلی استفاده کنید");
      const used = await tx.one(`select 1 from tz_voucher_lines where org_id = $1 and account_id = $2 limit 1`, [ctx.org.id, input.parent_id]);
      if (used) throw conflict("حساب بالاتر گردش دارد و نمی‌تواند زیرحساب بگیرد");
      level = p.level + 1;
      kind = kind ?? p.kind;
      nature = input.nature ?? (p.nature as typeof nature);
      if (!input.code) {
        const r = await tx.one<{ n: string | null }>(`select max(code) as n from tz_accounts where org_id = $1 and parent_id = $2 and deleted_at is null`, [ctx.org.id, input.parent_id]);
        const width = level === 2 ? 2 : 4;
        const next = r?.n ? String(Number(r.n) + 1) : `${p.code}${level === 2 ? "1" : "01"}`;
        input.code = next.padStart(width, "0");
      }
    }
    if (!kind || !KINDS.includes(kind)) throw bad("نوع حساب را انتخاب کنید");
    const code = normalizeDigits(String(input.code ?? "")).trim();
    if (!/^\d{1,12}$/.test(code)) throw bad("کد حساب باید عدد باشد");
    if (!input.name?.trim()) throw bad("نام حساب را وارد کنید");
    const row = await insertRow(tx, "tz_accounts", {
      id: uuidv7(), org_id: ctx.org.id, parent_id: input.parent_id ?? null, code, name: input.name.trim(), level, kind, nature,
      is_postable: level === 3, detail_mode: input.detail_mode ?? "none", detail_kinds: input.detail_kinds ?? [],
      fx_mode: input.fx_mode ?? "none", currency_id: input.currency_id ?? null, weight_mode: input.weight_mode ?? "none",
      system_key: input.system_key || null, description: input.description ?? null, sort: 1000, origin: ctx.cfg.origin,
    });
    return row;
  });
}

export async function updateAccount(ctx: Ctx, id: string, input: AccountInput) {
  ctx.need("accounting", "full");
  return ctx.write(async (tx) => {
    const prev = await tx.one<{ id: string; level: number }>(`select id, level from tz_accounts where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!prev) throw notFound("حساب پیدا نشد");
    const patch: Record<string, unknown> = { origin: ctx.cfg.origin };
    for (const k of ["name", "nature", "detail_mode", "detail_kinds", "fx_mode", "currency_id", "weight_mode", "is_active", "description"] as const) {
      if (input[k] !== undefined) patch[k] = input[k];
    }
    if (input.system_key !== undefined) patch.system_key = input.system_key || null;
    if (input.code !== undefined) {
      const code = normalizeDigits(String(input.code)).trim();
      if (!/^\d{1,12}$/.test(code)) throw bad("کد حساب باید عدد باشد");
      patch.code = code;
    }
    if (input.kind !== undefined) {
      if (!KINDS.includes(input.kind)) throw bad("نوع حساب معتبر نیست");
      patch.kind = input.kind;
    }
    return updateRow(tx, "tz_accounts", { id, org_id: ctx.org.id }, patch);
  });
}

export async function deleteAccount(ctx: Ctx, id: string) {
  ctx.need("accounting", "full");
  return ctx.write(async (tx) => {
    const prev = await tx.one<{ system_key: string | null }>(`select system_key from tz_accounts where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!prev) throw notFound("حساب پیدا نشد");
    const child = await tx.one(`select 1 from tz_accounts where parent_id = $1 and deleted_at is null limit 1`, [id]);
    if (child) throw conflict("این حساب زیرحساب دارد؛ ابتدا زیرحساب‌ها را حذف کنید");
    const used = await tx.one(`select 1 from tz_voucher_lines where org_id = $1 and account_id = $2 limit 1`, [ctx.org.id, id]);
    if (used) throw conflict("این حساب گردش دارد و قابل حذف نیست؛ می‌توانید غیرفعالش کنید");
    if (prev.system_key) throw conflict("این حساب در ثبت‌های خودکار استفاده می‌شود؛ ابتدا نقش آن را به حساب دیگری بدهید");
    await tx.query(`update tz_accounts set deleted_at = now() where id = $1`, [id]);
    return { ok: true };
  });
}
