// Values of record fields: coercion and validation per field type, with Persian messages that name the field.
// Everything a caller (API, import, sync push, hooks) hands the engine passes through `coerceValue`; whole rows
// are then checked by `validateRow` (required fields, dependent choices, conditions) and `checkRefs` (references
// exist in the same organisation and satisfy the field's refFilter — one query per target table).
//
// Stored shapes: text types → string; int/rating/duration → integer; decimal/money/percent → decimal string
// (exact, decimal.js); bool → boolean; date → 'YYYY-MM-DD'; datetime → ISO instant; choice → option value;
// multichoice/tags → string[]; ref/user/group → lower-case uuid; refs/users → uuid[]; json/conditions → JSON;
// color → a ColorKey; secret → an AES-GCM envelope (never returned: callers see `{ secret: true, hint }`).
// Empty values are stored as NULL (booleans as false).
import { isIP } from "node:net";
import type { FieldDef, Option, TableDef } from "@shared/model/types";
import { COLOR_KEYS, FIELD_TYPES, refTarget } from "@shared/model/types";
import { validateCond, type CondEnv } from "@shared/model/conditions";
import { zonedMidnight, localDate } from "@shared/model/jalali-buckets";
import { D, normalizeDigits } from "@shared/money";
import { fromJalali, isValidJalali } from "@shared/jalali";
import { isEmail } from "@shared/validate";
import { AppError } from "../http/errors";
import type { Queryable } from "../db";
import { pgArray } from "../db";
import type { Ctx } from "../context";
import { decryptKey, encryptKey, keyHint } from "../modules/ai/crypto";
import type { OrgSchema } from "./schema";
import { optionsOf } from "./schema";
import { toSql } from "./sql";

/** Default maximum lengths of text types (a field's maxLength wins). */
export const TEXT_LIMITS = { string: 500, text: 20_000, markdown: 200_000, email: 254, url: 2048, phone: 40, ip: 64 } as const;
const JSON_LIMIT = 200_000;
const ARRAY_LIMIT = 1000;

/** A problem with one field's value. */
export class FieldError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

/** 400 with every field's problem: `{ code: "validation", details: { fields: { name: message } } }`. */
export function validationError(fields: Record<string, string>): AppError {
  const first = Object.values(fields)[0] ?? "اطلاعات ارسال‌شده معتبر نیست";
  return new AppError(400, "validation", first, { fields });
}

/** Collects field problems and throws them together. */
export class Problems {
  fields: Record<string, string> = {};
  add(field: string, message: string) {
    if (!this.fields[field]) this.fields[field] = message;
  }
  get any() {
    return Object.keys(this.fields).length > 0;
  }
  /** run `fn`, recording a FieldError instead of throwing it */
  try<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FieldError) {
        this.add(e.field, e.message);
        return undefined;
      }
      throw e;
    }
  }
  throwIfAny() {
    if (this.any) throw validationError(this.fields);
  }
}

/** What coercion needs besides the field: the tenant's choice lists, the time zone, the secret sealer. */
export interface ValueContext {
  schema: Pick<OrgSchema, "choices">;
  tz: string;
  /** seal a secret field's plain value (bound to the record); absent = secrets are refused */
  seal?: (field: FieldDef, plain: string) => string;
}

/** Returned by `coerceValue` for a secret that the caller sent back unchanged (`{ secret: true, … }`). */
export const KEEP = Symbol("keep");

const fail = (f: FieldDef, msg: string): never => {
  throw new FieldError(f.name, msg);
};

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function text(f: FieldDef, raw: unknown, multiline: boolean): string {
  if (typeof raw === "object") fail(f, `«${f.label}» باید متن باشد`);
  let s = String(raw).replace(/\r\n?/g, "\n").replace(CONTROL, "");
  if (!multiline) s = s.replace(/\n+/g, " ").trim();
  else s = s.replace(/^\s+|\s+$/g, (m) => (m.includes("\n") ? "" : m)).trimEnd();
  return s;
}

function limit(f: FieldDef, s: string, dflt: number): string {
  const max = f.maxLength ?? dflt;
  if (s.length > max) fail(f, `«${f.label}» حداکثر ${max.toLocaleString("fa-IR")} نویسه است`);
  return s;
}

/** Latin digits, no grouping separators, Persian decimal separator → ".". */
export function numericText(raw: unknown): string {
  return normalizeDigits(String(raw)).replace(/[,٬'\s٬‌]/g, "").replace(/[٫\/]/g, ".");
}

function range(f: FieldDef, d: ReturnType<typeof D>) {
  if (f.min !== undefined && d.lt(f.min)) fail(f, `«${f.label}» نباید کمتر از ${f.min.toLocaleString("fa-IR")} باشد`);
  if (f.max !== undefined && d.gt(f.max)) fail(f, `«${f.label}» نباید بیشتر از ${f.max.toLocaleString("fa-IR")} باشد`);
}

function integer(f: FieldDef, raw: unknown, bits: 32 | 64): number {
  if (typeof raw === "number" && !Number.isInteger(raw)) fail(f, `«${f.label}» باید عدد صحیح باشد`);
  const s = numericText(raw);
  if (!/^-?\d{1,18}$/.test(s)) fail(f, `«${f.label}» باید عدد صحیح باشد`);
  const d = D(s);
  const max = bits === 32 ? 2147483647 : Number.MAX_SAFE_INTEGER;
  if (d.abs().gt(max)) fail(f, `«${f.label}» خارج از محدوده است`);
  range(f, d);
  return d.toNumber();
}

/** "1:30" → 5400, "1:30:15" → 5415, or plain seconds. */
function duration(f: FieldDef, raw: unknown): number {
  const s = numericText(raw);
  const m = /^(\d{1,7}):([0-5]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (m) {
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
    range(f, D(secs));
    return secs;
  }
  return integer(f, raw, 64);
}

function decimal(f: FieldDef, raw: unknown): string {
  const s = numericText(raw);
  if (!/^-?\d{1,20}(\.\d{1,12})?$/.test(s)) fail(f, `«${f.label}» باید عدد باشد`);
  const d = D(s);
  range(f, d);
  return d.toString();
}

const YES = new Set(["true", "1", "yes", "y", "on", "بله", "بلی", "آری", "درست", "✓"]);
const NO = new Set(["false", "0", "no", "n", "off", "خیر", "نه", "نادرست", ""]);

function bool(f: FieldDef, raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  const s = normalizeDigits(String(raw)).trim().toLowerCase();
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  return fail(f, `«${f.label}» باید «بله» یا «خیر» باشد`);
}

/** A calendar date: ISO 2026-03-21, Jalali 1405/01/01 (or 14050101), or the local date of an ISO instant. */
export function parseDate(raw: unknown, tz: string): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : localDate(raw.getTime(), tz);
  const s = normalizeDigits(String(raw)).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(t).toISOString().slice(0, 10) === s ? s : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : localDate(t, tz);
  }
  m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (jy >= 1200 && jy < 1700 && isValidJalali(jy, jm, jd)) return fromJalali(jy, jm, jd);
  }
  return null;
}

/**
 * An instant: epoch ms, a Date, an ISO string with a zone, or a wall-clock time in the organisation's zone
 * (2026-03-21T10:30, 1405/01/01 10:30, a bare date = its midnight). Returned as an ISO string.
 */
export function parseDateTime(raw: unknown, tz: string): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  if (typeof raw === "number") return Number.isFinite(raw) && Math.abs(raw) < 8.64e15 ? new Date(Math.trunc(raw)).toISOString() : null;
  const s = normalizeDigits(String(raw)).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const m = /^(\S+?)(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const day = parseDate(m[1], tz);
  if (!day) return null;
  const [h, mi, se] = [Number(m[2] ?? 0), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  if (h > 23 || mi > 59 || se > 59) return null;
  return new Date(zonedMidnight(day, tz) + ((h * 60 + mi) * 60 + se) * 1000).toISOString();
}

function list(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return raw.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);
  return [raw];
}

function refId(f: FieldDef, raw: unknown): string {
  const v = raw && typeof raw === "object" && "id" in (raw as object) ? (raw as { id: unknown }).id : raw;
  const s = String(v ?? "").trim().toLowerCase();
  if (!UUID.test(s)) fail(f, `«${f.label}» معتبر نیست`);
  return s;
}

function option(f: FieldDef, options: Option[], raw: unknown, prev: unknown): string {
  if (typeof raw === "object") fail(f, `«${f.label}» معتبر نیست`);
  const s = String(raw).trim();
  const o = options.find((x) => x.value === s);
  // an option made inactive stays valid on records that already carry it
  if (!o || (o.active === false && s !== prev && !(Array.isArray(prev) && prev.includes(s)))) {
    fail(f, `«${s}» از گزینه‌های «${f.label}» نیست`);
  }
  return s;
}

const isEmptyInput = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * Coerce one input value for `f` (throws FieldError with a Persian message). `prev` is the stored value (inactive
 * choice options stay valid when unchanged). Returns null for an empty value (false for booleans) and KEEP for a
 * secret the caller sent back unchanged.
 */
export function coerceValue(f: FieldDef, raw: unknown, vc: ValueContext, prev?: unknown): unknown {
  const t = f.type;
  if (t === "secret" && raw && typeof raw === "object" && (raw as { secret?: unknown }).secret === true) return KEEP;
  if (isEmptyInput(raw)) return t === "bool" ? false : null;
  switch (t) {
    case "string":
      return limit(f, text(f, raw, false), TEXT_LIMITS.string) || null;
    case "text":
    case "markdown":
      return limit(f, text(f, raw, true), TEXT_LIMITS[t]) || null;
    case "email": {
      const s = limit(f, text(f, raw, false).toLowerCase(), TEXT_LIMITS.email);
      if (!isEmail(s)) fail(f, `«${f.label}» ایمیل معتبر نیست`);
      return s;
    }
    case "url": {
      const s = limit(f, text(f, raw, false), TEXT_LIMITS.url);
      let u: URL | null = null;
      try {
        u = new URL(s);
      } catch {
        u = null;
      }
      if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) fail(f, `«${f.label}» باید نشانی وب با http یا https باشد`);
      return s;
    }
    case "phone": {
      const s = limit(f, normalizeDigits(text(f, raw, false)), TEXT_LIMITS.phone);
      if (!/^\+?[\d\s()\-#*]{3,}$/.test(s) || (s.match(/\d/g)?.length ?? 0) < 3) fail(f, `«${f.label}» شمارهٔ تلفن معتبر نیست`);
      return s.replace(/\s+/g, " ");
    }
    case "ip": {
      const s = limit(f, normalizeDigits(text(f, raw, false)).toLowerCase(), TEXT_LIMITS.ip);
      const [addr, bits, extra] = s.split("/");
      const v = isIP(addr);
      const okBits = bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= (v === 6 ? 128 : 32));
      if (!v || !okBits || extra !== undefined) fail(f, `«${f.label}» نشانی IP معتبر نیست`);
      return s;
    }
    case "color": {
      const s = String(raw).trim();
      if (!(COLOR_KEYS as readonly string[]).includes(s)) fail(f, `«${f.label}» رنگ معتبر نیست`);
      return s;
    }
    case "secret": {
      if (typeof raw !== "string") fail(f, `«${f.label}» باید متن باشد`);
      const s = String(raw).replace(CONTROL, "");
      if (s.length > (f.maxLength ?? 4000)) fail(f, `«${f.label}» بیش از حد بلند است`);
      if (!vc.seal) fail(f, `«${f.label}» این‌جا پذیرفته نمی‌شود`);
      return vc.seal!(f, s);
    }
    case "int":
      return integer(f, raw, 32);
    case "rating":
      return integer({ ...f, min: f.min ?? 0, max: f.max ?? 5 }, raw, 32);
    case "duration":
      return duration(f, raw);
    case "decimal":
    case "money":
    case "percent":
      return decimal(f, raw);
    case "bool":
      return bool(f, raw);
    case "date": {
      const d = parseDate(raw, vc.tz);
      if (!d) fail(f, `«${f.label}» تاریخ معتبر نیست`);
      return d;
    }
    case "datetime": {
      const d = parseDateTime(raw, vc.tz);
      if (!d) fail(f, `«${f.label}» زمان معتبر نیست`);
      return d;
    }
    case "choice":
      return option(f, optionsOf(f, vc.schema), raw, prev);
    case "multichoice": {
      const options = optionsOf(f, vc.schema);
      const out = [...new Set(list(raw).map((x) => option(f, options, x, prev)))];
      if (out.length > 100) fail(f, `«${f.label}» حداکثر ۱۰۰ گزینه دارد`);
      return out.length ? out : null;
    }
    case "tags": {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const x of list(raw)) {
        if (typeof x === "object") fail(f, `«${f.label}» معتبر نیست`);
        const s = String(x).replace(CONTROL, "").replace(/\s+/g, " ").trim();
        if (!s) continue;
        if (s.length > 60) fail(f, `هر برچسب «${f.label}» حداکثر ۶۰ نویسه است`);
        const key = s.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(s);
        }
      }
      if (out.length > 50) fail(f, `«${f.label}» حداکثر ۵۰ برچسب دارد`);
      return out.length ? out : null;
    }
    case "ref":
    case "user":
    case "group":
      return refId(f, raw);
    case "refs":
    case "users": {
      const out = [...new Set(list(raw).map((x) => refId(f, x)))];
      if (out.length > ARRAY_LIMIT) fail(f, `«${f.label}» بیش از حد مورد دارد`);
      return out.length ? out : null;
    }
    case "json":
    case "conditions": {
      let v = raw;
      if (typeof v === "string") {
        try {
          v = JSON.parse(v);
        } catch {
          fail(f, `«${f.label}» باید JSON معتبر باشد`);
        }
      }
      if (JSON.stringify(v).length > JSON_LIMIT) fail(f, `«${f.label}» بیش از حد بزرگ است`);
      if (t === "conditions" && (typeof v !== "object" || v === null || Array.isArray(v))) fail(f, `«${f.label}» شرط معتبر نیست`);
      return v;
    }
    default:
      return fail(f, `«${f.label}» پذیرفته نمی‌شود`);
  }
}

export const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Row-level checks once every value is coerced: required fields (all on a create, the changed ones on an update),
 * dependent choices (an option's `parent` must match its parent field) and conditions fields (valid for the table
 * they apply to). `changed` = the fields this write sets.
 */
export function validateRow(def: TableDef, row: Record<string, unknown>, changed: Set<string>, vc: ValueContext & { schema: OrgSchema }, creating: boolean, problems = new Problems()): Problems {
  for (const f of def.fields) {
    if (f.base) continue;
    const touched = creating || changed.has(f.name);
    if (!touched) continue;
    const v = row[f.name];
    if (f.required && !f.system && isEmpty(v) && f.type !== "bool") problems.add(f.name, `«${f.label}» را وارد کنید`);
    if (f.dependsOn && (f.type === "choice" || f.type === "multichoice") && !isEmpty(v)) {
      const parent = row[f.dependsOn];
      const options = optionsOf(f, vc.schema);
      for (const x of Array.isArray(v) ? v : [v]) {
        const o = options.find((y) => y.value === x);
        if (o?.parent && o.parent !== parent) {
          const pf = def.fields.find((y) => y.name === f.dependsOn);
          problems.add(f.name, `«${o.label}» با «${pf?.label ?? f.dependsOn}» انتخاب‌شده جور نیست`);
        }
      }
    }
    if (f.type === "conditions" && !isEmpty(v)) {
      const key = f.condTable ?? (f.condTableField ? String(row[f.condTableField] ?? "") : def.key);
      const target = vc.schema.def(key);
      if (!target) problems.add(f.name, `«${f.label}»: جدول «${key}» وجود ندارد`);
      else {
        const p = validateCond(v, target, { lookup: vc.schema.lookup });
        if (p) problems.add(f.name, `«${f.label}»: ${p}`);
      }
    }
  }
  return problems;
}

/**
 * References in `fields` must point at live rows of the same organisation (members for user fields) that satisfy
 * the field's refFilter. Targets without a table yet (tables later modules define) are only checked as ids.
 * One query per target table (and per refFilter).
 */
export async function checkRefs(
  q: Queryable,
  ctx: Ctx,
  def: TableDef,
  row: Record<string, unknown>,
  fields: Iterable<string>,
  schema: OrgSchema,
  env: CondEnv,
  problems = new Problems(),
): Promise<Problems> {
  const groups = new Map<string, { target: string; filter?: FieldDef["refFilter"]; ids: Set<string>; fields: FieldDef[] }>();
  for (const name of fields) {
    const f = def.fields.find((x) => x.name === name);
    if (!f || FIELD_TYPES[f.type].family !== "ref") continue;
    const v = row[f.name];
    if (isEmpty(v)) continue;
    const target = refTarget(f, def.key);
    if (!target) continue;
    const key = `${target}|${f.refFilter ? JSON.stringify(f.refFilter) : ""}`;
    const g = groups.get(key) ?? { target, filter: f.refFilter, ids: new Set<string>(), fields: [] };
    for (const id of Array.isArray(v) ? v : [v]) g.ids.add(String(id));
    g.fields.push(f);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const ids = [...g.ids];
    let found: Set<string>;
    if (g.target === "user") {
      const rows = await q.query<{ id: string }>(
        `select user_id as id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and deleted_at is null`,
        [ctx.org.id, pgArray(ids)],
      );
      found = new Set(rows.map((r) => r.id));
    } else {
      const t = schema.def(g.target);
      if (!t || t.virtual) continue;
      const params: unknown[] = [ctx.org.id, pgArray(ids)];
      const where = g.filter ? ` and ${toSql(g.filter, t, "t", params, env, { lookup: schema.lookup })}` : "";
      const rows = await q.query<{ id: string }>(`select t.id from ${t.table} t where t.org_id = $1 and t.id = any($2::uuid[]) and t.deleted_at is null${where}`, params);
      found = new Set(rows.map((r) => r.id));
    }
    for (const f of g.fields) {
      const v = row[f.name];
      const missing = (Array.isArray(v) ? v : [v]).filter((id) => !found.has(String(id)));
      if (missing.length) problems.add(f.name, g.filter ? `«${f.label}»: رکورد انتخاب‌شده مجاز نیست` : `«${f.label}» پیدا نشد`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Secrets: sealed with the runtime's secret (AES-256-GCM, HKDF purpose "itsm/record-secrets"), bound to the
// organisation, table, field and record — a value copied to another row or field never opens. Stored as JSON text
// {"v": envelope, "h": hint}. Each runtime keeps its own (secret columns never travel through sync).

const SECRET_PURPOSE = "itsm/record-secrets";

const binding = (orgId: string, table: string, field: string, recordId: string) => ({ orgId, connectionId: `${table}.${field}:${recordId}` });

export function sealSecret(secret: string, orgId: string, table: string, field: string, recordId: string, plain: string): string {
  return JSON.stringify({ v: encryptKey(secret, binding(orgId, table, field, recordId), plain, SECRET_PURPOSE), h: keyHint(plain) });
}

/** What callers see of a stored secret: `{ secret: true, hint }` (null when none is stored). */
export function secretView(stored: unknown): { secret: true; hint: string } | null {
  if (stored === null || stored === undefined || stored === "") return null;
  try {
    const o = JSON.parse(String(stored)) as { h?: string };
    return { secret: true, hint: String(o.h ?? "…") };
  } catch {
    return { secret: true, hint: "…" };
  }
}

/** The plain value of a stored secret (server code only — e.g. a mail module reading its SMTP password). */
export function openSecret(secret: string, orgId: string, table: string, field: string, recordId: string, stored: unknown): string | null {
  if (stored === null || stored === undefined || stored === "") return null;
  const o = JSON.parse(String(stored)) as { v?: string };
  return decryptKey(secret, binding(orgId, table, field, recordId), o.v, SECRET_PURPOSE);
}
