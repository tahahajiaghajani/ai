// Behaviour of the supplier and contract tables on every write path, inside the write's transaction:
//   contract           the notice date (end − notice period); reminders sent start over when the end moves; a foreign
//                      contract's Rial value from its currency amount and rate; activation needs a start not after the
//                      end (guard contract_can_activate); a renewal that becomes active supersedes the contract it renews
//                      («تمدیدشده», `renewed_by_id`)
//   contract_line      the amount (quantity × unit price); lines change with the contract
//   contract_coverage  what it covers must match its kind; its label; dates default to the contract's
//   contract_obligation fulfilment stamped; a recurring obligation creates its next occurrence
//   supplier_review    the average of its ratings
//   supplier_scorecard written by the module only
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { noticeDate, addJalaliMonths } from "@shared/supplier/logic";
import { COVERAGE_KINDS } from "@shared/tables/supplier";
import { D, mul, round } from "@shared/money";
import { createIn, registerHooks, transitionIn, updateIn, type WriteArgs } from "../../engine";
import { access } from "../../access/provider";
import { bad, conflict, forbidden } from "../../http/errors";
import { isUuid, liveRow, liveRows, orgToday, sysOf } from "../itam/common";

const isSys = (w: WriteArgs) => w.ctx.actor === "system";
const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);

async function needContractWrite(w: WriteArgs): Promise<Record<string, any> | null> {
  const id = w.next?.contract_id ?? w.prev?.contract_id;
  if (!isUuid(id)) return null;
  const c = await liveRow(w.tx, sysOf(w.ctx), "contract", id);
  if (!c) throw bad("قرارداد پیدا نشد");
  if (!isSys(w) && !access().canWrite(w.ctx, tableDef("contract")!, c)) throw forbidden("برای تغییر این ردیف باید بتوانید قرارداد را تغییر دهید");
  return c;
}

async function contractBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" || w.changed.has("end_date") || w.changed.has("notice_period_days")) {
    n.notice_date = noticeDate(n.end_date, n.notice_period_days);
    if (w.op !== "create" && w.changed.has("end_date")) n.reminded = {};
  }
  // a foreign-currency value without a rate takes the latest rate on or before the start (official first) from the rates
  if (n.currency && n.currency !== "IRR" && n.foreign_value && !n.fx_rate && (w.changed.has("foreign_value") || w.changed.has("currency") || w.op === "create")) {
    const at = String(n.start_date ?? orgToday(w.ctx));
    const where = { and: [{ f: "currency", op: "eq", v: n.currency }, { f: "rate_date", op: "lte", v: at }] } as Cond;
    const [r] = await liveRows(w.tx, sysOf(w.ctx), "exchange_rate", where, { order: "(t.rate_type = 'official') desc, t.rate_date desc", limit: 1 });
    if (r) {
      n.fx_rate = r.rate;
      w.changed.add("fx_rate");
    }
  }
  if ((w.changed.has("foreign_value") || w.changed.has("fx_rate")) && n.foreign_value && n.fx_rate && n.currency !== "IRR" && !w.input?.has("value")) {
    n.value = round(mul(n.foreign_value, n.fx_rate), 0);
  }
  if (n.start_date && n.end_date && n.end_date < n.start_date) throw bad("پایان قرارداد پیش از شروع آن است");
  if (w.changed.has("parent_id") && n.parent_id && n.parent_id === n.id) throw bad("قرارداد نمی‌تواند مادر خودش باشد");
}

async function contractAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !entering(w, "active")) return;
  const prevId = w.next.previous_contract_id;
  if (!isUuid(prevId)) return;
  const sys = sysOf(w.ctx);
  const prev = await liveRow(w.tx, sys, "contract", prevId);
  if (!prev || !["active", "expired"].includes(String(prev.state))) return;
  await transitionIn(w.tx, sys, "contract", prevId, "renewed", {});
  await updateIn(w.tx, sys, "contract", prevId, { renewed_by_id: w.next.id }, { trusted: true });
}

async function lineBefore(w: WriteArgs): Promise<void> {
  await needContractWrite(w);
  if (w.op === "delete") return;
  const n = w.next;
  n.amount = n.unit_price === null || n.unit_price === undefined || n.unit_price === "" ? null : round(mul(n.quantity ?? 1, n.unit_price), 0);
}

const TARGET_FIELD: Record<string, string> = { asset: "asset_id", ci: "ci_id", service: "service_id", software_model: "software_model_id", location: "location_id" };

async function coverageBefore(w: WriteArgs): Promise<void> {
  const c = await needContractWrite(w);
  if (w.op === "delete") return;
  const n = w.next;
  const f = TARGET_FIELD[String(n.target_kind)];
  if (!f || !isUuid(n[f])) throw bad(`برای پوشش «${COVERAGE_KINDS.find((k) => k.value === n.target_kind)?.label ?? ""}»، مورد آن را مشخص کنید`);
  if (c && w.op === "create") {
    if (!n.valid_from) n.valid_from = c.start_date ?? null;
    if (!n.valid_to) n.valid_to = c.end_date ?? null;
  }
  const table = n.target_kind === "software_model" ? "software_model" : String(n.target_kind);
  const target = await liveRow(w.tx, sysOf(w.ctx), table, n[f]);
  n.label = `${c?.number ?? ""} → ${target ? String(target.number ? `${target.number} ${target.name ?? ""}` : target.name ?? "") : ""}`.slice(0, 300);
}

async function obligationBefore(w: WriteArgs): Promise<void> {
  await needContractWrite(w);
  if (w.op === "delete") return;
  if (entering(w, "fulfilled")) w.next.fulfilled_at = new Date().toISOString();
}

const NEXT: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };

async function obligationAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !(entering(w, "fulfilled") || entering(w, "waived"))) return;
  const months = NEXT[String(w.next.recurrence)];
  if (!months || !w.next.due_date) return;
  const sys = sysOf(w.ctx);
  const due = addJalaliMonths(String(w.next.due_date), months);
  const c = await liveRow(w.tx, sys, "contract", w.next.contract_id);
  if (c?.end_date && due > c.end_date) return;
  const [dup] = await liveRows(w.tx, sys, "contract_obligation", { and: [{ f: "contract_id", op: "eq", v: w.next.contract_id }, { f: "title", op: "eq", v: w.next.title }, { f: "due_date", op: "eq", v: due }] } as Cond, { limit: 1 });
  if (dup) return;
  await createIn(w.tx, sys, "contract_obligation", { contract_id: w.next.contract_id, title: w.next.title, party: w.next.party, owner_id: w.next.owner_id, due_date: due, recurrence: w.next.recurrence, description: w.next.description ?? null }, { trusted: true });
}

export function installSupplierHooks(): (() => void)[] {
  return [
    registerHooks("contract", {
      beforeWrite: contractBefore,
      afterWrite: contractAfter,
      guards: {
        contract_can_activate: async (w) => {
          if (!w.next.start_date || !w.next.end_date) return "تاریخ شروع و پایان قرارداد را وارد کنید";
          if (w.next.end_date < w.next.start_date) return "پایان قرارداد پیش از شروع آن است";
          // with an approval rule in force, a contract waits for its approval (the approvals service activates it)
          if (w.prev?.state === "pending_approval" && w.next.approval === "requested" && !isSys(w)) return "قرارداد در انتظار تأیید است";
          return null;
        },
      },
    }),
    registerHooks("contract_line", { beforeWrite: lineBefore }),
    registerHooks("contract_coverage", { beforeWrite: coverageBefore }),
    registerHooks("contract_obligation", { beforeWrite: obligationBefore, afterWrite: obligationAfter }),
    registerHooks("supplier_review", {
      beforeWrite(w) {
        if (w.op === "delete") return;
        const xs = ["quality", "delivery", "communication", "value_for_money"].map((f) => Number(w.next[f] ?? 0)).filter((x) => x > 0);
        w.next.overall = xs.length ? D(xs.reduce((a, b) => a + b, 0)).div(xs.length).toDecimalPlaces(2).toString() : null;
      },
    }),
    registerHooks("supplier_scorecard", {
      beforeWrite(w) {
        if (!isSys(w)) throw forbidden("کارنامهٔ تأمین‌کننده را سامانه محاسبه می‌کند");
      },
    }),
    registerHooks("supplier", {
      beforeWrite(w) {
        if (w.op === "delete") return;
        if (w.next.national_id && !/^\d{10,11}$/.test(String(w.next.national_id))) throw bad("شناسهٔ ملی باید ۱۰ یا ۱۱ رقم باشد");
      },
    }),
  ];
}

export { conflict };
