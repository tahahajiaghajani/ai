// Hooks of workforce and agent experience:
//   · person skills: label, verification (a change by someone other than the person — a lead or a manager — verifies
//     the level; the person's own change clears it), the member profile's skills kept in step with the catalogue so
//     the platform's «مهارت» assignment method routes by it (WFM-002/009)
//   · coverage and capacity rows: labels, one capacity row per team (and per person in it)
//   · rosters: dates, the person belongs to the team, the label
//   · time off: dates, no overlap with the person's other time off, the team, working days on the default calendar,
//     who asked; when approved and started the member profile is out of office (with the delegate) — the platform's
//     assignment rules skip them — and when it ends, is canceled or rejected the profile is restored (WFM-016/017)
//   · kudos: always from the person who sends them, never to oneself; points for the receiver
import { ABSENCE_TYPES, proficiencyLabel } from "@shared/tables/workforce";
import { countingSkills } from "@shared/workforce/logic";
import { businessBetween, weekMinutes } from "@shared/sla/calendar";
import { formatJalali } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, isSystemCtx, registerHooks, SYSTEM_USER, updateIn, validationError, type WriteArgs } from "../../engine";
import { bad } from "../../http/errors";
import { enqueue } from "../../jobs";
import { calendarFor } from "../sla";
import { groupsOfUser, isUuid, liveRow, liveRows, msOf, sysOf, todayOf, workforceConfig, type Row } from "./common";
import { awardIn } from "./gamification";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Write the catalogue skills a person qualifies for into their member profile (other tags stay). */
export async function syncProfileSkills(tx: Tx, ctx: Ctx, userId: string): Promise<boolean> {
  const sys = sysOf(ctx);
  const cfg = await workforceConfig(tx, sys);
  if (!cfg.sync_profile_skills) return false;
  const [profile] = await liveRows(tx, sys, "member_profile", { f: "user_id", op: "eq", v: userId }, { limit: 1 });
  if (!profile) return false;
  const catalogue = await liveRows(tx, sys, "wfm_skill", null, { limit: 5000 });
  const byId = new Map(catalogue.map((s) => [String(s.id), s]));
  const catalogueNames = new Set(catalogue.map((s) => norm(s.name)));
  const mine = await liveRows(tx, sys, "wfm_person_skill", { f: "user_id", op: "eq", v: userId }, { limit: 1000 });
  const counting = countingSkills(mine.map((m) => ({ skill_id: String(m.skill_id), level: Number(m.level ?? 0), verified: !!m.verified, status: m.status, expires_at: m.expires_at })), todayOf(sys), { minLevel: cfg.routing_min_level, needsVerified: cfg.routing_needs_verified });
  const qualified = counting.map((s) => byId.get(s.skill_id)).filter((s): s is Row => !!s && s.active !== false && s.routing !== false).map((s) => String(s.name));
  const current: string[] = Array.isArray(profile.skills) ? profile.skills.map(String) : [];
  const kept = current.filter((t) => !catalogueNames.has(norm(t)));
  const next = [...kept, ...qualified.filter((n, i, a) => a.findIndex((x) => norm(x) === norm(n)) === i)];
  const same = next.length === current.length && next.every((n) => current.some((c) => norm(c) === norm(n)));
  if (same) return false;
  await updateIn(tx, sys, "member_profile", String(profile.id), { skills: next }, { trusted: true });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Skills

async function personSkillBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const skill = await liveRow(w.tx, sys, "wfm_skill", n.skill_id);
  if (!skill) throw validationError({ skill_id: "مهارت پیدا نشد" });
  n.label = `${skill.name} — ${proficiencyLabel(n.level)}`.slice(0, 300);
  const actor = w.ctx.user.id;
  const self = actor === n.user_id;
  if (w.changed.has("level") || w.changed.has("skill_id") || (w.op === "create" && !w.trusted)) {
    if (self || (isSystemCtx(w.ctx) && !w.trusted)) {
      n.verified = false;
      n.verified_by = null;
      n.verified_at = null;
    } else if (!isSystemCtx(w.ctx)) {
      // a lead or a manager set the level: it is their assessment
      n.verified = true;
      n.verified_by = actor;
      n.verified_at = new Date().toISOString();
      if (n.source === "self") n.source = "manager";
    }
  }
  if (n.expires_at && n.verified_at && String(n.expires_at) < String(n.verified_at).slice(0, 10)) throw validationError({ expires_at: "تاریخ انقضا پیش از تأیید است" });
}

async function personSkillAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const r = w.op === "delete" ? w.prev! : w.row;
  if (isUuid(r.user_id)) await syncProfileSkills(w.tx, w.ctx, String(r.user_id));
}

async function skillAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "create") return;
  if (!["name", "active", "routing"].some((f) => w.changed.has(f)) && w.op !== "delete") return;
  // the catalogue changed: re-sync the profiles of the people who have this skill (bounded; the sweep finishes)
  const id = String((w.op === "delete" ? w.prev : w.row)!.id);
  const people = await liveRows(w.tx, sysOf(w.ctx), "wfm_person_skill", { f: "skill_id", op: "eq", v: id }, { limit: 200 });
  for (const p of people) await syncProfileSkills(w.tx, w.ctx, String(p.user_id));
}

async function coverageBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (!isUuid(n.group_id) && !isUuid(n.service_id)) throw validationError({ group_id: "گروه یا خدمت را مشخص کنید" });
  const skill = await liveRow(w.tx, sys, "wfm_skill", n.skill_id);
  const owner = isUuid(n.group_id) ? (await liveRow(w.tx, sys, "group", n.group_id))?.name : (await liveRow(w.tx, sys, "service", n.service_id))?.name;
  n.label = `${owner ?? ""}: ${skill?.name ?? ""} — سطح ${n.min_level ?? 3} برای ${n.min_people ?? 1} نفر`.slice(0, 300);
}

async function capacityBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const same = await liveRows(w.tx, sys, "wfm_capacity", { and: [{ f: "group_id", op: "eq", v: n.group_id }, isUuid(n.user_id) ? { f: "user_id", op: "eq", v: n.user_id } : { f: "user_id", op: "empty" }] }, { limit: 2 });
  if (same.some((r) => r.id !== n.id)) throw validationError({ group_id: isUuid(n.user_id) ? "برای این فرد در این تیم ظرفیت ثبت شده است" : "برای این تیم ظرفیت ثبت شده است" });
  const group = await liveRow(w.tx, sys, "group", n.group_id);
  const person = isUuid(n.user_id) ? (await liveRows(w.tx, sys, "member_profile", { f: "user_id", op: "eq", v: n.user_id }, { limit: 1 }))[0]?.name : null;
  n.label = `${group?.name ?? ""}${person ? ` — ${person}` : ""}`.slice(0, 300);
}

// ---------------------------------------------------------------------------------------------------------------
// Rosters

async function rosterBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (n.valid_to && String(n.valid_to) < String(n.valid_from)) throw validationError({ valid_to: "«تا» نمی‌تواند پیش از «از» باشد" });
  if (w.changed.has("user_id") || w.changed.has("group_id")) {
    const groups = await groupsOfUser(w.tx, sys, String(n.user_id));
    if (!groups.includes(String(n.group_id))) throw validationError({ user_id: "این فرد عضو این تیم نیست" });
  }
  const pattern = await liveRow(w.tx, sys, "wfm_shift_pattern", n.pattern_id);
  if (!pattern) throw validationError({ pattern_id: "الگوی شیفت پیدا نشد" });
  n.label = `${pattern.name} از ${formatJalali(String(n.valid_from))}${n.valid_to ? ` تا ${formatJalali(String(n.valid_to))}` : ""}`.slice(0, 300);
}

// ---------------------------------------------------------------------------------------------------------------
// Time off

/** Working days of an absence on the organisation's default calendar (half-day precision). */
export async function workingDaysOf(tx: Tx, ctx: Ctx, start: unknown, end: unknown): Promise<number | null> {
  const s = msOf(start);
  const e = msOf(end);
  if (s === null || e === null || e <= s) return null;
  const sys = sysOf(ctx);
  const cal = await calendarFor(tx, sys, null).catch(() => null);
  if (!cal) return Math.round(((e - s) / 86_400_000) * 2) / 2;
  const perDay = weekMinutes(cal.week).filter((m) => m > 0);
  const day = perDay.length ? perDay.reduce((a, b) => a + b, 0) / perDay.length : 0;
  const ms = businessBetween(cal, s, e);
  return day > 0 ? Math.round((ms / (day * 60_000)) * 2) / 2 : null;
}

async function absenceBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const s = msOf(n.start_at);
  const e = msOf(n.end_at);
  if (s === null || e === null || e <= s) throw validationError({ end_at: "پایان باید پس از آغاز باشد" });
  if (w.op === "create") n.requested_by = w.ctx.user.id === SYSTEM_USER.id ? null : w.ctx.user.id;
  if (!isUuid(n.group_id) && isUuid(n.user_id)) n.group_id = (await groupsOfUser(w.tx, sys, String(n.user_id)))[0] ?? null;
  if (n.delegate_id && n.delegate_id === n.user_id) throw validationError({ delegate_id: "جانشین نمی‌تواند خود فرد باشد" });
  if (w.op === "create" || ["start_at", "end_at", "user_id"].some((f) => w.changed.has(f))) {
    const others = await liveRows(w.tx, sys, "wfm_absence", { and: [{ f: "user_id", op: "eq", v: n.user_id }, { f: "state", op: "in", v: ["requested", "approved"] }, { f: "start_at", op: "lt", v: n.end_at }, { f: "end_at", op: "gt", v: n.start_at }] }, { limit: 5 });
    if (others.some((o) => o.id !== n.id)) throw validationError({ start_at: "در این بازه مرخصی یا غیبت دیگری ثبت شده است" });
    n.days = await workingDaysOf(w.tx, sys, n.start_at, n.end_at);
  }
  const type = ABSENCE_TYPES.find((t) => t.value === n.type)?.label ?? String(n.type ?? "");
  n.label = `${type} از ${formatJalali(String(n.start_at).slice(0, 10))} تا ${formatJalali(String(n.end_at).slice(0, 10))}`.slice(0, 300);
}

/** Put the absence into the person's profile (out of office until its end, with the delegate). */
export async function applyAbsenceIn(tx: Tx, ctx: Ctx, a: Row): Promise<void> {
  const sys = sysOf(ctx);
  const [profile] = await liveRows(tx, sys, "member_profile", { f: "user_id", op: "eq", v: a.user_id }, { limit: 1 });
  if (profile) {
    const patch: Row = { out_of_office: true, ooo_until: a.end_at };
    if (isUuid(a.delegate_id)) patch.delegate_id = a.delegate_id;
    await updateIn(tx, sys, "member_profile", String(profile.id), patch, { trusted: true });
  }
  await updateIn(tx, sys, "wfm_absence", String(a.id), { applied: true }, { trusted: true, keepVersion: true, allowLocked: true });
}

/** Take the absence out of the profile again (only when the profile still shows this absence). */
export async function clearAbsenceIn(tx: Tx, ctx: Ctx, a: Row): Promise<void> {
  if (!a.applied) return;
  const sys = sysOf(ctx);
  const [profile] = await liveRows(tx, sys, "member_profile", { f: "user_id", op: "eq", v: a.user_id }, { limit: 1 });
  if (profile && profile.out_of_office && msOf(profile.ooo_until) === msOf(a.end_at)) {
    await updateIn(tx, sys, "member_profile", String(profile.id), { out_of_office: false, ooo_until: null }, { trusted: true });
  }
  await updateIn(tx, sys, "wfm_absence", String(a.id), { applied: false }, { trusted: true, keepVersion: true, allowLocked: true });
}

async function absenceAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") {
    if (w.prev?.applied) await clearAbsenceIn(w.tx, w.ctx, w.prev);
    return;
  }
  const r = w.row;
  if (!w.changed.has("state") && !w.changed.has("start_at") && !w.changed.has("end_at")) return;
  const now = Date.now();
  if (r.state === "approved") {
    const s = msOf(r.start_at) ?? now;
    const e = msOf(r.end_at) ?? now;
    if (s <= now && e > now && !r.applied) await applyAbsenceIn(w.tx, w.ctx, r);
    if (s > now) await enqueue(w.tx, { kind: "wfm.absence", orgId: w.ctx.org.id, payload: { id: r.id }, runAt: new Date(s), dedupeKey: `wfm.absence:${r.id}:start`, maxAttempts: 5 });
    await enqueue(w.tx, { kind: "wfm.absence", orgId: w.ctx.org.id, payload: { id: r.id }, runAt: new Date(Math.max(e, now)), dedupeKey: `wfm.absence:${r.id}:end`, maxAttempts: 5 });
  } else if (["ended", "canceled", "rejected"].includes(String(r.state)) && r.applied) {
    await clearAbsenceIn(w.tx, w.ctx, r);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Kudos

function kudosBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" && !isSystemCtx(w.ctx)) n.from_id = w.ctx.user.id;
  if (w.op === "update" && w.changed.has("from_id") && !isSystemCtx(w.ctx)) throw bad("فرستندهٔ قدردانی تغییر نمی‌کند");
  if (n.from_id && n.from_id === n.to_id) throw validationError({ to_id: "قدردانی از خود ثبت نمی‌شود" });
}

async function kudosAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op !== "create") return;
  const cfg = await workforceConfig(w.tx, sysOf(w.ctx));
  await awardIn(w.tx, w.ctx, { user_id: String(w.row.to_id), reason: "kudos", points: cfg.points_kudos, record_id: String(w.row.id), table_key: "wfm_kudos", record_number: null });
}

export function installWorkforceHooks(): (() => void)[] {
  return [
    registerHooks("wfm_person_skill", { beforeWrite: personSkillBefore, afterWrite: personSkillAfter }),
    registerHooks("wfm_skill", { afterWrite: skillAfter }),
    registerHooks("wfm_coverage", { beforeWrite: coverageBefore }),
    registerHooks("wfm_capacity", { beforeWrite: capacityBefore }),
    registerHooks("wfm_roster", { beforeWrite: rosterBefore }),
    registerHooks("wfm_absence", { beforeWrite: absenceBefore, afterWrite: absenceAfter }),
    registerHooks("wfm_kudos", { beforeWrite: kudosBefore, afterWrite: kudosAfter }),
  ];
}

export { createIn };
