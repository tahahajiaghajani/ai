// Behaviour of the financial tables on every write path, inside the write's transaction:
//   fiscal_year        dates from the Jalali year (1 Farvardin – end of Esfand); its twelve periods created with it
//   cost_type          no parent loops; CapEx/OpEx inherited from the parent when not set
//   exchange_rate      positive rates only
//   cost_entry         its period from its date; nothing posted into a closed period; CapEx/OpEx from the cost type;
//                      insert-only for people — the amount, date, centre, type and source never change, corrections are
//                      reversal entries (`reverseEntry`), and entries are never deleted (the system may)
//   budget / lines     the budget's total from its lines (once per transaction); lines change while the budget is a
//                      draft or submitted, by whoever may change the budget; an approved budget is revised back to draft
//   allocation_*       targets name a service once; results are written by the module only
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { fiscalPeriods, fiscalYearRange, periodKeyOf } from "@shared/financial/logic";
import { D } from "@shared/money";
import { createIn, onBeforeCommit, pushGuard, registerHooks, updateIn, type WriteArgs } from "../../engine";
import { access } from "../../access/provider";
import { bad, conflict, forbidden } from "../../http/errors";
import type { Ctx } from "../../context";
import { lockKey, type Tx } from "../../db";
import { isUuid, liveRow, liveRows, sysOf } from "../itam/common";

const isSys = (w: WriteArgs) => w.ctx.actor === "system";
const LEDGER_FIELDS = ["entry_date", "amount", "cost_center_id", "cost_type_id", "source", "asset_id", "ci_id", "service_id", "supplier_id", "contract_id", "capex_opex"];

/** The fiscal period of a date (the period row), or null when the year is not set up. */
export async function periodOf(q: Tx | Ctx["db"], sys: Ctx, date: string): Promise<Record<string, any> | null> {
  const [p] = await liveRows(q, sys, "fiscal_period", { f: "key", op: "eq", v: periodKeyOf(date) } as Cond, { limit: 1 });
  return p ?? null;
}

async function costEntryBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    if (!isSys(w)) throw forbidden("ثبت‌های دفتر هزینه حذف نمی‌شوند؛ برای اصلاح، ثبت برگشتی بزنید");
    return;
  }
  const n = w.next;
  if (w.op === "update" && !isSys(w) && LEDGER_FIELDS.some((f) => w.changed.has(f))) throw conflict("ثبت هزینه تغییر نمی‌کند؛ برای اصلاح، ثبت برگشتی بزنید و ثبت درست را دوباره وارد کنید");
  if (w.op === "create" || w.changed.has("entry_date")) {
    const p = await periodOf(w.tx, sysOf(w.ctx), String(n.entry_date));
    if (p && p.status === "closed") throw conflict(`دورهٔ «${p.name}» بسته است و ثبت تازه نمی‌پذیرد`);
    if (p && p.status === "soft_closed" && !isSys(w)) throw conflict(`دورهٔ «${p.name}» موقتاً بسته است؛ فقط ثبت‌های خودکار پذیرفته می‌شوند`);
    n.period_id = p?.id ?? null;
  }
  if (!n.capex_opex && isUuid(n.cost_type_id)) {
    const t = await liveRow(w.tx, sysOf(w.ctx), "cost_type", n.cost_type_id);
    n.capex_opex = t?.capex_opex ?? "opex";
  }
  if (w.op === "create" && !isSys(w) && n.source && n.source !== "manual") n.source = "manual";
}

async function fiscalYearBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  if (w.op === "create" || w.changed.has("year")) {
    const r = fiscalYearRange(Number(w.next.year));
    w.next.start_date = r.start;
    w.next.end_date = r.end;
  }
}

async function fiscalYearAfter(w: WriteArgs): Promise<void> {
  if (w.op !== "create") return;
  const sys = sysOf(w.ctx);
  const existing = new Set((await liveRows(w.tx, sys, "fiscal_period", { f: "fiscal_year_id", op: "eq", v: w.next.id } as Cond, { limit: 20 })).map((p) => Number(p.month)));
  for (const p of fiscalPeriods(Number(w.next.year))) {
    if (existing.has(p.month)) continue;
    await createIn(w.tx, sys, "fiscal_period", { fiscal_year_id: w.next.id, month: p.month, key: p.key, name: p.name, start_date: p.start_date, end_date: p.end_date, status: "open" }, { trusted: true });
  }
}

async function budgetTotal(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  onBeforeCommit(tx, `financial.budget:${id}`, async () => {
    const sys = sysOf(ctx);
    const b = await liveRow(tx, sys, "budget", id);
    if (!b) return;
    const lines = await liveRows(tx, sys, "budget_line", { f: "budget_id", op: "eq", v: id } as Cond, { limit: 10000 });
    const total = lines.reduce<ReturnType<typeof D>>((a, l) => a.plus(D(l.amount ?? 0)), D(0)).toString();
    if (b.total !== null && D(b.total).eq(total)) return;
    await updateIn(tx, sys, "budget", id, { total }, { trusted: true, keepVersion: true });
  });
}

async function budgetLineBefore(w: WriteArgs): Promise<void> {
  const id = w.next?.budget_id ?? w.prev?.budget_id;
  const b = isUuid(id) ? await liveRow(w.tx, sysOf(w.ctx), "budget", id) : null;
  if (!b) throw bad("بودجه پیدا نشد");
  if (!isSys(w)) {
    if (!access().canWrite(w.ctx, tableDef("budget")!, b)) throw forbidden("برای تغییر سطرها باید بتوانید بودجه را تغییر دهید");
    if (!["draft", "submitted"].includes(String(b.state))) throw conflict("بودجهٔ مصوب یا قفل تغییر نمی‌کند؛ نخست آن را به بازنگری ببرید");
  }
  if (w.op === "delete") return;
  if (isUuid(w.next.period_id)) {
    const p = await liveRow(w.tx, sysOf(w.ctx), "fiscal_period", w.next.period_id);
    if (p && p.fiscal_year_id !== b.fiscal_year_id) throw bad("ماه سطر در سال مالی این بودجه نیست");
  }
  if (D(w.next.amount ?? 0).lt(0)) throw bad("مبلغ بودجه منفی نمی‌شود");
}

async function costTypeBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !w.changed.has("parent_id") || !w.next.parent_id) return;
  // re-parenting takes the tree's key: two crossing moves at once never make a loop
  if (w.op !== "create") await lockKey(w.tx, `cost_type.tree:${w.ctx.org.id}`);
  let cur: unknown = w.next.parent_id;
  for (let i = 0; i < 30 && isUuid(cur); i++) {
    if (cur === w.next.id) throw bad("نوع هزینه نمی‌تواند زیرمجموعهٔ خودش باشد");
    cur = (await liveRow(w.tx, sysOf(w.ctx), "cost_type", cur))?.parent_id;
  }
}
const rateBefore = (w: WriteArgs) => {
  if (w.op !== "delete" && !D(w.next.rate ?? 0).gt(0)) throw bad("نرخ ارز باید مثبت باشد");
};
async function allocationRunBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  if (w.changed.has("period_from_id") || w.changed.has("period_to_id") || w.op === "create") {
    const a = await liveRow(w.tx, sys, "fiscal_period", w.next.period_from_id);
    const b = await liveRow(w.tx, sys, "fiscal_period", w.next.period_to_id);
    if (a && b && String(a.key) > String(b.key)) throw bad("«از ماه» پس از «تا ماه» است");
    if (a && a.fiscal_year_id !== w.next.fiscal_year_id) throw bad("ماه‌ها در سال مالی این اجرا نیستند");
  }
}

export function installFinancialHooks(): (() => void)[] {
  // a Windows app's push runs no beforeWrite: the ledger and budget rules are asked of the pushed row (pushGuard)
  return [
    registerHooks("fiscal_year", { beforeWrite: fiscalYearBefore, afterWrite: fiscalYearAfter, validatePush: pushGuard(fiscalYearBefore) }),
    registerHooks("cost_type", { beforeWrite: costTypeBefore, validatePush: pushGuard(costTypeBefore) }),
    registerHooks("exchange_rate", { beforeWrite: rateBefore, validatePush: pushGuard(rateBefore) }),
    registerHooks("cost_entry", { beforeWrite: costEntryBefore, validatePush: pushGuard(costEntryBefore) }),
    registerHooks("budget", {
      beforeWrite(w) {
        if (w.op === "delete") return;
        if (w.changed.has("total") && !w.trusted) w.next.total = w.prev?.total ?? null;
        if (w.changed.has("state") && w.next.state === "draft") w.next.alerted_percent = null;
      },
    }),
    registerHooks("budget_line", {
      beforeWrite: budgetLineBefore,
      validatePush: pushGuard(budgetLineBefore),
      async afterWrite(w) {
        await budgetTotal(w.tx, w.ctx, String(w.next?.budget_id ?? w.prev?.budget_id));
      },
    }),
    registerHooks("allocation_result", {
      beforeWrite(w) {
        if (!isSys(w)) throw forbidden("نتیجهٔ تسهیم را سامانه محاسبه می‌کند");
      },
      validatePush: () => "نتیجهٔ تسهیم را سامانه محاسبه می‌کند",
    }),
    registerHooks("allocation_run", { beforeWrite: allocationRunBefore, validatePush: pushGuard(allocationRunBefore) }),
  ];
}
