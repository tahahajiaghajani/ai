// Work that waits on a change (catalogue CHG-040, INC-032, PRB-020): when a change has been implemented (it enters
// «بازبینی» or «بسته») the records linked to it are told and moved on —
//   · incidents on hold «منتظر اجرای تغییر» (hold_reason awaiting_change) go back to «در حال رسیدگی» with a note, so
//     the agent checks the fix (a failed change — close code unsuccessful / backed out — only adds the note)
//   · problems «در انتظار» on a change (pending_reason change) continue: to «در حال رفع» when their cause is known,
//     else back to analysis; their assignee (or group) is notified either way
// A major incident declared (major_state → accepted) starts a change lockdown of its services and CIs when the
// settings ask for it (`lockdown_on_major`, off by default) — once per incident.
//
// Linked means a link in either direction other than «ناشی از» (an incident the change caused does not wait on it):
// «آغازشده از» and «رفع می‌کند» from «ثبت تغییر», or any link people made. Everything runs in the change's write
// transaction as the system on behalf of the actor; a record that cannot move keeps its state and the change says so.
import { FAILED_CODES } from "@shared/tables/change";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, createIn, defFor, savepoint, transitionIn, type WriteArgs } from "../../engine";
import { notifyPeople } from "../notify";
import { changeConfig, eqAll, hasTable, isUuid, liveRows, sysOf, type Row } from "./common";

/** Records of `table` linked to the change (either direction), except «ناشی از». */
async function linkedIds(tx: Tx, orgId: string, changeId: string, table: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `select distinct case when l.from_table = 'change_request' then l.to_id else l.from_id end as id from sm_links l
      where l.org_id = $1 and l.deleted_at is null and l.kind <> 'caused_by'
        and ((l.from_table = 'change_request' and l.from_id = $2 and l.to_table = $3) or (l.to_table = 'change_request' and l.to_id = $2 and l.from_table = $3))`,
    [orgId, changeId, table],
  );
  return rows.map((r) => String(r.id)).filter(isUuid);
}

export interface ResumeResult {
  incidents: string[];
  problems: string[];
  failed: string[];
}

/** Move on the incidents and problems waiting on `change` (implemented or closed). */
export async function resumeWaitingOn(tx: Tx, ctx: Ctx, change: Row, actor: string | null): Promise<ResumeResult> {
  const out: ResumeResult = { incidents: [], problems: [], failed: [] };
  const sys = sysOf(ctx, actor);
  const id = String(change.id);
  const no = String(change.number ?? "تغییر");
  const failed = FAILED_CODES.includes(String(change.close_code ?? ""));
  const outcome = failed ? `تغییر ${no} ناموفق بود (${String(change.close_code)})` : `تغییر ${no} اجرا شد`;

  if (hasTable("incident")) {
    const ids = await linkedIds(tx, ctx.org.id, id, "incident");
    const waiting = ids.length ? await liveRows(tx, sysOf(ctx), "incident", { and: [{ f: "id", op: "in", v: ids }, { f: "state", op: "eq", v: "on_hold" }, { f: "hold_reason", op: "eq", v: "awaiting_change" }] }, { limit: 200 }) : [];
    const { def } = await defFor(sys, "incident", tx);
    for (const inc of waiting) {
      try {
        if (!failed) await savepoint(tx, () => transitionIn(tx, sys, "incident", String(inc.id), "in_progress", {}, { trusted: true }));
        await addJournalIn(tx, sys, def, inc, { kind: "work_note", body: failed ? `${outcome}؛ رخداد همچنان منتظر تغییر است.` : `${outcome}؛ رخداد از «منتظر اجرای تغییر» به رسیدگی برگشت — رفع را بررسی کنید.` }, { trusted: true, author: actor });
        out.incidents.push(String(inc.id));
      } catch {
        out.failed.push(String(inc.number ?? inc.id));
      }
    }
  }

  if (hasTable("problem")) {
    const ids = await linkedIds(tx, ctx.org.id, id, "problem");
    const waiting = ids.length ? await liveRows(tx, sysOf(ctx), "problem", { and: [{ f: "id", op: "in", v: ids }, { f: "state", op: "eq", v: "pending" }, { f: "pending_reason", op: "eq", v: "change" }] }, { limit: 200 }) : [];
    const { def } = await defFor(sys, "problem", tx);
    for (const p of waiting) {
      try {
        const to = typeof p.cause_notes === "string" && p.cause_notes.trim() ? "fix_in_progress" : "rca";
        if (!failed) await savepoint(tx, () => transitionIn(tx, sys, "problem", String(p.id), to, {}, { trusted: true }));
        const body = failed ? `${outcome}؛ مشکل همچنان منتظر تغییر است.` : `${outcome}؛ مشکل از «در انتظار» به «${to === "rca" ? "تحلیل علت" : "در حال رفع"}» رفت.`;
        await addJournalIn(tx, sys, def, p, { kind: "work_note", body }, { trusted: true, author: actor });
        const users = isUuid(p.assigned_to) ? [String(p.assigned_to)] : [];
        if (users.length) {
          await notifyPeople(tx, ctx.org.id, {
            table: "problem", id: String(p.id), users, event: "custom", label: "تغییر مشکل اجرا شد",
            subject: `${String(p.number ?? "مشکل")}: ${outcome}`, body, channels: ["in_app"], actor, source: "مدیریت تغییر",
          });
        }
        out.problems.push(String(p.id));
      } catch {
        out.failed.push(String(p.number ?? p.id));
      }
    }
  }
  return out;
}

/** After an incident write: a declared major incident starts a lockdown when the settings ask for it. */
export async function lockdownOnMajor(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !w.changed.has("major_state") || w.row.major_state !== "accepted" || w.prev?.major_state === "accepted") return;
  const sys = sysOf(w.ctx);
  const cfg = await changeConfig(w.tx, sys);
  if (!cfg.lockdown_on_major) return;
  const inc = w.row;
  const existing = await liveRows(w.tx, sys, "change_lockdown", { and: [eqAll({ incident_id: String(inc.id) }), { f: "state", op: "eq", v: "active" }] }, { limit: 1 });
  if (existing.length) return;
  const ids = (...xs: unknown[]) => [...new Set(xs.flatMap((x) => (Array.isArray(x) ? x : x ? [x] : [])).filter(isUuid).map(String))];
  const actor = w.ctx.actor === "system" ? null : w.ctx.user.id;
  await createIn(w.tx, sysOf(w.ctx, actor), "change_lockdown", {
    title: `قرنطینهٔ تغییرات برای رخداد عمدهٔ ${String(inc.number ?? "")}`.trim().slice(0, 200),
    incident_id: String(inc.id),
    services: ids(inc.service_id, inc.affected_services),
    cis: ids(inc.ci_id, inc.affected_cis),
    hold_in_flight: true,
    reason: `با اعلام رخداد عمده ${String(inc.number ?? "")} («${String(inc.short_description ?? "")}») خودکار آغاز شد؛ با پایان قرنطینه تغییرهای متوقف ادامه می‌یابند.`,
  }, { trusted: true });
}
