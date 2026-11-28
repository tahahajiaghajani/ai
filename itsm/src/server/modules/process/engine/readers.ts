// Who a workflow's notices reach (release 1.1.5). A notice of the workflow — an escalation's «باخبر کردن» (the
// person's manager, the holders of «گزارش به», the process managers), an «اعلان» step, the managers' notice of a step
// without people, a stopped run's — names people; the notification service renders each message under its recipient's
// access and drops it for someone who cannot read the case (notify/deliver.ts). So, in the notice's transaction and
// before it is queued, the people it names who do not read the case already become its readers: the case keeps them
// in `notified` and, through `participants` (./progress.ts), the participant source `process` and the confidential
// case's row rule admit them from then on, like a watch list — the bell arrives and its link opens. What they see of
// the case stays what their field groups and steps allow (../access/view.ts): its title, state, steps and journal; no
// value of its form unless a step of theirs, or the requester's view, shows it.
// Who is told at all:
//   · the demo boundary (docs/DEMO_FA.md): the organisation's own case tells none of the pack's people (they take no
//     part in its work, FINAL-1); a case of the pack tells only the pack's people — the bells of demo records go to
//     them alone (notify/deliver.ts), and nothing of it reaches anyone else;
//   · only active members of the organisation;
//   · at most NOTIFIED_MAX people read a case this way (the resolver's 500 candidates of a step with too many people,
//     the notification service's 500 recipients): a notice beyond it reaches those who read the case already.
// The journal names the people told and, a sentence each, those who were not and why (`Audience.untold`). A caller that
// chooses whom to name by this rule (an escalation's «گزارش به», walking up past units whose holders may not be told)
// asks `mayBeTold`.
// Reads and writes through the caller's transaction, under the case's lock (PGlite has one connection).
import { faDigits } from "@shared/format";
import type { Ctx } from "../../../context";
import { pgArray, type Queryable, type Tx } from "../../../db";
import { demoPeople, isDemoRow } from "../../../db/scope";
import { updateIn } from "../../../engine";
import { PARTICIPANTS_MAX } from "./progress";
import { isId, lockCase, peopleNames, type CaseRow } from "./store";

/** At most this many people read a case only because a notice named them. */
export const NOTIFIED_MAX = 500;

/** What a case is asked for to tell who reads it already. */
export type CaseFacts = Pick<CaseRow, "id" | "org_id" | "requested_by" | "requested_for" | "participants" | "managers" | "manager_groups"> & { notified?: string[] | null };

/** The people a notice names, as the journal tells them. */
export interface Audience {
  /** told (lower-case ids, in the order they were named) */
  told: string[];
  /** their names, in the same order */
  names: string[];
  /** who could not be told and why, a sentence each («… حساب نمایشی است؛ اعلان به او نرسید») */
  untold: string[];
  /** nobody was told only because the case is the pack's and the people named are not (its real managers…) */
  demoOnly: boolean;
  /** the people told who become readers of the case (`notified`) */
  readers: string[];
}

const ids = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter(isId).map((x) => x.toLowerCase()))];

/** Active members of the organisation among `users`. */
export async function activeMembers(q: Queryable, orgId: string, users: readonly string[]): Promise<Set<string>> {
  const wanted = ids(users);
  if (!wanted.length) return new Set();
  const rows = await q.query<{ user_id: string }>(
    `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.user_id = any($2::uuid[]) and m.deleted_at is null and m.is_active and not coalesce(u.disabled, false)`,
    [orgId, pgArray(wanted)],
  );
  return new Set(rows.map((r) => String(r.user_id).toLowerCase()));
}

/** Members, valid now, of active groups. */
async function groupMembers(q: Queryable, orgId: string, groups: readonly string[]): Promise<string[]> {
  const wanted = ids(groups);
  if (!wanted.length) return [];
  const rows = await q.query<{ user_id: string }>(
    `select distinct gm.user_id from sm_group_members gm join sm_groups g on g.id = gm.group_id and g.deleted_at is null and g.active is not false
     where g.org_id = $1 and gm.group_id = any($2::uuid[]) and gm.deleted_at is null
       and (gm.valid_from is null or gm.valid_from <= now()) and (gm.valid_to is null or gm.valid_to > now())`,
    [orgId, pgArray(wanted)],
  );
  return rows.map((r) => String(r.user_id).toLowerCase());
}

/** Who reads the case through its participant sources already: requester, participants, managers (named or by a group). */
async function readersOf(q: Queryable, kase: CaseFacts): Promise<Set<string>> {
  return new Set([
    ...ids([kase.requested_by, kase.requested_for]),
    ...ids(kase.participants),
    ...ids(kase.notified),
    ...ids(kase.managers),
    ...(await groupMembers(q, kase.org_id, kase.manager_groups ?? [])),
  ]);
}

/** «الف»، «الف و ب»، «الف، ب و ج»; past `max` names, «… و ۳ نفر دیگر». */
export function nameList(names: readonly string[], max = 10): string {
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join("، ")} و ${faDigits(more)} نفر دیگر`;
  if (shown.length < 2) return shown[0] ?? "";
  return `${shown.slice(0, -1).join("، ")} و ${shown[shown.length - 1]}`;
}

/** `nameList` of people by id, reading the names of the ten shown only. */
async function namesOf(q: Queryable, users: readonly string[]): Promise<string> {
  const shown = users.slice(0, 10);
  const names = await peopleNames(q, shown);
  return nameList([...shown.map((u) => names.get(u) ?? "—"), ...new Array<string>(users.length - shown.length).fill("")]);
}

/** The people a notice names, by the demo boundary and membership (`mayBeTold`). */
export interface ToldSides {
  /** the case is a row of the organisation's demo pack */
  demoCase: boolean;
  /** on the other side of the demo boundary: the pack's people on an organisation's own case, the others on a pack's */
  otherSide: string[];
  /** on the case's side, but not active members of the organisation */
  inactive: string[];
  /** who may be told (lower-case ids, in the order named) */
  able: string[];
}

/**
 * The people named, by the demo boundary and membership (see the header): those who may be told, and the others — the
 * rule of every notice of the case (`audienceOf`), for a caller that chooses whom to name by it (../timers/timer.ts:
 * the nearest holders of «گزارش به» who may be told). Read only.
 */
export async function mayBeTold(q: Queryable, kase: Pick<CaseFacts, "id" | "org_id">, users: readonly string[]): Promise<ToldSides> {
  const named = ids(users);
  if (!named.length) return { demoCase: false, otherSide: [], inactive: [], able: [] };
  const demoCase = await isDemoRow(q, kase.org_id, kase.id);
  const pack = await demoPeople(q, kase.org_id, named);
  const otherSide = named.filter((u) => (demoCase ? !pack.has(u) : pack.has(u)));
  const side = named.filter((u) => (demoCase ? pack.has(u) : !pack.has(u)));
  const live = await activeMembers(q, kase.org_id, side);
  return { demoCase, otherSide, inactive: side.filter((u) => !live.has(u)), able: side.filter((u) => live.has(u)) };
}

/** A sentence for those on the other side of the demo boundary, one for those who are not active members. */
async function whyNot(q: Queryable, demoCase: boolean, otherSide: readonly string[], inactive: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  if (otherSide.length) {
    const who = await namesOf(q, otherSide);
    out.push(
      demoCase
        ? `پروندهٔ نمایشی است و اعلان به ${who} نرسید`
        : otherSide.length === 1 ? `${who} حساب نمایشی است؛ اعلان به او نرسید` : `${who} حساب نمایشی‌اند؛ اعلان به آن‌ها نرسید`,
    );
  }
  if (inactive.length) {
    const who = await namesOf(q, inactive);
    out.push(inactive.length === 1 ? `${who} عضو فعال سازمان نیست؛ اعلان به او نرسید` : `${who} عضو فعال سازمان نیستند؛ اعلان به آن‌ها نرسید`);
  }
  return out;
}

/**
 * Who of `users` a notice about the case may tell, and why the others not (see the header) — read only. `kase` as it is
 * now, under the caller's lock (its readers decide who needs to become one).
 */
export async function audienceOf(q: Queryable, kase: CaseFacts, users: readonly string[]): Promise<Audience> {
  const named = ids(users);
  const out: Audience = { told: [], names: [], untold: [], demoOnly: false, readers: [] };
  if (!named.length) return out;
  const { demoCase, otherSide, inactive, able } = await mayBeTold(q, kase, named);
  const already = await readersOf(q, kase);
  const need = able.filter((u) => !already.has(u));
  const room = Math.max(0, Math.min(NOTIFIED_MAX - ids(kase.notified).length, PARTICIPANTS_MAX - ids(kase.participants).length));
  const over = new Set(need.slice(room));
  out.readers = need.filter((u) => !over.has(u));
  out.told = able.filter((u) => !over.has(u));
  const names = await peopleNames(q, out.told);
  out.names = out.told.map((u) => names.get(u) ?? "—");
  out.untold = await whyNot(q, demoCase, otherSide, inactive);
  if (over.size) out.untold.push(`اعلان به ${faDigits(over.size)} نفر دیگر نرسید؛ اعلان‌های یک پرونده به بیش از ${faDigits(NOTIFIED_MAX)} نفری که پرونده را نمی‌خوانند نمی‌رسد`);
  out.demoOnly = demoCase && !out.told.length && otherSide.length > 0 && !inactive.length && !over.size;
  return out;
}

/**
 * Of people a notice's rules named whom it does not reach (`users`: left out by the resolver before the notice was
 * sent), why — a sentence for those on the other side of the demo boundary, one for those who are not active members
 * —, and how many others there were (more than the notice takes). Read only.
 */
export async function untoldOf(q: Queryable, kase: Pick<CaseFacts, "id" | "org_id">, users: readonly string[]): Promise<{ untold: string[]; others: number }> {
  const named = ids(users);
  if (!named.length) return { untold: [], others: 0 };
  const { demoCase, otherSide, inactive, able } = await mayBeTold(q, kase, named);
  return { untold: await whyNot(q, demoCase, otherSide, inactive), others: able.length };
}

/**
 * Make the people told of a notice readers of the case (inside the caller's transaction, before the notice is queued):
 * `notified` and `participants` take them in one write. The caller's copy of the case follows.
 */
export async function addReaders(tx: Tx, sys: Ctx, kase: CaseFacts, readers: readonly string[]): Promise<void> {
  const fresh = ids(readers);
  if (!fresh.length) return;
  const notified = [...new Set([...ids(kase.notified), ...fresh])];
  const participants = [...new Set([...ids(kase.participants), ...fresh])].sort();
  await updateIn(tx, sys, "process_case", kase.id, { notified, participants }, { trusted: true });
  kase.notified = notified;
  kase.participants = participants;
}

/**
 * Who of `users` a notice about the case tells (`audienceOf`), made readers of it (`addReaders`): under the case's lock,
 * read afresh in the transaction (a step that does not hold it yet, as an «اعلان», takes it here).
 */
export async function tellCase(tx: Tx, sys: Ctx, kase: CaseFacts, users: readonly string[]): Promise<Audience> {
  if (!ids(users).length) return { told: [], names: [], untold: [], demoOnly: false, readers: [] };
  const now = (await lockCase(tx, kase.org_id, kase.id)) ?? kase;
  const a = await audienceOf(tx, now, users);
  await addReaders(tx, sys, now, a.readers);
  if (now !== kase) {
    kase.notified = now.notified;
    kase.participants = now.participants;
  }
  return a;
}
