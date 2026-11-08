// Pure parts of the record rules (docs/spec/services/sla.md §5): the ITIL priority matrix and its checks, the shape
// of business-rule actions and of stored UI policies. Shared by the server's hooks and the editors.
import type { UiPolicyLike } from "./policy-types";

/** ITIL default: impact (1 high … 3 low) × urgency (1 high … 3 low) → priority 1 (critical) … 5 (planning). */
export const ITIL_MATRIX: Record<string, Record<string, string>> = {
  "1": { "1": "1", "2": "2", "3": "3" },
  "2": { "1": "2", "2": "3", "3": "4" },
  "3": { "1": "3", "2": "4", "3": "5" },
};

/** The priority a matrix gives (undefined when the cell is empty). */
export function priorityFrom(cells: unknown, impact: unknown, urgency: unknown): string | undefined {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return undefined;
  const row = (cells as Record<string, unknown>)[String(impact ?? "")];
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const v = (row as Record<string, unknown>)[String(urgency ?? "")];
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;
}

/** Why `cells` is not a valid matrix over the options given (Persian), or null. */
export function matrixProblem(cells: unknown, impacts: readonly string[], urgencies: readonly string[], priorities: readonly string[]): string | null {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return "خانه‌های ماتریس معتبر نیست";
  for (const [i, row] of Object.entries(cells as Record<string, unknown>)) {
    if (impacts.length && !impacts.includes(i)) return `اثر «${i}» از گزینه‌های فیلد اثر نیست`;
    if (!row || typeof row !== "object" || Array.isArray(row)) return "خانه‌های ماتریس معتبر نیست";
    for (const [u, p] of Object.entries(row as Record<string, unknown>)) {
      if (urgencies.length && !urgencies.includes(u)) return `فوریت «${u}» از گزینه‌های فیلد فوریت نیست`;
      if (p === null || p === "") continue;
      if (priorities.length && !priorities.includes(String(p))) return `اولویت «${String(p)}» از گزینه‌های فیلد اولویت نیست`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Business-rule actions

export type RuleAction =
  | { type: "set"; field: string; value?: unknown; token?: "$now" | "$today" | "$me" | "$empty"; from?: string }
  | { type: "work_note"; body: string }
  | { type: "watcher"; op: "add" | "remove"; users?: string[]; field?: string }
  | { type: "abort"; message: string }
  | { type: "create"; table: string; values: Record<string, unknown> };

export const RULE_ACTION_TYPES: Record<RuleAction["type"], string> = {
  set: "مقدار فیلد",
  work_note: "یادداشت داخلی",
  watcher: "پیگیری‌کنندگان",
  abort: "توقف با پیام",
  create: "رکورد وابسته",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Why `raw` is not a valid list of actions (Persian), or null. `field` answers a field of the rule's table (type,
 * whether the engine maintains it); `table` whether a table exists; `stateField` is the table's state field.
 */
export function actionsProblem(
  raw: unknown,
  opts: { field: (name: string) => { type: string; system?: boolean; base?: boolean } | undefined; table: (key: string) => boolean; stateField?: string | null; timing: string },
): string | null {
  if (!Array.isArray(raw)) return "اقدام‌ها باید فهرست باشد";
  if (raw.length > 50) return "اقدام‌ها بیش از حد است";
  for (let i = 0; i < raw.length; i++) {
    const at = `اقدام ${(i + 1).toLocaleString("fa-IR")}`;
    const a = raw[i] as Record<string, unknown>;
    if (!a || typeof a !== "object" || Array.isArray(a)) return `${at}: ساختار معتبر نیست`;
    switch (a.type) {
      case "set": {
        const f = typeof a.field === "string" ? opts.field(a.field) : undefined;
        if (!f) return `${at}: فیلد «${String(a.field ?? "")}» در جدول نیست`;
        if (f.base || f.system) return `${at}: «${String(a.field)}» را سامانه نگه می‌دارد`;
        if (opts.stateField && a.field === opts.stateField && opts.timing === "before") return `${at}: وضعیت را با قاعده‌ای «پس از ذخیره» تغییر دهید`;
        if (a.token !== undefined && !["$now", "$today", "$me", "$empty"].includes(String(a.token))) return `${at}: مقدار «${String(a.token)}» شناخته نیست`;
        if (a.from !== undefined && (typeof a.from !== "string" || !opts.field(a.from))) return `${at}: فیلد مبدأ «${String(a.from ?? "")}» در جدول نیست`;
        break;
      }
      case "work_note":
        if (typeof a.body !== "string" || !a.body.trim() || a.body.length > 20000) return `${at}: متن یادداشت را بنویسید`;
        break;
      case "watcher": {
        if (a.op !== "add" && a.op !== "remove") return `${at}: افزودن یا برداشتن؟`;
        const users = a.users;
        if (users !== undefined && (!Array.isArray(users) || users.some((u) => typeof u !== "string" || !UUID.test(u)))) return `${at}: افراد معتبر نیستند`;
        if (a.field !== undefined) {
          const f = typeof a.field === "string" ? opts.field(a.field) : undefined;
          if (!f || (f.type !== "user" && f.type !== "users")) return `${at}: فیلد «${String(a.field)}» کاربر نیست`;
        }
        if (!users?.length && !a.field) return `${at}: افراد یا فیلدی را برگزینید`;
        break;
      }
      case "abort":
        if (typeof a.message !== "string" || !a.message.trim() || a.message.length > 300) return `${at}: پیام توقف را بنویسید`;
        break;
      case "create":
        if (typeof a.table !== "string" || !opts.table(a.table)) return `${at}: جدول «${String(a.table ?? "")}» وجود ندارد`;
        if (!a.values || typeof a.values !== "object" || Array.isArray(a.values)) return `${at}: مقدارهای رکورد تازه را بنویسید`;
        break;
      default:
        return `${at}: نوع «${String(a.type ?? "")}» شناخته نیست`;
    }
  }
  return null;
}

/** `{{field}}` placeholders of a template value, filled from `row` (a value that is one placeholder keeps its type). */
export function fillTemplate(v: unknown, row: Record<string, unknown>): unknown {
  if (typeof v !== "string") return v;
  const whole = /^\{\{\s*([a-z0-9_]+)\s*\}\}$/i.exec(v);
  if (whole) return row[whole[1]] ?? null;
  return v.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => {
    const x = row[k];
    return x === null || x === undefined ? "" : Array.isArray(x) ? x.join("، ") : String(x);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// UI policies

/** A stored `ui_policy` row as the record UI's policy shape. */
export function policyOf(r: Record<string, any>): UiPolicyLike {
  const actions = Array.isArray(r.actions) ? r.actions : [];
  return {
    key: `ui_policy:${r.id}`,
    when: r.condition && typeof r.condition === "object" && Object.keys(r.condition).length ? r.condition : null,
    actions: actions
      .filter((a: unknown) => a && typeof a === "object" && typeof (a as { field?: unknown }).field === "string")
      .map((a: Record<string, unknown>) => ({
        field: String(a.field),
        ...(typeof a.visible === "boolean" ? { visible: a.visible } : {}),
        ...(typeof a.mandatory === "boolean" ? { mandatory: a.mandatory } : {}),
        ...(typeof a.readonly === "boolean" ? { readonly: a.readonly } : {}),
      })),
    ...(r.message ? { message: String(r.message) } : {}),
    tone: r.tone === "warning" ? "warning" : "info",
    order: Number(r.sort_order ?? 100),
    on: r.applies_on === "create" || r.applies_on === "update" ? r.applies_on : "both",
  };
}

/** Why a policy's `actions` are not valid (Persian), or null. */
export function policyActionsProblem(raw: unknown, field: (name: string) => boolean): string | null {
  if (!Array.isArray(raw) || !raw.length) return "دست‌کم یک فیلد لازم است";
  if (raw.length > 100) return "فیلدها بیش از حد است";
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a !== "object" || typeof a.field !== "string") return "هر ردیف یک فیلد دارد";
    if (!field(a.field)) return `فیلد «${a.field}» در جدول نیست`;
    for (const k of ["visible", "mandatory", "readonly"]) if (a[k] !== undefined && typeof a[k] !== "boolean") return `«${k}» باید بله یا خیر باشد`;
    if (a.visible === undefined && a.mandatory === undefined && a.readonly === undefined) return `برای «${a.field}» دیده‌شدن، الزامی یا فقط‌خواندنی را تعیین کنید`;
  }
  return null;
}
