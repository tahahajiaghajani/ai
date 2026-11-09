// What people do with alerts and correlated groups (catalogue EVT-007/017): acknowledge, take back to open, assign
// (to themselves or someone), snooze, close with a reason, suppress, re-open, add a note, take an alert out of its
// group, raise an incident — one alert, a whole group or a selection. Each action checks the module's authority
// (`canRespond`: the area's write grant, or being the alert's assignee, responder or team member) on a row the caller
// can read, then writes as the module on the person's behalf (trusted; the history and the notes name them).
import type { TableDef } from "@shared/model/types";
import { ALERT_CLOSE_CODES, ALERT_OPEN_STATES } from "@shared/tables/event";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { condEnv, defFor, requireReadable, transitionIn, updateIn, addJournalIn } from "../../engine";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { canRespond, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { alertNote, stopEscalation } from "./escalation";
import { raiseIncident } from "./incidents";
import { queueRollup, ungroup } from "./correlate";

export type AlertAction = "ack" | "unack" | "assign" | "take" | "snooze" | "close" | "reopen" | "suppress" | "note" | "ungroup" | "incident";
export const ALERT_ACTIONS: AlertAction[] = ["ack", "unack", "assign", "take", "snooze", "close", "reopen", "suppress", "note", "ungroup", "incident"];

export interface ActionInput {
  user_id?: string | null;
  minutes?: number;
  close_code?: string;
  close_notes?: string | null;
  body?: string;
}

/** The alert locked for the transaction (404 when the caller may not read it). */
export async function lockRow(tx: Tx, ctx: Ctx, table: "alert" | "alert_group", id: string): Promise<{ def: TableDef; row: Row }> {
  if (!isUuid(id)) throw notFound(table === "alert" ? "هشدار پیدا نشد" : "گروه هم‌بسته پیدا نشد");
  const { def } = await defFor(ctx, table, tx);
  const env = await condEnv(ctx);
  const row = await requireReadable(ctx, def, id, env, tx, { lock: true });
  delete row.$writable;
  return { def, row };
}

/** The writer of an action: the system on the person's behalf. */
const actor = (ctx: Ctx) => (ctx.actor === "system" ? ctx : sysOf(ctx, ctx.user.id));
const person = (ctx: Ctx): string | null => (ctx.actor === "system" ? (ctx.user.id && !/^0{8}-/.test(ctx.user.id) ? ctx.user.id : null) : ctx.user.id);

/** Acknowledge an alert (stops its escalation: the hook and afterWrite end the open pages). */
export async function acknowledgeIn(tx: Tx, sys: Ctx, alert: Row, o: { by: string | null; via: "app" | "link" | "auto"; note?: string }): Promise<Row> {
  if (!["open", "flapping", "snoozed", "maintenance"].includes(String(alert.state))) return alert;
  const data: Row = { acknowledged_at: new Date().toISOString(), acknowledged_by: o.by ?? null };
  if (o.by && !alert.assigned_to && o.via !== "auto") data.assigned_to = o.by;
  // the pages end first, so the answer keeps its way (the link, the app) before the write's own clean-up runs
  await stopEscalation(tx, sys, alert, "acknowledged", o.by, o.via);
  const next = await transitionIn(tx, sys, "alert", String(alert.id), "acknowledged", data, { trusted: true });
  if (o.note) await alertNote(tx, sys, next, o.note, null, o.by);
  else if (o.via === "link") await alertNote(tx, sys, next, "هشدار با پیوند فراخوان تأیید شد.", null, o.by);
  return next;
}

/** Run one action on one alert inside `tx`. */
export async function alertActionIn(tx: Tx, ctx: Ctx, id: string, action: AlertAction, input: ActionInput = {}): Promise<Row> {
  const { def, row } = await lockRow(tx, ctx, "alert", id);
  if (!canRespond(ctx, def, row)) throw forbidden("اجازهٔ کار روی این هشدار را ندارید؛ هشدار باید به شما یا تیم شما مربوط باشد");
  const sys = actor(ctx);
  const me = person(ctx);
  const state = String(row.state);
  const open = ALERT_OPEN_STATES.includes(state);
  switch (action) {
    case "ack":
      if (!["open", "flapping", "snoozed", "maintenance"].includes(state)) throw conflict("این هشدار در وضعیتی نیست که تأیید شود");
      return acknowledgeIn(tx, sys, row, { by: me, via: "app" });
    case "unack":
      if (state !== "acknowledged") throw conflict("فقط هشدار تأییدشده به «باز» برمی‌گردد");
      return transitionIn(tx, sys, "alert", id, "open", { acknowledged_at: null, acknowledged_by: null }, { trusted: true });
    case "take":
    case "assign": {
      const user = action === "take" ? me : input.user_id ?? me;
      if (!user) throw bad("کسی برای واگذاری انتخاب نشده است");
      if (!open) throw conflict("هشدار بسته یا رفع‌شده را نمی‌توان واگذار کرد");
      const next = await updateIn(tx, sys, "alert", id, { assigned_to: user }, { trusted: true });
      if (state === "open" || state === "flapping") return acknowledgeIn(tx, sys, next, { by: user === me ? me : null, via: "app" });
      return next;
    }
    case "snooze": {
      const minutes = Math.max(5, Math.min(7 * 24 * 60, Math.round(Number(input.minutes) || 60)));
      if (!["open", "acknowledged", "flapping"].includes(state)) throw conflict("این هشدار در وضعیتی نیست که به تعویق بیفتد");
      const next = await transitionIn(tx, sys, "alert", id, "snoozed", { snoozed_until: new Date(Date.now() + minutes * 60_000).toISOString() }, { trusted: true });
      await alertNote(tx, sys, next, `هشدار ${minutes.toLocaleString("fa-IR")} دقیقه به تعویق افتاد.`, null, me);
      return next;
    }
    case "close": {
      const code = input.close_code && ALERT_CLOSE_CODES.some((c) => c.value === input.close_code) ? input.close_code : "fixed";
      if (state === "closed") throw conflict("این هشدار بسته است");
      if (state === "suppressed") throw conflict("هشدار سرکوب‌شده را نخست بازگردانید");
      return transitionIn(tx, sys, "alert", id, "closed", { close_code: code, close_notes: input.close_notes ? String(input.close_notes).slice(0, 4000) : null }, { trusted: true });
    }
    case "reopen":
      if (state === "closed" || state === "suppressed") return transitionIn(tx, sys, "alert", id, "acknowledged", { acknowledged_at: new Date().toISOString(), acknowledged_by: me }, { trusted: true });
      if (state === "cleared") return transitionIn(tx, sys, "alert", id, "open", {}, { trusted: true });
      throw conflict("این هشدار باز است");
    case "suppress":
      if (!open) throw conflict("فقط هشدار باز سرکوب می‌شود");
      return transitionIn(tx, sys, "alert", id, "suppressed", {}, { trusted: true });
    case "note": {
      const body = String(input.body ?? "").trim();
      if (!body) throw bad("متن یادداشت را بنویسید");
      await addJournalIn(tx, sys, def, row, { kind: "work_note", body: body.slice(0, 20_000) }, { trusted: true, author: me });
      return row;
    }
    case "ungroup":
      if (!isUuid(row.group_id)) throw conflict("این هشدار در گروهی نیست");
      await ungroup(tx, sys, row);
      await alertNote(tx, sys, row, "هشدار از گروه هم‌بسته بیرون آمد (بازخورد هم‌بستگی).", { ungrouped: row.group_id }, me);
      return (await liveRow(tx, sys, "alert", id))!;
    case "incident": {
      if (isUuid(row.incident_id)) throw conflict("این هشدار رخداد دارد");
      await raiseIncident(tx, sys, row, { perGroup: true, reason: "ثبت دستی از کنسول هشدارها", by: me });
      return (await liveRow(tx, sys, "alert", id))!;
    }
    default:
      throw bad("اقدام ناشناخته است");
  }
}

/** One action on one alert (its own transaction). */
export async function alertAction(ctx: Ctx, id: string, action: AlertAction, input: ActionInput = {}): Promise<Row> {
  return ctx.write((tx) => alertActionIn(tx, ctx, id, action, input));
}

/** One action on many alerts: each in its own savepoint-free transaction, answered per alert. */
export async function bulkAction(ctx: Ctx, ids: string[], action: AlertAction, input: ActionInput = {}): Promise<{ done: number; failed: { id: string; message: string }[] }> {
  const out = { done: 0, failed: [] as { id: string; message: string }[] };
  for (const id of [...new Set(ids)].slice(0, 200)) {
    try {
      await alertAction(ctx, id, action, input);
      out.done++;
    } catch (e) {
      out.failed.push({ id, message: String((e as Error).message ?? e).slice(0, 300) });
    }
  }
  return out;
}

export type GroupAction = "ack" | "take" | "close" | "incident";

/** An action on every open alert of a correlated group (the console's keyboard works on whole groups). */
export async function groupAction(ctx: Ctx, id: string, action: GroupAction, input: ActionInput = {}): Promise<{ group: Row; done: number; failed: { id: string; message: string }[] }> {
  return ctx.write(async (tx) => {
    const { def, row } = await lockRow(tx, ctx, "alert_group", id);
    if (!canRespond(ctx, def, row)) throw forbidden("اجازهٔ کار روی این گروه را ندارید");
    const sys = actor(ctx);
    const members = await liveRows(tx, sys, "alert", { and: [{ f: "group_id", op: "eq", v: id }, { f: "state", op: "in", v: ALERT_OPEN_STATES }] }, { order: "t.first_seen_at", limit: 200 });
    const out = { done: 0, failed: [] as { id: string; message: string }[] };
    if (action === "incident") {
      if (!members.length) throw conflict("هشدار بازی در این گروه نیست");
      if (isUuid(row.incident_id)) throw conflict("این گروه رخداد دارد");
      await raiseIncident(tx, sys, members[0], { perGroup: true, reason: "ثبت دستی از کنسول هشدارها", by: person(ctx) });
      out.done = members.length;
    } else {
      for (const m of members) {
        try {
          if (action === "ack" && !["open", "flapping", "snoozed", "maintenance"].includes(String(m.state))) continue;
          await alertActionIn(tx, sysOf(ctx, person(ctx)), String(m.id), action === "take" ? "take" : action, input);
          out.done++;
        } catch (e) {
          out.failed.push({ id: String(m.id), message: String((e as Error).message ?? e).slice(0, 300) });
        }
      }
      if (action === "take" && person(ctx)) await updateIn(tx, sys, "alert_group", id, { assigned_to: person(ctx) }, { trusted: true });
      if (action === "close" && row.state !== "closed") {
        queueRollup(tx, sys, id);
        await transitionIn(tx, sys, "alert_group", id, "closed", {}, { trusted: true }).catch(() => undefined);
      }
    }
    queueRollup(tx, sys, id);
    return { group: (await liveRow(tx, sys, "alert_group", id))!, ...out };
  });
}
