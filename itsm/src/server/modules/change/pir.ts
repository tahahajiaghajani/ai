// Post-implementation reviews (catalogue CHG-053): created when a change that needs one reaches «بازبینی» (emergency,
// failed or backed out, high risk, or its model's policy), owned by the change manager (else the coordinator), due
// after the working days of the settings. The change cannot close until its review is completed. The deterministic
// draft fills the timeline, side effects (incidents linked as caused by the change), what went well or wrong and the
// follow-ups from the record; the AI layer's draft (registerChangeAi «draftPir») is merged over it.
import { formatJalaliDateTime } from "@shared/jalali";
import { CHANGE_CLOSE_CODES, FAILED_CODES, PIR_REASONS } from "@shared/tables/change";
import { humanSpan } from "@shared/change/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, get, list, listLinks, orgTz, updateIn } from "../../engine";
import { aiUnavailable, changeAi, type PirSection } from "./ai";
import { changeConfig, countsAsIncident, iso, msOf, sysOf, type Row } from "./common";
import { earliestStart } from "./schedule";

const reasonLabel = (v: string) => PIR_REASONS.find((o) => o.value === v)?.label ?? v;

/** Create the change's review when it has none (returns the review). */
export async function ensurePir(tx: Tx, ctx: Ctx, change: Row, reasons: string[]): Promise<Row | null> {
  if (change.pir_id) return null;
  const sys = sysOf(ctx);
  const cfg = await changeConfig(tx, sys);
  const due = await earliestStart(tx, sys, Math.max(1, Number(cfg.pir_due_days) || 5) + 1, Date.now());
  const pir = await createIn(tx, sys, "change_pir", {
    title: `بازبینی پس از اجرای ${change.number ?? "تغییر"} — ${String(change.short_description ?? "").slice(0, 150)}`,
    change_id: change.id,
    reason: reasons[0] ?? "manual",
    owner_id: change.change_manager_id ?? change.change_owner_id ?? null,
    assignment_group_id: change.assignment_group_id ?? null,
    due_at: iso(due),
    incidents_caused: Number(change.incidents_caused ?? 0),
    timeline_md: timelineOf(change, orgTz(ctx)),
    watch_list: [change.change_owner_id, change.assigned_to].filter((x): x is string => typeof x === "string" && !!x),
  }, { trusted: true });
  await updateIn(tx, sys, "change_request", String(change.id), { pir_id: pir.id }, { trusted: true, keepVersion: true });
  return pir;
}

/** Why a review was asked, in Persian («تغییر اضطراری، ریسک زیاد»). */
export const reasonsText = (reasons: string[]): string => reasons.map(reasonLabel).join("، ");

/** The milestones of a change with deviations from the plan (Markdown). */
export function timelineOf(c: Row, tz: string): string {
  const at = (v: unknown) => (v ? formatJalaliDateTime(String(v), tz) : "—");
  const lines = [
    `- ثبت: ${at(c.opened_at)}`,
    ...(c.submitted_at ? [`- ارسال برای ارزیابی یا تأیید: ${at(c.submitted_at)}`] : []),
    ...(c.authorized_at ? [`- تأیید: ${at(c.authorized_at)}`] : []),
    `- زمان برنامه‌ریزی‌شده: ${at(c.planned_start)} تا ${at(c.planned_end)}`,
    `- اجرای واقعی: ${at(c.actual_start)} تا ${at(c.actual_end)}`,
  ];
  const ps = msOf(c.planned_start);
  const pe = msOf(c.planned_end);
  const as = msOf(c.actual_start);
  const ae = msOf(c.actual_end);
  if (ps !== null && as !== null && as - ps > 5 * 60_000) lines.push(`- شروع ${humanSpan(as - ps)} دیرتر از برنامه`);
  if (pe !== null && ae !== null && ae - pe > 5 * 60_000) lines.push(`- پایان ${humanSpan(ae - pe)} دیرتر از برنامه`);
  if (ps !== null && pe !== null && as !== null && ae !== null && pe > ps && ae > as) {
    const ratio = (pe - ps) / (ae - as);
    lines.push(`- نسبت مدت برنامه‌ریزی‌شده به مدت واقعی: ${ratio.toFixed(2)}`);
  }
  return lines.join("\n");
}

/** A draft of a review's sections from its change (deterministic), with the AI layer's draft merged over it. */
export async function draftPir(ctx: Ctx, changeId: string): Promise<{ sections: Record<PirSection, string>; ai: boolean }> {
  const { row: c, display } = await get(ctx, "change_request", changeId);
  const tz = orgTz(ctx);
  const tasks = await list(ctx, "change_task", { filter: { f: "change_id", op: "eq", v: changeId }, size: 200, fields: ["number", "short_description", "state", "mandatory", "close_notes"], total: false });
  const links = (await listLinks(ctx, "change_request", changeId)).links;
  // what the change caused: every record linked «ناشی از» it is a side effect; the incidents among them are counted
  const caused = links.filter((l) => l.kind === "caused_by" && l.direction === "in");
  const incidents = caused.filter((l) => countsAsIncident(l.other.table));
  const code = String(c.close_code ?? "");
  const codeLabel = CHANGE_CLOSE_CODES.find((o) => o.value === code)?.label ?? "ثبت نشده";
  const failed = FAILED_CODES.includes(code);
  const pe = msOf(c.planned_end);
  const ae = msOf(c.actual_end);
  const onTime = pe !== null && ae !== null && ae <= pe + 5 * 60_000;
  const incomplete = tasks.rows.filter((t) => t.state === "closed_incomplete");
  const well: string[] = [];
  const wrong: string[] = [];
  if (!failed && code) well.push(`نتیجهٔ اجرا «${codeLabel}» بود.`);
  if (failed) wrong.push(`نتیجهٔ اجرا «${codeLabel}» بود${code === "backed_out" ? "؛ برنامهٔ بازگشت به کار رفت" : ""}.`);
  if (onTime) well.push("اجرا در زمان برنامه‌ریزی‌شده تمام شد.");
  else if (pe !== null && ae !== null) wrong.push(`اجرا ${humanSpan(ae - pe)} دیرتر از پایان برنامه‌ریزی‌شده تمام شد.`);
  if (c.backout_tested) well.push("برنامهٔ بازگشت پیش از اجرا آزموده شده بود.");
  if (incomplete.length) wrong.push(`${incomplete.length} کار ناتمام بسته شد.`);
  if (incidents.length) wrong.push(`${incidents.length} رخداد به این تغییر نسبت داده شده است.`);
  const sections: Record<PirSection, string> = {
    timeline_md: timelineOf(c, tz),
    side_effects: caused.length
      ? caused.map((l) => `- ${l.other.number ?? ""} ${l.other.display ?? ""}`.trim()).join("\n")
      : "رخدادی به این تغییر نسبت داده نشده است.",
    went_well: well.map((x) => `- ${x}`).join("\n"),
    went_wrong: wrong.map((x) => `- ${x}`).join("\n"),
    lessons: String(c.lessons ?? ""),
    follow_up: incomplete.map((t) => `- ${t.number}: ${t.short_description}${t.close_notes ? ` (${t.close_notes})` : ""}`).join("\n"),
  };
  void display;
  const ai = changeAi().draftPir;
  if (!ai) return { sections, ai: false };
  let extra: Partial<Record<PirSection, string>>;
  try {
    extra = await ai(ctx, changeId);
  } catch (e) {
    // no model (or none now): the deterministic draft, marked as such
    if (aiUnavailable(e)) return { sections, ai: false };
    throw e;
  }
  let merged = false;
  for (const [k, v] of Object.entries(extra)) if (typeof v === "string" && v.trim()) {
    sections[k as PirSection] = v;
    merged = true;
  }
  return { sections, ai: merged };
}
