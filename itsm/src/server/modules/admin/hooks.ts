// Hooks of the administration console's tables and of the engine's customisation tables (same transaction as the
// write): the plan's ceiling of custom fields on every path (the studio, the generic API, imports), fields only on
// claimed custom-table slots, stable table codes, the targets of import sets, transform maps and exports, and who may
// write notices (the settings area; a platform notice is the platform's — an organisation may only switch it off).
import { tableDef } from "@shared/tables";
import { TABLE_CODE, isCustomSlot } from "@shared/admin/studio";
import { specProblem, type MapRule } from "@shared/admin/mapping";
import { bad, forbidden } from "../../http/errors";
import { registerHooks, type WriteArgs } from "../../engine";
import { isSystem } from "../../access/provider";
import { enqueue } from "../../jobs";
import { liveRows, needWithinLimit, sysOf } from "./common";

const existingTable = (key: unknown) => {
  const def = tableDef(String(key ?? ""));
  return def && !def.virtual ? def : null;
};

async function customField({ tx, ctx, op, next, prev }: WriteArgs): Promise<void> {
  if (op !== "create" && op !== "update") return;
  const name = String(next.name ?? "");
  if (!name.startsWith("u_")) return;
  const reactivated = op === "update" && prev?.active === false && next.active !== false;
  if ((op === "create" && next.active !== false) || reactivated) await needWithinLimit(tx, ctx.cfg, ctx.org.id, "custom_fields", 1);
  if (isSystem(ctx)) return;
  const table = String(next.table_key ?? "");
  if (isCustomSlot(table)) {
    const [claimed] = await liveRows(tx, sysOf(ctx), "custom_table", { f: "slot", op: "eq", v: table }, { limit: 1 });
    if (!claimed) throw bad("این جایگاه جدول سفارشی هنوز تعریف نشده است؛ جدول را در «استودیو» بسازید");
  }
}

function customTable({ ctx, op, next, prev, trusted }: WriteArgs): void {
  if (op !== "create" && op !== "update") return;
  if (!isCustomSlot(String(next.slot ?? ""))) throw bad("جایگاه جدول سفارشی معتبر نیست");
  if (!TABLE_CODE.test(String(next.code ?? ""))) throw bad("کد جدول باید با حرف کوچک لاتین شروع شود و فقط حرف، رقم و _ داشته باشد (۲ تا ۳۰ نویسه)");
  if (op === "update" && prev && prev.code !== next.code && !trusted && !isSystem(ctx)) throw bad("کد پایدار جدول پس از ساخت تغییر نمی‌کند");
}

function targetTable({ op, next }: WriteArgs, field: string): void {
  if (op !== "create" && op !== "update") return;
  if (!existingTable(next[field])) throw bad(`جدول «${String(next[field] ?? "")}» وجود ندارد`);
}

function transformMap(w: WriteArgs): void {
  targetTable(w, "target_table");
  if (w.op !== "create" && w.op !== "update") return;
  const def = existingTable(w.next.target_table)!;
  const rules = (Array.isArray(w.next.rules) ? w.next.rules : []) as MapRule[];
  if (!rules.length) return;
  const fields = new Set(def.fields.filter((f) => !f.system && !f.base).map((f) => f.name));
  // custom fields of the organisation (u_*) are accepted here; the run checks them against the caller's view
  for (const r of rules) if (String(r.target ?? "").startsWith("u_")) fields.add(String(r.target));
  const problem = specProblem({ rules, key_field: w.next.key_field ?? null }, fields);
  if (problem) throw bad(problem);
}

function dataExport({ ctx, op, next, trusted }: WriteArgs): void {
  if (op !== "create" && op !== "update") return;
  const tables = Array.isArray(next.tables) ? (next.tables as string[]) : [];
  for (const t of tables) if (!existingTable(t)) throw bad(`جدول «${t}» وجود ندارد`);
  // a request made on the record form: the job builds it (never a «ready» row without files)
  if (op === "create" && !trusted && !isSystem(ctx)) Object.assign(next, { status: "queued", stats: null, error: null, expires_at: null });
}

async function dataExportAfter(w: WriteArgs & { row: Record<string, unknown> }): Promise<void> {
  if (w.op !== "create" || w.trusted || isSystem(w.ctx)) return;
  await enqueue(w.tx, { kind: "admin.export.run", orgId: w.ctx.org.id, payload: { id: w.row.id }, dedupeKey: `data-export:${w.row.id}`, maxAttempts: 3 });
}

function notice({ ctx, op, next, prev, changed }: WriteArgs): void {
  if (isSystem(ctx)) return;
  if (!ctx.can("settings", "edit")) throw forbidden("اطلاعیهٔ سامانه را مدیر سازمان می‌نویسد");
  if (op === "create" && next.source === "platform") throw forbidden("اطلاعیهٔ مدیر سامانه را فقط مدیر سامانه می‌فرستد");
  if (prev?.source === "platform" && (op === "delete" || [...changed].some((f) => f !== "active"))) throw forbidden("اطلاعیهٔ مدیر سامانه را فقط می‌توانید غیرفعال کنید");
}

let installed = false;
export function installAdminHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("custom_field", { beforeWrite: customField });
  registerHooks("custom_table", { beforeWrite: customTable });
  registerHooks("import_set", { beforeWrite: (w) => targetTable(w, "target_table") });
  registerHooks("transform_map", { beforeWrite: transformMap });
  registerHooks("data_export", { beforeWrite: dataExport, afterWrite: dataExportAfter });
  registerHooks("system_notice", { beforeWrite: notice });
}
